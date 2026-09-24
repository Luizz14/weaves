use crate::profile_migration::{ProfileMigration, atomic_write};
use crate::window_registry::WindowRegistry;
use serde_json::{Value, json};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const MIGRATION_DIRECTORY: &str = "migration";
const MIGRATION_MARKER: &str = "electron-profile-backup-v1.json";
const MIGRATION_DATA_DIRECTORY: &str = "migration-legacy";
const EXPORT_PAGE: &str = "legacy-export.html";
const EXPORT_SCRIPT: &str = "profile-migration-exporter.js";
const DEV_EXPORT_PAGE: &str = "/profile-migration-exporter.html";
const EXPORT_WINDOW_LABEL: &str = "profile-migration";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyExportStart {
    NotNeeded,
    SourceActive,
    Failed,
    Started,
}

/// Starts a hidden exporter for one source profile selected by the
/// native shell. The caller owns source selection; this module never scans or
/// guesses other Superset profiles.
pub fn start(
    app: &AppHandle,
    migration: &ProfileMigration,
    windows: &WindowRegistry,
    source_profile: &Path,
    cef_root: &Path,
    user_data_path: &Path,
) -> Result<LegacyExportStart, String> {
    match start_inner(
        app,
        migration,
        windows,
        source_profile,
        cef_root,
        user_data_path,
    ) {
        Ok(result) => Ok(result),
        Err(error) => {
            migration.set_export_error(error)?;
            Ok(LegacyExportStart::Failed)
        }
    }
}

fn start_inner(
    app: &AppHandle,
    migration: &ProfileMigration,
    windows: &WindowRegistry,
    source_profile: &Path,
    cef_root: &Path,
    user_data_path: &Path,
) -> Result<LegacyExportStart, String> {
    if migration.status().state == "complete" {
        return Ok(LegacyExportStart::NotNeeded);
    }
    if legacy_profile_is_active(source_profile)? {
        migration.set_source_active(true)?;
        return Ok(LegacyExportStart::SourceActive);
    }
    let migration_dir = user_data_path.join(MIGRATION_DIRECTORY);
    let previous_export = migration_dir.join(MIGRATION_MARKER).is_file();
    let Some(source_metadata) = optional_metadata(source_profile)? else {
        if previous_export {
            return Err("legacy profile is missing before its renderer snapshot was saved".into());
        }
        return Ok(LegacyExportStart::NotNeeded);
    };
    if source_metadata.file_type().is_symlink() || !source_metadata.is_dir() {
        return Err("legacy profile source must be a real directory".into());
    }
    let has_local_storage = storage_directory_exists(&source_profile.join("Local Storage"))?;
    let has_indexed_db = storage_directory_exists(&source_profile.join("IndexedDB"))?;
    if !has_local_storage && !has_indexed_db {
        if previous_export {
            return Err(
                "legacy profile storage is missing before its renderer snapshot was saved".into(),
            );
        }
        return Ok(LegacyExportStart::NotNeeded);
    }

    fs::create_dir_all(&migration_dir).map_err(|error| error.to_string())?;
    write_marker(
        &migration_dir,
        source_profile,
        migration.source_origin(),
        migration.target_origin(),
    )?;
    migration.set_source_active(false)?;

    let migration_data = cef_root.join(MIGRATION_DATA_DIRECTORY);
    remove_generated_profile(&migration_data)?;
    copy_profile_storage(source_profile, &migration_data)?;

    let url = prepare_export_page(
        app,
        &migration_dir,
        migration.source_origin(),
        migration.target_origin(),
    )?;
    let expected_url = url.clone();
    let expected_navigation_url = expected_url.clone();
    let poller_started = Arc::new(AtomicBool::new(false));
    let legacy_source_profile = source_profile.to_path_buf();
    let app_handle = app.clone();
    let migration_state = migration.clone();
    let registered_windows = windows.clone();
    WebviewWindowBuilder::new(app, EXPORT_WINDOW_LABEL, WebviewUrl::External(url))
        .data_directory(PathBuf::from(MIGRATION_DATA_DIRECTORY))
        .visible(false)
        .on_navigation(move |url| url == &expected_navigation_url)
        .on_page_load(move |window, payload| {
            if !claim_export_poller(
                &poller_started,
                payload.event(),
                payload.url(),
                &expected_url,
            ) {
                return;
            }
            let app = app_handle.clone();
            let migration = migration_state.clone();
            let poll_window = window.clone();
            let legacy_source_profile = legacy_source_profile.clone();
            let registered_windows = registered_windows.clone();
            std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + Duration::from_secs(120);
                while std::time::Instant::now() < deadline {
                    if app.get_webview_window(EXPORT_WINDOW_LABEL).is_none() {
                        return;
                    }
                    let (sender, receiver) = mpsc::sync_channel(1);
                    if poll_window
                        .eval_with_callback(export_poll_script(), move |raw| {
                            let _ = sender.send(raw);
                        })
                        .is_err()
                    {
                        if app.get_webview_window(EXPORT_WINDOW_LABEL).is_none() {
                            return;
                        }
                        break;
                    }
                    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                    let raw = match receiver.recv_timeout(remaining) {
                        Ok(raw) => raw,
                        Err(mpsc::RecvTimeoutError::Timeout)
                        | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    };
                    if !raw.trim().is_empty() && raw.trim() != "null" {
                        match parse_eval_result(&raw).and_then(|event| {
                            process_export_event(
                                &app,
                                &migration,
                                &poll_window,
                                &legacy_source_profile,
                                event,
                            )
                        }) {
                            Ok(ExportPoll::Complete) => {
                                defer_exporter_close(&app, &registered_windows);
                                return;
                            }
                            Ok(ExportPoll::Continue) => {}
                            Err(error) => {
                                fail_export(&app, &migration, error);
                                defer_exporter_close(&app, &registered_windows);
                                return;
                            }
                        }
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                if app.get_webview_window(EXPORT_WINDOW_LABEL).is_none() {
                    return;
                }
                fail_export(&app, &migration, "Legacy profile exporter timed out".into());
                defer_exporter_close(&app, &registered_windows);
            });
        })
        .build()
        .map_err(|error| format!("failed to create legacy exporter: {error}"))?;
    Ok(LegacyExportStart::Started)
}

