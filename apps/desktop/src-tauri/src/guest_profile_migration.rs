use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

const ELECTRON_PARTITIONS_DIRECTORY: &str = "Partitions";
const ELECTRON_PARTITION_NAME: &str = "superset";
const MIGRATION_DIRECTORY: &str = "migration";
const SNAPSHOT_DIRECTORY: &str = "electron-guest-partition";
const SNAPSHOT_METADATA: &str = "metadata.json";
const SNAPSHOT_SOURCE: &str = "electron-guest-partition";
const PENDING_MARKER: &str = ".electron-guest-partition.pending.json";
const COMPLETE_MARKER: &str = ".electron-guest-partition.v1.json";
const MARKER_VERSION: u32 = 1;

static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuestProfileMigrationOutcome {
    NotNeeded,
    Migrated,
    AlreadyMigrated,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MigrationMarker {
    version: u32,
    owner_pid: u32,
    electron_user_data_path: PathBuf,
    electron_partition_path: PathBuf,
    user_data_path: PathBuf,
    snapshot_path: PathBuf,
    cef_request_context_path: PathBuf,
    staging_path: PathBuf,
    source_digest: String,
    snapshot_digest: Option<String>,
    cef_profile_digest: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotMetadata<'a> {
    version: u32,
    source: &'static str,
    keychain: KeychainIdentity<'a>,
}

#[derive(Serialize)]
struct KeychainIdentity<'a> {
    service: String,
    account: &'a str,
}

#[derive(Clone, Debug)]
struct SourceSelection {
    cookie_files: Vec<(String, PathBuf)>,
    local_storage: Option<PathBuf>,
    indexed_db: Option<PathBuf>,
}

impl SourceSelection {
    fn has_data(&self) -> bool {
        !self.cookie_files.is_empty() || self.local_storage.is_some() || self.indexed_db.is_some()
    }

    fn has_cookie_data(&self) -> bool {
        !self.cookie_files.is_empty()
    }

    fn has_web_storage(&self) -> bool {
        self.local_storage.is_some() || self.indexed_db.is_some()
    }
}

/// Migrates only the selected Electron profile's persistent `superset` partition.
/// The caller supplies the exact CEF request-context path used for the persistent
/// browser store; it must be resolved by the browser module's shared resolver.
pub fn migrate_selected_profile(
    electron_user_data_path: &Path,
    electron_app_name: &str,
    user_data_path: &Path,
    cef_request_context_path: &Path,
) -> Result<GuestProfileMigrationOutcome, String> {
    validate_absolute_path(electron_user_data_path, "Electron userData path")?;
    validate_absolute_path(user_data_path, "native userData path")?;
    validate_absolute_path(cef_request_context_path, "CEF request-context path")?;
    validate_electron_app_name(electron_app_name)?;
    validate_cef_destination(user_data_path, cef_request_context_path)?;

    let electron_partition_path = electron_user_data_path
        .join(ELECTRON_PARTITIONS_DIRECTORY)
        .join(ELECTRON_PARTITION_NAME);
    let snapshot_path = user_data_path
        .join(MIGRATION_DIRECTORY)
        .join(SNAPSHOT_DIRECTORY);
    let migration_directory = user_data_path.join(MIGRATION_DIRECTORY);
    let pending_marker_path = migration_directory.join(PENDING_MARKER);
    let complete_marker_path = migration_directory.join(COMPLETE_MARKER);

    if let Some(marker) = read_marker(&complete_marker_path)? {
        validate_marker_paths(
            &marker,
            electron_user_data_path,
            &electron_partition_path,
            user_data_path,
            &snapshot_path,
            cef_request_context_path,
        )?;
        remove_pending_after_completion(&pending_marker_path, &marker)?;
        cleanup_staging_directory(&marker.staging_path)?;
        return Ok(GuestProfileMigrationOutcome::AlreadyMigrated);
    }

    if let Some(marker) = read_marker(&pending_marker_path)? {
        validate_marker_paths(
            &marker,
            electron_user_data_path,
            &electron_partition_path,
            user_data_path,
            &snapshot_path,
            cef_request_context_path,
        )?;
        if process_is_running(marker.owner_pid)? {
            return Err("Electron guest-profile migration is already running".into());
        }
        finish_pending_migration(&marker, &pending_marker_path, &complete_marker_path)?;
        return Ok(GuestProfileMigrationOutcome::Migrated);
    }

    if !ensure_source_directory(electron_user_data_path)? {
        return Ok(GuestProfileMigrationOutcome::NotNeeded);
    }
    if crate::legacy_exporter::legacy_profile_is_active(electron_user_data_path)? {
        return Err("The selected Electron profile is still active".into());
    }
    if !ensure_source_directory(&electron_user_data_path.join(ELECTRON_PARTITIONS_DIRECTORY))? {
        return Ok(GuestProfileMigrationOutcome::NotNeeded);
    }
    if !ensure_source_directory(&electron_partition_path)? {
        return Ok(GuestProfileMigrationOutcome::NotNeeded);
    }

    let selection = inspect_source(&electron_partition_path)?;
    if !selection.has_data() {
        return Ok(GuestProfileMigrationOutcome::NotNeeded);
    }
    let source_digest = digest_selection(&selection)?;

    ensure_directory(user_data_path)?;
    ensure_child_directory(user_data_path, &migration_directory)?;
    ensure_child_directory(
        user_data_path,
        &cef_request_context_path
            .parent()
            .ok_or_else(|| "CEF request-context path has no parent directory".to_string())?,
    )?;

    if selection.has_cookie_data() {
        reject_or_remove_empty_directory(&snapshot_path)?;
    }
    if selection.has_web_storage() {
        reject_or_remove_empty_directory(cef_request_context_path)?;
    }

    let staging_path = create_staging_directory(&migration_directory)?;
    let staging_snapshot_path = staging_path.join("snapshot");
    let staging_cef_path = staging_path.join("cef-profile");

    if selection.has_cookie_data() {
        copy_cookie_snapshot(&selection, &staging_snapshot_path, electron_app_name)?;
    }
    if selection.has_web_storage() {
        copy_web_storage(&selection, &staging_cef_path)?;
    }

    if crate::legacy_exporter::legacy_profile_is_active(electron_user_data_path)?
        || digest_selection(&selection)? != source_digest
    {
        return Err("The selected Electron profile changed during migration".into());
    }

    let marker = MigrationMarker {
        version: MARKER_VERSION,
        owner_pid: std::process::id(),
        electron_user_data_path: electron_user_data_path.to_path_buf(),
        electron_partition_path,
        user_data_path: user_data_path.to_path_buf(),
        snapshot_path,
        cef_request_context_path: cef_request_context_path.to_path_buf(),
        staging_path,
        source_digest,
        snapshot_digest: selection
            .has_cookie_data()
            .then(|| digest_tree(&staging_snapshot_path))
            .transpose()?,
        cef_profile_digest: selection
            .has_web_storage()
            .then(|| digest_tree(&staging_cef_path))
            .transpose()?,
    };

    write_marker_create_only(&pending_marker_path, &marker)?;
    finish_pending_migration(&marker, &pending_marker_path, &complete_marker_path)?;

    Ok(GuestProfileMigrationOutcome::Migrated)
}

fn validate_absolute_path(path: &Path, label: &str) -> Result<(), String> {
    if path.is_absolute() {
        Ok(())
    } else {
        Err(format!("{label} must be absolute"))
    }
}

fn validate_electron_app_name(app_name: &str) -> Result<(), String> {
    if app_name.is_empty() || app_name.len() > 256 || app_name.chars().any(char::is_control) {
        return Err("Electron app name is invalid for cookie Keychain metadata".into());
    }
    Ok(())
}

fn validate_cef_destination(user_data_path: &Path, cef_path: &Path) -> Result<(), String> {
    let relative = cef_path
        .strip_prefix(user_data_path)
        .map_err(|_| "CEF request-context path must be inside native userData".to_string())?;
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("CEF request-context path is not a safe native userData child".into());
    }
    Ok(())
}

fn ensure_source_directory(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "Electron profile source must not be a symlink: {}",
            path.display()
        )),
        Ok(metadata) if metadata.is_dir() => Ok(true),
        Ok(_) => Err(format!(
            "Electron profile source is not a directory: {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "could not inspect Electron profile source: {error}"
        )),
    }
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(format!(
            "migration directory must be a real directory: {}",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(path)
            .map_err(|error| format!("could not create migration directory: {error}")),
        Err(error) => Err(format!("could not inspect migration directory: {error}")),
    }
}