fn defer_exporter_close(app: &AppHandle, windows: &WindowRegistry) {
    loop {
        let Some(exporter_window) = app.get_webview_window(EXPORT_WINDOW_LABEL) else {
            return;
        };
        let app_windows = app.webview_windows();
        if has_registered_app_window(app_windows.keys().cloned(), |label| {
            windows.is_registered(label)
        }) {
            let _ = exporter_window.close();
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn has_registered_app_window(
    labels: impl IntoIterator<Item = String>,
    mut is_registered: impl FnMut(&str) -> bool,
) -> bool {
    labels.into_iter().any(|label| is_registered(&label))
}

fn claim_export_poller(
    started: &AtomicBool,
    event: PageLoadEvent,
    url: &Url,
    expected_url: &Url,
) -> bool {
    event == PageLoadEvent::Finished
        && url == expected_url
        && !started.swap(true, Ordering::Relaxed)
}

fn prepare_export_page(
    app: &AppHandle,
    migration_dir: &Path,
    source_origin: &str,
    target_origin: &str,
) -> Result<Url, String> {
    let mut url = if source_origin == "file://" {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|error| format!("failed to locate packaged resources: {error}"))?;
        let bundled_script = resource_dir.join("resources").join(EXPORT_SCRIPT);
        let metadata = fs::symlink_metadata(&bundled_script)
            .map_err(|error| format!("missing bundled profile exporter: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("bundled profile exporter must be a regular file".into());
        }
        let exporter_script = migration_dir.join(EXPORT_SCRIPT);
        if let Some(metadata) = optional_metadata(&exporter_script)? {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("profile exporter target must be a regular file".into());
            }
        }
        fs::copy(bundled_script, exporter_script).map_err(|error| error.to_string())?;

        let export_page = migration_dir.join(EXPORT_PAGE);
        if let Some(metadata) = optional_metadata(&export_page)? {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("profile exporter page target must be a regular file".into());
            }
        }
        fs::write(
            &export_page,
            "<!doctype html><meta charset=utf-8><script src='./profile-migration-exporter.js'></script>",
        )
        .map_err(|error| error.to_string())?;
        Url::from_file_path(&export_page)
            .map_err(|_| "could not create legacy export file URL".to_string())?
    } else {
        let mut page = Url::parse(&format!("{source_origin}{DEV_EXPORT_PAGE}"))
            .map_err(|error| format!("invalid legacy exporter origin: {error}"))?;
        if page.origin().ascii_serialization() != source_origin {
            return Err("legacy exporter URL does not match its source origin".into());
        }
        page
    };
    url.query_pairs_mut()
        .append_pair("sourceOrigin", source_origin)
        .append_pair("targetOrigin", target_origin);
    Ok(url)
}

pub fn legacy_profile_is_active(source: &Path) -> Result<bool, String> {
    lock_is_live(&source.join("SingletonLock"))
}

fn lock_is_live(path: &Path) -> Result<bool, String> {
    let Some(metadata) = optional_metadata(path)? else {
        return Ok(false);
    };
    if !metadata.file_type().is_symlink() {
        return Err(format!(
            "legacy Chromium lock is not a symlink: {}",
            path.display()
        ));
    }
    let target = fs::read_link(path).map_err(|error| error.to_string())?;
    let Some(pid) = target
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.rsplit('-').next())
        .and_then(|value| value.parse::<u32>().ok())
    else {
        return Err("legacy Chromium lock has an invalid process id".into());
    };
    let Ok(pid) = i32::try_from(pid) else {
        return Ok(false);
    };
    if pid == 0 {
        return Ok(false);
    }
    #[cfg(unix)]
    {
        process_is_live(pid)
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        Ok(false)
    }
}

#[cfg(target_os = "macos")]
fn process_is_live(pid: i32) -> Result<bool, String> {
    let result = unsafe { libc::kill(pid, 0) };
    if result == 0 {
        return Ok(true);
    }
    classify_process_probe_error(pid, io::Error::last_os_error().raw_os_error())
}

#[cfg(target_os = "macos")]
fn classify_process_probe_error(pid: i32, error: Option<i32>) -> Result<bool, String> {
    match error {
        Some(libc::ESRCH) => Ok(false),
        Some(libc::EPERM) => Ok(true),
        _ => Err(format!(
            "could not verify legacy Chromium lock process {pid}: {}",
            io::Error::from_raw_os_error(error.unwrap_or(libc::EINVAL))
        )),
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn process_is_live(pid: i32) -> Result<bool, String> {
    let process = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "pid="])
        .output()
        .map_err(|error| format!("could not verify legacy Chromium lock: {error}"))?;
    if !process.status.success() {
        return Err(format!(
            "could not verify legacy Chromium lock: ps exited with {}",
            process.status
        ));
    }
    let output = String::from_utf8(process.stdout)
        .map_err(|error| format!("could not verify legacy Chromium lock: {error}"))?;
    match output.trim() {
        "" => Ok(false),
        value if value.parse::<i32>().ok() == Some(pid) => Ok(true),
        _ => Err("could not verify legacy Chromium lock: unexpected ps output".into()),
    }
}

fn optional_metadata(path: &Path) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn storage_directory_exists(path: &Path) -> Result<bool, String> {
    let Some(metadata) = optional_metadata(path)? else {
        return Ok(false);
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "legacy profile storage must be a real directory: {}",
            path.display()
        ));
    }
    Ok(true)
}

fn remove_generated_profile(path: &Path) -> Result<(), String> {
    let Some(metadata) = optional_metadata(path)? else {
        return Ok(());
    };
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "legacy exporter target must not be a symlink: {}",
            path.display()
        ));
    }
    if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn write_marker(
    migration_dir: &Path,
    source: &Path,
    source_origin: &str,
    target_origin: &str,
) -> Result<(), String> {
    let marker = json!({
        "version": 1,
        "source": source,
        "sourceOrigin": source_origin,
        "targetOrigin": target_origin,
    });
    let encoded = serde_json::to_vec_pretty(&marker).map_err(|error| error.to_string())?;
    atomic_write(&migration_dir.join(MIGRATION_MARKER), &encoded)
}