fn ensure_child_directory(parent: &Path, path: &Path) -> Result<(), String> {
    let relative = path
        .strip_prefix(parent)
        .map_err(|_| "destination directory escaped native userData".to_string())?;
    let mut current = parent.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return Err("destination directory has an unsafe path component".into());
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(format!(
                    "destination path is not a real directory: {}",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current)
                    .map_err(|error| format!("could not create destination directory: {error}"))?;
            }
            Err(error) => return Err(format!("could not inspect destination directory: {error}")),
        }
    }
    Ok(())
}

fn inspect_source(partition_path: &Path) -> Result<SourceSelection, String> {
    let network_path = partition_path.join("Network");
    let has_network = ensure_source_directory(&network_path)?;
    let root_cookies = optional_regular_file(&partition_path.join("Cookies"))?;
    let network_cookies = if has_network {
        optional_regular_file(&network_path.join("Cookies"))?
    } else {
        false
    };
    if root_cookies && network_cookies {
        return Err(
            "Electron partition contains ambiguous root and Network cookie databases".into(),
        );
    }

    let cookie_base = if root_cookies {
        Some(partition_path.to_path_buf())
	} else if network_cookies {
		Some(network_path.clone())
    } else {
        None
    };
    let mut cookie_files = Vec::new();
    if let Some(cookie_base) = cookie_base {
        cookie_files.push(("Cookies".to_string(), cookie_base.join("Cookies")));
        for suffix in ["-wal", "-shm"] {
            let name = format!("Cookies{suffix}");
            let source = cookie_base.join(&name);
            if optional_regular_file(&source)? {
                cookie_files.push((name, source));
            }
        }
    } else {
        for name in ["Cookies-wal", "Cookies-shm"] {
            if optional_regular_file(&partition_path.join(name))? {
                return Err(
                    "Electron partition has cookie sidecars without a cookie database".into(),
                );
            }
            if has_network && optional_regular_file(&network_path.join(name))? {
                return Err(
                    "Electron partition has cookie sidecars without a cookie database".into(),
                );
            }
        }
    }

    let local_storage_path = partition_path.join("Local Storage");
    let indexed_db_path = partition_path.join("IndexedDB");
    let local_storage = ensure_source_directory(&local_storage_path)?.then_some(local_storage_path);
    let indexed_db = ensure_source_directory(&indexed_db_path)?.then_some(indexed_db_path);

    Ok(SourceSelection {
        cookie_files,
        local_storage,
        indexed_db,
    })
}

fn optional_regular_file(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "Electron partition contains an unsupported symlink: {}",
            path.display()
        )),
        Ok(metadata) if metadata.is_file() => Ok(true),
        Ok(_) => Err(format!(
            "Electron cookie database is not a regular file: {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "could not inspect Electron cookie database: {error}"
        )),
    }
}

fn reject_or_remove_empty_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(format!(
            "migration destination is not a real directory: {}",
            path.display()
        )),
        Ok(_) => {
            let mut entries = fs::read_dir(path)
                .map_err(|error| format!("could not inspect migration destination: {error}"))?;
            if entries.next().is_some() {
                return Err(format!(
                    "refusing to overwrite populated migration destination: {}",
                    path.display()
                ));
            }
            fs::remove_dir(path)
                .map_err(|error| format!("could not remove empty migration destination: {error}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not inspect migration destination: {error}")),
    }
}

fn create_staging_directory(parent: &Path) -> Result<PathBuf, String> {
    loop {
        let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(
            ".electron-guest-partition-stage-{}-{id}",
            std::process::id()
        ));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "could not create guest-profile staging directory: {error}"
                ));
            }
        }
    }
}

fn copy_cookie_snapshot(
    selection: &SourceSelection,
    destination: &Path,
    electron_app_name: &str,
) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|error| format!("could not create cookie snapshot stage: {error}"))?;
    for (name, source) in &selection.cookie_files {
        fs::copy(source, destination.join(name))
            .map_err(|error| format!("could not stage Electron cookie data: {error}"))?;
    }
    let metadata = SnapshotMetadata {
        version: 1,
        source: SNAPSHOT_SOURCE,
        keychain: KeychainIdentity {
            service: format!("{electron_app_name} Safe Storage"),
            account: electron_app_name,
        },
    };
    let bytes = serde_json::to_vec_pretty(&metadata)
        .map_err(|error| format!("could not encode cookie snapshot metadata: {error}"))?;
    write_new_file(&destination.join(SNAPSHOT_METADATA), &bytes)
}

fn copy_web_storage(selection: &SourceSelection, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|error| format!("could not create CEF profile stage: {error}"))?;
    if let Some(source) = &selection.local_storage {
        copy_directory(source, &destination.join("Local Storage"))?;
    }
    if let Some(source) = &selection.indexed_db {
        copy_directory(source, &destination.join("IndexedDB"))?;
    }
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|error| format!("could not create staged browser storage directory: {error}"))?;
    let mut entries = fs::read_dir(source)
        .map_err(|error| format!("could not read Electron browser storage: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not enumerate Electron browser storage: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("could not inspect Electron browser storage: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Electron browser storage contains an unsupported symlink".into());
        }
        if metadata.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("could not stage Electron browser storage: {error}"))?;
        } else {
            return Err("Electron browser storage contains an unsupported file type".into());
        }
    }
    Ok(())
}

fn write_new_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("could not create migration file: {error}"))?;
    file.write_all(contents)
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("could not persist migration file: {error}"))
}

fn digest_selection(selection: &SourceSelection) -> Result<String, String> {
    let mut entries = Vec::new();
    entries.extend(selection.cookie_files.iter().cloned());
    if let Some(path) = &selection.local_storage {
        entries.push(("Local Storage".to_string(), path.clone()));
    }
    if let Some(path) = &selection.indexed_db {
        entries.push(("IndexedDB".to_string(), path.clone()));
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));

    let mut hasher = Sha256::new();
    for (name, path) in entries {
        hasher.update(name.as_bytes());
        hasher.update([0]);
        digest_path_into(&mut hasher, &path, Path::new(""))?;
    }
    Ok(hex_digest(hasher.finalize().as_slice()))
}

fn digest_tree(path: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    digest_path_into(&mut hasher, path, Path::new(""))?;
    Ok(hex_digest(hasher.finalize().as_slice()))
}

fn digest_path_into(hasher: &mut Sha256, path: &Path, relative: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect staged profile data: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("profile migration source contains an unsupported symlink".into());
    }
    hasher.update(relative.as_os_str().as_encoded_bytes());
    hasher.update([0]);

    if metadata.is_dir() {
        hasher.update(b"D");
        let mut entries = fs::read_dir(path)
            .map_err(|error| format!("could not read profile migration directory: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("could not enumerate profile migration directory: {error}"))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            digest_path_into(hasher, &entry.path(), &relative.join(entry.file_name()))?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Err("profile migration data contains an unsupported file type".into());
    }

    hasher.update(b"F");
    hasher.update(metadata.len().to_le_bytes());
    let mut file = File::open(path)
        .map_err(|error| format!("could not read profile migration data: {error}"))?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|error| format!("could not hash profile migration data: {error}"))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    Ok(())
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

fn read_marker(path: &Path) -> Result<Option<MigrationMarker>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => Err(format!(
            "profile migration marker is not a regular file: {}",
            path.display()
        )),
        Ok(_) => {
            let bytes = fs::read(path)
                .map_err(|error| format!("could not read profile migration marker: {error}"))?;
            let marker = serde_json::from_slice::<MigrationMarker>(&bytes)
                .map_err(|error| format!("profile migration marker is invalid: {error}"))?;
            if marker.version != MARKER_VERSION {
                return Err("profile migration marker has an unsupported version".into());
            }
            Ok(Some(marker))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "could not inspect profile migration marker: {error}"
        )),
    }
}

fn validate_marker_paths(
    marker: &MigrationMarker,
    electron_user_data_path: &Path,
    electron_partition_path: &Path,
    user_data_path: &Path,
    snapshot_path: &Path,
    cef_request_context_path: &Path,
) -> Result<(), String> {
    if marker.version != MARKER_VERSION
        || marker.electron_user_data_path != electron_user_data_path
        || marker.electron_partition_path != electron_partition_path
        || marker.user_data_path != user_data_path
        || marker.snapshot_path != snapshot_path
        || marker.cef_request_context_path != cef_request_context_path
    {
        return Err("profile migration marker belongs to a different selected profile".into());
    }
    let expected_staging_parent = user_data_path.join(MIGRATION_DIRECTORY);
    let staging_name = marker
        .staging_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "profile migration marker has an invalid staging path".to_string())?;
    let Some(owner_and_id) = staging_name.strip_prefix(".electron-guest-partition-stage-") else {
        return Err("profile migration marker has an invalid staging path".into());
    };
    let Some((owner, id)) = owner_and_id.split_once('-') else {
        return Err("profile migration marker has an invalid staging path".into());
    };
    if marker.staging_path.parent() != Some(expected_staging_parent.as_path())
        || owner.parse::<u32>().is_err()
        || id.parse::<u64>().is_err()
    {
        return Err("profile migration marker has an invalid staging path".into());
    }
    Ok(())
}