fn copy_profile_storage(source: &Path, destination: &Path) -> Result<(), String> {
    if fs::symlink_metadata(source)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("legacy profile source must not be a symlink".into());
    }
    if let Some(metadata) = optional_metadata(destination)? {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("legacy exporter target must be a real directory".into());
        }
    } else {
        fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    }
    for name in ["Local Storage", "IndexedDB"] {
        let source_path = source.join(name);
        if storage_directory_exists(&source_path)? {
            copy_directory(&source_path, &destination.join(name))?;
        }
    }
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(metadata) = optional_metadata(destination)? {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!(
                "legacy exporter target must be a real directory: {}",
                destination.display()
            ));
        }
    } else {
        fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    }
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = fs::symlink_metadata(&source_path)
            .map_err(|error| error.to_string())?
            .file_type();
        if file_type.is_symlink() {
            return Err(format!(
                "legacy profile storage contains unsupported symlink {}",
                source_path.display()
            ));
        }
        if file_type.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(source_path, destination_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn parse_eval_result(raw: &str) -> Result<Value, String> {
    const MAX_JSON_STRING_WRAPPINGS: usize = 4;

    let mut value = serde_json::from_str::<Value>(raw)
        .map_err(|error| format!("legacy profile export returned invalid JSON: {error}"))?;
    for _ in 0..MAX_JSON_STRING_WRAPPINGS {
        let Some(encoded) = value.as_str() else {
            return Ok(value);
        };
        value = serde_json::from_str::<Value>(encoded)
            .map_err(|error| format!("legacy profile export returned invalid JSON: {error}"))?;
    }
    if value.is_string() {
        return Err("legacy profile export returned too many JSON string wrappers".into());
    }
    Ok(value)
}

enum ExportPoll {
    Continue,
    Complete,
}

fn process_export_event(
    app: &AppHandle,
    migration: &ProfileMigration,
    window: &tauri::WebviewWindow,
    legacy_source_profile: &Path,
    event: Value,
) -> Result<ExportPoll, String> {
    if let Some(error) = event.get("error").and_then(Value::as_str) {
        return Err(error.to_string());
    }
    let Some(chunk_string) = event.get("chunk").and_then(Value::as_str) else {
        return if event.get("done").and_then(Value::as_bool) == Some(true) {
            Ok(ExportPoll::Complete)
        } else {
            Ok(ExportPoll::Continue)
        };
    };
    let chunk: Value = serde_json::from_str(chunk_string)
        .map_err(|error| format!("invalid exporter chunk: {error}"))?;
    let object = chunk
        .as_object()
        .ok_or_else(|| "exporter chunk must be an object".to_string())?;
    let sequence = object
        .get("sequence")
        .and_then(Value::as_u64)
        .ok_or_else(|| "exporter chunk is missing sequence".to_string())?;
    let payload = object
        .get("payload")
        .cloned()
        .ok_or_else(|| "exporter chunk is missing payload".to_string())?;
    let is_finish = payload.get("kind").and_then(Value::as_str) == Some("finish");
    if is_finish && legacy_profile_is_active(legacy_source_profile)? {
        return Err(
            "Legacy Superset profile became active during export; quit the previous instance and retry"
                .into(),
        );
    }
    let status = migration.ingest_export_chunk(payload)?;
    window
        .eval(&export_ack_script(sequence))
        .map_err(|error| format!("failed to acknowledge exporter chunk: {error}"))?;
    if is_finish {
        app.emit_to(
            "main",
            "desktop:event",
            json!({"name":"profile:migration-ready","payload":status}),
        )
        .map_err(|error| format!("failed to report migration ready: {error}"))?;
        return Ok(ExportPoll::Complete);
    }
    Ok(ExportPoll::Continue)
}

fn fail_export(app: &AppHandle, migration: &ProfileMigration, error: String) {
    let _ = migration.set_export_error(error.clone());
    let _ = app.emit_to(
        "main",
        "desktop:event",
        json!({"name":"profile:migration-error","payload":{"message":error}}),
    );
}

fn export_poll_script() -> &'static str {
    "(()=>{const state=window.__SUPERSET_LEGACY_EXPORT_STATE__;if(!state)return JSON.stringify({error:'Legacy profile exporter did not initialize'});return state.error||state.chunk||state.done?JSON.stringify({error:state.error,chunk:state.chunk,done:state.done}):null})()"
}

fn export_ack_script(sequence: u64) -> String {
    format!("window.__SUPERSET_LEGACY_EXPORT_STATE__?.ack?.({sequence}); true",)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "superset-legacy-exporter-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ))
    }

    #[test]
    fn parses_double_encoded_eval_json() {
        let export_json = serde_json::to_string(&json!({"done": true})).unwrap();
        let callback_json = serde_json::to_string(&export_json).unwrap();
        let eval_result = serde_json::to_string(&callback_json).unwrap();
        assert_eq!(
            parse_eval_result(&eval_result).unwrap(),
            json!({"done": true})
        );
    }

    #[test]
    fn starts_export_poller_once_only_after_the_expected_page_finishes() {
        let started = AtomicBool::new(false);
        let expected_url = Url::parse("https://localhost:3145/profile-migration-exporter.html?targetOrigin=http%3A%2F%2F127.0.0.1%3A3145").unwrap();
        let initial_url = Url::parse("data:text/html;charset=utf-8,initial").unwrap();

        assert!(!claim_export_poller(
            &started,
            PageLoadEvent::Finished,
            &initial_url,
            &expected_url,
        ));
        assert!(!claim_export_poller(
            &started,
            PageLoadEvent::Started,
            &expected_url,
            &expected_url,
        ));
        assert!(claim_export_poller(
            &started,
            PageLoadEvent::Finished,
            &expected_url,
            &expected_url,
        ));
        assert!(!claim_export_poller(
            &started,
            PageLoadEvent::Finished,
            &expected_url,
            &expected_url,
        ));
    }

    #[test]
    fn waits_for_a_registered_application_window_before_closing_exporter() {
        let exporter_only = [EXPORT_WINDOW_LABEL.to_string()];
        let exporter_and_main = [EXPORT_WINDOW_LABEL.to_string(), "main".to_string()];

        assert!(!has_registered_app_window(exporter_only, |label| label == "main"));
        assert!(has_registered_app_window(exporter_and_main, |label| label == "main"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn classifies_process_probe_errors_fail_closed() {
        assert_eq!(
            classify_process_probe_error(123, Some(libc::ESRCH)).unwrap(),
            false
        );
        assert_eq!(
            classify_process_probe_error(123, Some(libc::EPERM)).unwrap(),
            true
        );
        assert!(classify_process_probe_error(123, Some(libc::EIO)).is_err());
        assert!(classify_process_probe_error(123, None).is_err());
    }

    #[test]
    fn copies_only_selected_storage_and_rejects_symlinked_entries() {
        let root = temp_dir();
        let source = root.join("legacy");
        let destination = root.join("target");
        fs::create_dir_all(source.join("Local Storage/leveldb")).unwrap();
        fs::create_dir_all(source.join("IndexedDB/keyval-store")).unwrap();
        fs::write(source.join("Local Storage/leveldb/CURRENT"), b"fixture").unwrap();
        fs::write(source.join("IndexedDB/keyval-store/CURRENT"), b"fixture").unwrap();
        fs::write(source.join("Preferences"), b"not copied").unwrap();
        copy_profile_storage(&source, &destination).unwrap();
        assert!(destination.join("Local Storage/leveldb/CURRENT").is_file());
        assert!(destination.join("IndexedDB/keyval-store/CURRENT").is_file());
        assert!(!destination.join("Preferences").exists());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/tmp/outside", source.join("Local Storage/link")).unwrap();
            assert!(copy_profile_storage(&source, &root.join("target-2")).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn recognizes_live_lock_pid_and_ignores_stale_lock_pid() {
        let root = temp_dir();
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(
            format!("fixture-host-{}", std::process::id()),
            root.join("SingletonLock"),
        )
        .unwrap();
        assert!(legacy_profile_is_active(&root).unwrap());
        fs::remove_file(root.join("SingletonLock")).unwrap();
        std::os::unix::fs::symlink("fixture-host-4294967294", root.join("SingletonLock")).unwrap();
        assert!(!legacy_profile_is_active(&root).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