fn write_marker_create_only(path: &Path, marker: &MigrationMarker) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "profile migration marker has no parent".to_string())?;
    let bytes = serde_json::to_vec_pretty(marker)
        .map_err(|error| format!("could not encode profile migration marker: {error}"))?;
    let temporary_path = loop {
        let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(
            ".profile-migration-marker-{}-{id}.tmp",
            std::process::id()
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                file.write_all(&bytes)
                    .and_then(|()| file.sync_all())
                    .map_err(|error| {
                        format!("could not stage profile migration marker: {error}")
                    })?;
                break candidate;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("could not stage profile migration marker: {error}")),
        }
    };

    let link_result = fs::hard_link(&temporary_path, path);
    let remove_result = fs::remove_file(&temporary_path);
    link_result.map_err(|error| {
        format!("could not atomically publish profile migration marker: {error}")
    })?;
    remove_result
        .map_err(|error| format!("could not remove temporary profile migration marker: {error}"))?;
    Ok(())
}

fn finish_pending_migration(
    marker: &MigrationMarker,
    pending_marker_path: &Path,
    complete_marker_path: &Path,
) -> Result<(), String> {
    if crate::legacy_exporter::legacy_profile_is_active(&marker.electron_user_data_path)? {
        return Err("The selected Electron profile became active during migration".into());
    }

    if !ensure_source_directory(&marker.electron_user_data_path)?
        || !ensure_source_directory(
            &marker
                .electron_user_data_path
                .join(ELECTRON_PARTITIONS_DIRECTORY),
        )?
        || !ensure_source_directory(&marker.electron_partition_path)?
    {
        return Err("The selected Electron profile is missing during migration recovery".into());
    }
    if digest_selection(&inspect_source(&marker.electron_partition_path)?)? != marker.source_digest
    {
        return Err("The selected Electron profile changed before migration recovery".into());
    }

    if let Some(expected_digest) = &marker.snapshot_digest {
        install_or_verify_directory(
            &marker.staging_path.join("snapshot"),
            &marker.snapshot_path,
            expected_digest,
        )?;
    }
    if let Some(expected_digest) = &marker.cef_profile_digest {
        install_or_verify_directory(
            &marker.staging_path.join("cef-profile"),
            &marker.cef_request_context_path,
            expected_digest,
        )?;
    }

    write_marker_create_only(complete_marker_path, marker)?;
    match fs::remove_file(pending_marker_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "could not retire pending profile migration marker: {error}"
            ));
        }
    }
    cleanup_staging_directory(&marker.staging_path)?;
    Ok(())
}

fn install_or_verify_directory(
    staging_path: &Path,
    destination_path: &Path,
    expected_digest: &str,
) -> Result<(), String> {
    let staging_exists = path_exists_without_symlink(staging_path)?;
    let destination_exists = path_exists_without_symlink(destination_path)?;

    if destination_exists {
        let destination_digest = digest_tree(destination_path)?;
        if destination_digest == expected_digest {
            if staging_exists {
                if digest_tree(staging_path)? != expected_digest {
                    return Err("staged profile data does not match its pending marker".into());
                }
                fs::remove_dir_all(staging_path).map_err(|error| {
                    format!("could not remove duplicate staged profile data: {error}")
                })?;
            }
            return Ok(());
        }
        if !directory_is_empty(destination_path)? {
            return Err(format!(
                "refusing to overwrite populated CEF profile data: {}",
                destination_path.display()
            ));
        }
    }

    if !staging_exists || digest_tree(staging_path)? != expected_digest {
        return Err("staged profile data is missing or does not match its pending marker".into());
    }
    if destination_exists {
        fs::remove_dir(destination_path)
            .map_err(|error| format!("could not remove empty profile destination: {error}"))?;
    }
    fs::rename(staging_path, destination_path)
        .map_err(|error| format!("could not install staged profile data: {error}"))
}

fn path_exists_without_symlink(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "profile migration path must not be a symlink: {}",
            path.display()
        )),
        Ok(metadata) if metadata.is_dir() => Ok(true),
        Ok(_) => Err(format!(
            "profile migration path is not a directory: {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("could not inspect profile migration path: {error}")),
    }
}

fn directory_is_empty(path: &Path) -> Result<bool, String> {
    let mut entries = fs::read_dir(path)
        .map_err(|error| format!("could not inspect profile destination: {error}"))?;
    Ok(entries.next().is_none())
}

fn cleanup_staging_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err("profile migration staging path is not a real directory".into())
        }
        Ok(_) => fs::remove_dir(path).map_err(|error| {
            format!("could not remove empty profile migration staging directory: {error}")
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "could not inspect profile migration staging path: {error}"
        )),
    }
}

fn remove_pending_after_completion(
    pending_path: &Path,
    complete_marker: &MigrationMarker,
) -> Result<(), String> {
    let Some(pending) = read_marker(pending_path)? else {
        return Ok(());
    };
    if pending.electron_user_data_path != complete_marker.electron_user_data_path
        || pending.electron_partition_path != complete_marker.electron_partition_path
        || pending.user_data_path != complete_marker.user_data_path
        || pending.snapshot_path != complete_marker.snapshot_path
        || pending.cef_request_context_path != complete_marker.cef_request_context_path
    {
        return Err("pending profile migration marker conflicts with its completion marker".into());
    }
    fs::remove_file(pending_path)
        .map_err(|error| format!("could not remove completed pending migration marker: {error}"))
}

fn process_is_running(process_id: u32) -> Result<bool, String> {
    if process_id == 0 || process_id == std::process::id() {
        return Ok(true);
    }
    #[cfg(unix)]
    {
        let status = Command::new("kill")
            .args(["-0", &process_id.to_string()])
            .status()
            .map_err(|error| format!("could not verify profile migration owner: {error}"))?;
        return Ok(status.success());
    }
    #[cfg(not(unix))]
    {
        let _ = Command::new("kill");
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GuestProfileMigrationOutcome, MigrationMarker, SNAPSHOT_METADATA, copy_cookie_snapshot,
        copy_web_storage, create_staging_directory, digest_selection, digest_tree, inspect_source,
        migrate_selected_profile, write_marker_create_only,
    };
    use serde_json::Value;
    use std::fs;
    use std::path::{Path, PathBuf};

    struct Fixture {
        root: PathBuf,
        electron_user_data: PathBuf,
        partition: PathBuf,
        user_data: PathBuf,
        cef_profile: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "superset-guest-profile-migration-{}-{}",
                std::process::id(),
                NEXT_FIXTURE_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            ));
            fs::create_dir(&root).expect("create test root");
            let electron_user_data = root.join("electron-profile");
            let partition = electron_user_data.join("Partitions/superset");
            let user_data = root.join("native-profile");
            let cef_profile = user_data.join("cef/DataStore-73757065-7273-6574-2d62-726f77736572");
            fs::create_dir_all(&partition).expect("create Electron partition");
            fs::create_dir_all(user_data.join("cef")).expect("create CEF cache root");
            Self {
                root,
                electron_user_data,
                partition,
                user_data,
                cef_profile,
            }
        }

        fn migrate(&self) -> Result<GuestProfileMigrationOutcome, String> {
            migrate_selected_profile(
                &self.electron_user_data,
                "Superset",
                &self.user_data,
                &self.cef_profile,
            )
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    static NEXT_FIXTURE_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn write_fixture_data(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create fixture parent");
        }
        fs::write(path, bytes).expect("write fixture data");
    }

    #[test]
    fn migrates_root_cookies_and_web_storage_to_their_consumers() {
        let fixture = Fixture::new();
        write_fixture_data(&fixture.partition.join("Cookies"), b"cookie-db");
        write_fixture_data(&fixture.partition.join("Cookies-wal"), b"cookie-wal");
        write_fixture_data(&fixture.partition.join("Cookies-shm"), b"cookie-shm");
        write_fixture_data(
            &fixture.partition.join("Local Storage/leveldb/CURRENT"),
            b"local-storage",
        );
        write_fixture_data(
            &fixture
                .partition
                .join("IndexedDB/https_example.test_0.indexeddb.leveldb/CURRENT"),
            b"indexed-db",
        );

        assert_eq!(
            fixture.migrate().unwrap(),
            GuestProfileMigrationOutcome::Migrated
        );
        let snapshot = fixture.user_data.join("migration/electron-guest-partition");
        assert_eq!(fs::read(snapshot.join("Cookies")).unwrap(), b"cookie-db");
        assert_eq!(
            fs::read(snapshot.join("Cookies-wal")).unwrap(),
            b"cookie-wal"
        );
        assert_eq!(
            fs::read(snapshot.join("Cookies-shm")).unwrap(),
            b"cookie-shm"
        );
        let metadata: Value =
            serde_json::from_slice(&fs::read(snapshot.join(SNAPSHOT_METADATA)).unwrap()).unwrap();
        assert_eq!(metadata["version"], 1);
        assert_eq!(metadata["source"], "electron-guest-partition");
        assert_eq!(metadata["keychain"]["service"], "Superset Safe Storage");
        assert_eq!(metadata["keychain"]["account"], "Superset");
        assert_eq!(
            fs::read(fixture.cef_profile.join("Local Storage/leveldb/CURRENT")).unwrap(),
            b"local-storage"
        );
        assert_eq!(
            fs::read(
                fixture
                    .cef_profile
                    .join("IndexedDB/https_example.test_0.indexeddb.leveldb/CURRENT")
            )
            .unwrap(),
            b"indexed-db"
        );
        assert_eq!(
            fixture.migrate().unwrap(),
            GuestProfileMigrationOutcome::AlreadyMigrated
        );
    }

    #[test]
    fn accepts_network_cookie_layout_and_keeps_restart_marker_atomic() {
        let fixture = Fixture::new();
        write_fixture_data(
            &fixture.partition.join("Network/Cookies"),
            b"network-cookie-db",
        );
        write_fixture_data(
            &fixture.partition.join("Network/Cookies-wal"),
            b"network-cookie-wal",
        );

        assert_eq!(
            fixture.migrate().unwrap(),
            GuestProfileMigrationOutcome::Migrated
        );
        let snapshot = fixture.user_data.join("migration/electron-guest-partition");
        assert_eq!(
            fs::read(snapshot.join("Cookies")).unwrap(),
            b"network-cookie-db"
        );
        assert_eq!(
            fs::read(snapshot.join("Cookies-wal")).unwrap(),
            b"network-cookie-wal"
        );
        assert!(
            fixture
                .user_data
                .join("migration/.electron-guest-partition.v1.json")
                .is_file()
        );
        assert!(
            !fixture
                .user_data
                .join("migration/.electron-guest-partition.pending.json")
                .exists()
        );
    }

    #[test]
    fn resumes_an_interrupted_install_without_replacing_the_installed_snapshot() {
        let fixture = Fixture::new();
        write_fixture_data(&fixture.partition.join("Cookies"), b"cookie-db");
        write_fixture_data(
            &fixture.partition.join("Local Storage/leveldb/CURRENT"),
            b"local-storage",
        );

        let migration_directory = fixture.user_data.join("migration");
        fs::create_dir(&migration_directory).expect("create migration directory");
        let snapshot_path = migration_directory.join("electron-guest-partition");
        let staging_path = create_staging_directory(&migration_directory).unwrap();
        let staging_snapshot_path = staging_path.join("snapshot");
        let staging_cef_path = staging_path.join("cef-profile");
        let selection = inspect_source(&fixture.partition).unwrap();
        let source_digest = digest_selection(&selection).unwrap();
        copy_cookie_snapshot(&selection, &staging_snapshot_path, "Superset").unwrap();
        copy_web_storage(&selection, &staging_cef_path).unwrap();

        let pending_marker_path =
            migration_directory.join(".electron-guest-partition.pending.json");
        let complete_marker_path = migration_directory.join(".electron-guest-partition.v1.json");
        let marker = MigrationMarker {
            version: super::MARKER_VERSION,
            owner_pid: u32::MAX,
            electron_user_data_path: fixture.electron_user_data.clone(),
            electron_partition_path: fixture.partition.clone(),
            user_data_path: fixture.user_data.clone(),
            snapshot_path: snapshot_path.clone(),
            cef_request_context_path: fixture.cef_profile.clone(),
            staging_path: staging_path.clone(),
            source_digest,
            snapshot_digest: Some(digest_tree(&staging_snapshot_path).unwrap()),
            cef_profile_digest: Some(digest_tree(&staging_cef_path).unwrap()),
        };
        write_marker_create_only(&pending_marker_path, &marker).unwrap();

        fs::rename(&staging_snapshot_path, &snapshot_path)
            .expect("simulate crash after installing the cookie snapshot");
        assert_eq!(
            fixture.migrate().unwrap(),
            GuestProfileMigrationOutcome::Migrated
        );

        assert_eq!(
            fs::read(snapshot_path.join("Cookies")).unwrap(),
            b"cookie-db"
        );
        assert_eq!(
            fs::read(fixture.cef_profile.join("Local Storage/leveldb/CURRENT")).unwrap(),
            b"local-storage"
        );
        assert!(complete_marker_path.is_file());
        assert!(!pending_marker_path.exists());
        assert!(!staging_path.exists());
        assert_eq!(
            fixture.migrate().unwrap(),
            GuestProfileMigrationOutcome::AlreadyMigrated
        );
    }

    #[test]
    fn does_not_resume_when_the_selected_electron_profile_changed() {
        let fixture = Fixture::new();
        write_fixture_data(&fixture.partition.join("Cookies"), b"cookie-db");

        let migration_directory = fixture.user_data.join("migration");
        fs::create_dir(&migration_directory).expect("create migration directory");
        let staging_path = create_staging_directory(&migration_directory).unwrap();
        let selection = inspect_source(&fixture.partition).unwrap();
        let source_digest = digest_selection(&selection).unwrap();
        let staging_snapshot_path = staging_path.join("snapshot");
        copy_cookie_snapshot(&selection, &staging_snapshot_path, "Superset").unwrap();

        let marker = MigrationMarker {
            version: super::MARKER_VERSION,
            owner_pid: u32::MAX,
            electron_user_data_path: fixture.electron_user_data.clone(),
            electron_partition_path: fixture.partition.clone(),
            user_data_path: fixture.user_data.clone(),
            snapshot_path: migration_directory.join("electron-guest-partition"),
            cef_request_context_path: fixture.cef_profile.clone(),
            staging_path,
            source_digest,
            snapshot_digest: Some(digest_tree(&staging_snapshot_path).unwrap()),
            cef_profile_digest: None,
        };
        let pending_marker_path =
            migration_directory.join(".electron-guest-partition.pending.json");
        write_marker_create_only(&pending_marker_path, &marker).unwrap();
        write_fixture_data(&fixture.partition.join("Cookies"), b"newer-cookie-db");

        assert!(fixture.migrate().is_err());
        assert!(!marker.snapshot_path.exists());
        assert!(pending_marker_path.is_file());
    }

    #[test]
    fn does_not_overwrite_a_populated_cef_request_context() {
        let fixture = Fixture::new();
        write_fixture_data(
            &fixture.partition.join("IndexedDB/store/CURRENT"),
            b"electron-data",
        );
        write_fixture_data(&fixture.cef_profile.join("Keep/current"), b"cef-data");

        assert!(fixture.migrate().is_err());
        assert_eq!(
            fs::read(fixture.cef_profile.join("Keep/current")).unwrap(),
            b"cef-data"
        );
        assert!(
            !fixture
                .user_data
                .join("migration/electron-guest-partition.v1.json")
                .exists()
        );
    }

    #[test]
    fn does_not_follow_symlinked_storage() {
        let fixture = Fixture::new();
        write_fixture_data(&fixture.root.join("outside/CURRENT"), b"outside");
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            fixture.root.join("outside"),
            fixture.partition.join("IndexedDB"),
        )
        .expect("create fixture symlink");

        #[cfg(unix)]
        assert!(fixture.migrate().is_err());
        #[cfg(not(unix))]
        assert_eq!(
            fixture.migrate().unwrap(),
            GuestProfileMigrationOutcome::NotNeeded
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_an_active_selected_electron_profile() {
        let fixture = Fixture::new();
        write_fixture_data(&fixture.partition.join("Cookies"), b"cookie-db");
        let lock_target = fixture
            .electron_user_data
            .join(format!("localhost-{}", std::process::id()));
        std::os::unix::fs::symlink(
            lock_target,
            fixture.electron_user_data.join("SingletonLock"),
        )
        .expect("create active profile lock fixture");

        assert!(fixture.migrate().is_err());
        assert!(
            !fixture
                .user_data
                .join("migration/electron-guest-partition")
                .exists()
        );
    }

    #[test]
    fn leaves_absent_partitions_untouched() {
        let fixture = Fixture::new();
        let _ = fs::remove_dir_all(&fixture.partition);

        assert_eq!(
            fixture.migrate().unwrap(),
            GuestProfileMigrationOutcome::NotNeeded
        );
        assert!(!fixture.user_data.join("migration").exists());
    }
}
