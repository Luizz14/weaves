use crate::browser::popup_policy::{OpenTarget, classify_open};
use crate::node_host::{NativeEvent, NativeRequest, NodeHost};
use crate::profile_migration::ProfileMigration;
use crate::window_registry::{PersistedWindow, WindowRegistry, WindowState};
use base64::Engine;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;
use tauri::async_runtime::spawn_blocking;
use tauri::image::Image;
use tauri::menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse};
use tauri::{
    AppHandle, Emitter, EventTarget, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_runtime_cef::{
    AsCefWindowOpener, RemoteDebugging, RuntimeStyle, WebviewCefExt, WebviewWindowBuilderCefExt,
    allocate_devtools_message_id,
};
use url::Url;

const APP_NAME: &str = "Superset";
const PERSONAL_INSTALL_BUILD: bool = cfg!(tauri_personal_install);
const DATA_STORE_IDENTIFIER: [u8; 16] = *b"superset-cef-v1\0";
const DEFAULT_DEV_PORT: u16 = 5173;
static NEXT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

fn protocol_scheme() -> String {
    let workspace = env::var("SUPERSET_WORKSPACE_NAME")
        .ok()
        .map(|name| {
            name.to_ascii_lowercase()
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() || character == '-' {
                        character
                    } else {
                        '-'
                    }
                })
                .collect::<String>()
        })
        .filter(|name| !name.is_empty() && name != "superset")
        .map(|name| name.chars().take(32).collect::<String>());
    workspace
        .map(|name| format!("superset-{name}"))
        .unwrap_or_else(|| "superset".into())
}

fn protocol_schemes(config: &tauri::Config) -> Vec<String> {
    let configured = config
        .plugins
        .0
        .get("deep-link")
        .and_then(|plugin| plugin.get("desktop"))
        .and_then(|desktop| desktop.get("schemes"))
        .and_then(Value::as_array)
        .map(|schemes| {
            schemes
                .iter()
                .filter_map(Value::as_str)
                .filter(|scheme| !scheme.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|schemes| !schemes.is_empty())
        .unwrap_or_else(|| vec![protocol_scheme()]);
    let mut schemes = configured;
    if !schemes.iter().any(|scheme| scheme == "superset") {
        schemes.push("superset".into());
    }
    schemes
}

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub product_name: String,
    pub app_path: PathBuf,
    pub resource_path: PathBuf,
    pub superset_home_path: PathBuf,
    pub legacy_profile_path: PathBuf,
    pub user_data_path: PathBuf,
    pub session_data_path: PathBuf,
    pub cache_path: PathBuf,
    pub node_binary: PathBuf,
    pub node_service_entry: PathBuf,
    pub protocol_schemes: Vec<String>,
    pub dev_port: Option<u16>,
    pub is_packaged: bool,
}

#[derive(Clone)]
pub struct NativeState {
    pub node: NodeHost,
    pub windows: WindowRegistry,
    pub paths: AppPaths,
    pub quitting: Arc<AtomicBool>,
    pub migration: ProfileMigration,
    pub closing_windows: Arc<Mutex<HashSet<String>>>,
    pub force_full_cleanup: Arc<AtomicBool>,
    pub pending_update: Arc<Mutex<Option<(Update, Vec<u8>)>>>,
    pub skip_quit_confirmation: Arc<AtomicBool>,
    pub permission_snapshot: Arc<Mutex<HashMap<String, Value>>>,
    context_menu_targets: Arc<Mutex<HashMap<String, ContextMenuTarget>>>,
}

#[derive(Clone)]
struct ContextMenuTarget {
    window_label: String,
    registered_at: std::time::Instant,
}

impl NativeState {
    pub fn emit_node_event(&self, name: &str, payload: Value, window_label: Option<String>) {
        if let Err(error) = self.node.send_event(name, payload, window_label) {
            eprintln!("[native] failed to send {name} event to Node: {error}");
        }
    }
}

pub fn resolve_paths(app: &AppHandle) -> Result<AppPaths, String> {
    let home =
        dirs::home_dir().ok_or_else(|| "Could not resolve the user home directory".to_string())?;
    let app_path = absolute_path(
        env::var_os("SUPERSET_APP_PATH")
            .map(PathBuf::from)
            .or_else(|| {
                tauri::is_dev().then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
            })
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(Path::to_path_buf))
            })
            .unwrap_or_else(|| PathBuf::from(".")),
    );
    let product_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| app.package_info().name.clone());
    let user_data_path = resolve_user_data_path(&home, &app_path, &product_name);
    let legacy_profile_path = resolve_legacy_profile_path(&home, &app_path, &product_name);
    let superset_home_path = absolute_path(
        env::var_os("SUPERSET_HOME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(default_superset_home_name())),
    );
    fs::create_dir_all(&user_data_path)
        .map_err(|error| format!("failed to create Superset home: {error}"))?;

    let resource_path = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| app_path.clone());
    let session_data_path = user_data_path.clone();
    let cache_path = user_data_path.join("cef");
    fs::create_dir_all(&cache_path)
        .map_err(|error| format!("failed to create CEF profile directory: {error}"))?;

    let node_binary = resolve_node_binary(&resource_path, tauri::is_dev());
    let node_service_entry = resolve_node_entry(&resource_path, tauri::is_dev());
    let dev_port = if env::var("NODE_ENV").ok().as_deref() == Some("development")
        || env::var_os("DESKTOP_VITE_PORT").is_some()
    {
        env::var("DESKTOP_VITE_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .or(Some(DEFAULT_DEV_PORT))
    } else {
        None
    };
    let is_packaged = !tauri::is_dev();

    Ok(AppPaths {
        product_name,
        app_path,
        resource_path,
        superset_home_path,
        legacy_profile_path,
        user_data_path,
        session_data_path,
        cache_path,
        node_binary,
        node_service_entry,
        protocol_schemes: protocol_schemes(app.config()),
        dev_port,
        is_packaged,
    })
}

fn default_superset_home_name() -> String {
    let workspace = env::var("SUPERSET_WORKSPACE_NAME")
        .ok()
        .map(|name| {
            name.to_ascii_lowercase()
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() || character == '-' {
                        character
                    } else {
                        '-'
                    }
                })
                .collect::<String>()
        })
        .filter(|name| !name.is_empty() && name != "superset")
        .map(|name| name.chars().take(32).collect::<String>());
    workspace
        .map(|name| format!(".superset-{name}"))
        .unwrap_or_else(|| ".superset".into())
}

fn resolve_user_data_path(home: &Path, app_path: &Path, configured_product_name: &str) -> PathBuf {
    let app_data = match std::env::consts::OS {
        "macos" => home.join("Library/Application Support"),
        "windows" => env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Roaming")),
        _ => env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config")),
    };
    if !tauri::is_dev() {
        return app_data.join(configured_product_name);
    }
    resolve_workspace_profile_path(&app_data, app_path)
}

fn resolve_legacy_profile_path(home: &Path, app_path: &Path, product_name: &str) -> PathBuf {
    let app_data = match std::env::consts::OS {
        "macos" => home.join("Library/Application Support"),
        "windows" => env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Roaming")),
        _ => env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config")),
    };
    if !tauri::is_dev() {
        app_data.join(product_name)
    } else {
        resolve_workspace_profile_path(&app_data, app_path)
    }
}

fn resolve_workspace_profile_path(app_data: &Path, app_path: &Path) -> PathBuf {
    let identity = env::var("SUPERSET_WORKSPACE_ID")
        .ok()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .map(|id| format!("id:{id}"))
        .unwrap_or_else(|| format!("path:{}", app_path.display()));
    let digest = Sha256::digest(identity.as_bytes());
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    app_data.join(format!("Superset Dev Workspace ({hex})"))
}

fn absolute_path(path: PathBuf) -> PathBuf {
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map(|directory| directory.join(path))
            .unwrap_or_else(|_| PathBuf::from("/"))
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn resolve_node_binary(resource_path: &Path, is_dev: bool) -> PathBuf {
    if is_dev {
        if let Some(path) = env::var_os("SUPERSET_NODE_BINARY") {
            return PathBuf::from(path);
        }
    }
    let candidates = [
        resource_path.join("node/bin/node"),
        resource_path.join("bin/node"),
    ];
    if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
        return PathBuf::from(path);
    }
    if is_dev {
        PathBuf::from("node")
    } else {
        resource_path.join("node/bin/node")
    }
}

fn resolve_node_entry(resource_path: &Path, is_dev: bool) -> PathBuf {
    if is_dev {
        if let Some(path) = env::var_os("SUPERSET_NODE_SERVICE_ENTRY") {
            return PathBuf::from(path);
        }
    }
    let candidates = [
        resource_path.join("main/desktop-service.cjs"),
        resource_path.join("dist/main/desktop-service.cjs"),
    ];
    if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
        return path;
    }
    if is_dev {
        PathBuf::from("dist/main/desktop-service.cjs")
    } else {
        resource_path.join("main/desktop-service.cjs")
    }
}

pub fn bootstrap_payload(app: &AppHandle, paths: &AppPaths) -> Value {
    let version = app.package_info().version.to_string();
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let preferred_languages = env::var("LANG")
        .ok()
        .map(|language| {
            language
                .split('.')
                .next()
                .unwrap_or(&language)
                .replace('_', "-")
        })
        .filter(|language| !language.is_empty())
        .map(|language| vec![language])
        .unwrap_or_else(|| vec!["en-US".into()]);
    json!({
        "schemaVersion": 1,
        "appName": paths.product_name,
        "appVersion": version,
        "isPackaged": paths.is_packaged,
        "paths": {
            "appPath": paths.app_path,
            "resourcePath": paths.resource_path,
            "userDataPath": paths.user_data_path,
            "sessionDataPath": paths.session_data_path,
            "downloads": dirs::download_dir().unwrap_or_else(|| paths.user_data_path.join("Downloads")),
        },
        "platform": platform,
        "arch": match std::env::consts::ARCH {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            other => other,
        },
        "preferredLanguages": preferred_languages,
        "permissions": initial_permission_snapshot(),
        "runtime": "tauri",
    })
}

pub fn create_main_window(
    app: &AppHandle,
    state: &NativeState,
    persisted: Option<PersistedWindow>,
) -> Result<WebviewWindow, String> {
    let (label, key, org_id, window_state) = persisted
        .map(|window| ("main".to_string(), window.key, window.org_id, window.state))
        .unwrap_or_else(|| {
            (
                "main".to_string(),
                "legacy-single-window".into(),
                None,
                WindowState::default(),
            )
        });
    create_window(app, state, &label, key, org_id, window_state, true)
}

pub fn create_window(
    app: &AppHandle,
    state: &NativeState,
    label: &str,
    key: String,
    org_id: Option<String>,
    state_snapshot: WindowState,
    show: bool,
) -> Result<WebviewWindow, String> {
    if state.windows.is_registered(label) {
        return app
            .get_webview_window(label)
            .ok_or_else(|| format!("registered window {label} is unavailable"));
    }
    let label = sanitize_label(label);
    let host_for_load = state.node.clone();
    let host_for_navigation = state.node.clone();
    let host_for_popup = state.node.clone();
    let windows_for_load = state.windows.clone();
    let windows_for_navigation = state.windows.clone();
    let windows_for_permission = state.windows.clone();
    let expected_dev_port = state.paths.dev_port;
    let protocol_schemes_for_popup = state.paths.protocol_schemes.clone();
    let window_label = label.clone();
    let navigation_label = window_label.clone();
    let title = env::var("SUPERSET_WORKSPACE_NAME")
        .ok()
        .filter(|name| !name.is_empty() && name != "superset")
        .map(|name| format!("{APP_NAME} — {name}"))
        .unwrap_or_else(|| APP_NAME.into());
    let width = state_snapshot.width.max(400) as f64;
    let height = state_snapshot.height.max(400) as f64;

    let mut builder = WebviewWindowBuilder::new(app, label.clone(), WebviewUrl::default())
        .title(title)
        .inner_size(width, height)
        .min_inner_size(400.0, 400.0)
        .visible(false)
        .resizable(true)
        .maximizable(true)
        .minimizable(true)
        .closable(true)
        .accept_first_mouse(true)
        .data_store_identifier(DATA_STORE_IDENTIFIER)
        .use_https_scheme(true)
        .browser_runtime_style(RuntimeStyle::Alloy)
        .on_navigation(move |url| {
            let allowed = is_window_navigation_allowed(url, expected_dev_port);
            if allowed {
                let _ = windows_for_navigation.mark_page(&navigation_label, url);
            } else {
                let _ = host_for_navigation.send_event(
                    "navigation:blocked",
                    json!({"url": url.as_str()}),
                    Some(navigation_label.clone()),
                );
            }
            allowed
        })
        .on_page_load(move |window, payload| {
            let label = window.label().to_string();
            let _ = windows_for_load.mark_page(&label, payload.url());
            let event = match payload.event() {
                PageLoadEvent::Started => "window:renderer-loading",
                PageLoadEvent::Finished => "window:renderer-ready",
            };
            let _ = host_for_load.send_event(
                event,
                json!({"label": label, "url": payload.url().as_str()}),
                Some(label.clone()),
            );
            if payload.event() == PageLoadEvent::Started {
                let _ = host_for_load.send_event(
                    "window:reloaded",
                    json!({"label": label}),
                    Some(label.clone()),
                );
            }
        })
        .on_document_title_changed(move |window, title| {
            let _ = window.set_title(&title);
        })
        .on_permission_request(move |webview, kind| {
            // CEF invokes this callback on its UI thread. The current-URL getter
            // performs a synchronous CEF IPC round-trip and can deadlock that thread while a
            // permission prompt is being created. Navigation/page-load callbacks
            // already keep the registry's URL and trust bit current, so use only
            // that cached identity here.
            let is_trusted_app_document = windows_for_permission.is_trusted_label(webview.label());
            if is_trusted_app_document {
                permission_response(kind)
            } else {
                PermissionResponse::Deny
            }
        })
        .on_new_window(move |url, features| {
            let disposition = features
                .opener()
                .as_cef_window_opener()
                .map(|opener| opener.disposition())
                .unwrap_or(tauri_runtime_cef::cef::WindowOpenDisposition::UNKNOWN);
            let target = classify_open(&url, disposition, &protocol_schemes_for_popup);
            match target {
                OpenTarget::Popup => NewWindowResponse::Allow,
                OpenTarget::DeepLink => {
                    let _ = host_for_popup.send_event(
                        "deep-link",
                        json!({"url": url.as_str()}),
                        Some(window_label.clone()),
                    );
                    NewWindowResponse::Deny
                }
                OpenTarget::Pane => {
                    let _ = host_for_popup.send_event(
                        "browser:new-window",
                        json!({"url": url.as_str(), "opener": window_label}),
                        Some(window_label.clone()),
                    );
                    NewWindowResponse::Deny
                }
                OpenTarget::Deny => NewWindowResponse::Deny,
            }
        });

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 16.0));
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(true);
    }
    if state_snapshot.is_maximized {
        builder = builder.maximized(true);
    }
    if show {
        builder = builder.focused(false);
    }
    let window = builder
        .build()
        .map_err(|error| format!("failed to create native window {label}: {error}"))?;
    state
        .windows
        .register(&window, key, org_id)
        .map_err(|error| format!("failed to register native window {label}: {error}"))?;
    if let Some(level) = state_snapshot.zoom_level {
        state.windows.set_zoom_level(&label, level);
        let _ = window.set_zoom(1.2_f64.powf(level));
    }
    state.emit_node_event(
        "window:created",
        window_state_payload(&window, &state.windows),
        Some(label),
    );
    Ok(window)
}

fn sanitize_label(label: &str) -> String {
    let mut result = label
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .collect::<String>();
    if result.is_empty() {
        result = format!("window-{}", NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed));
    }
    result.chars().take(64).collect()
}

fn is_window_navigation_allowed(url: &Url, expected_dev_port: Option<u16>) -> bool {
    if url.scheme() == "about" && url.path() == "blank" {
        return true;
    }
    if url.scheme() == "tauri" && url.host_str() == Some("localhost") {
        return true;
    }
    if matches!(url.scheme(), "http" | "https")
        && url.host_str() == Some("tauri.localhost")
        && url.port().is_none()
    {
        return true;
    }
    matches!(url.scheme(), "http" | "https")
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        && expected_dev_port.is_some_and(|port| url.port() == Some(port))
}

fn permission_response(kind: PermissionKind) -> PermissionResponse {
    match kind {
        PermissionKind::Notifications | PermissionKind::Geolocation => PermissionResponse::Allow,
        PermissionKind::Camera => PermissionResponse::Deny,
        PermissionKind::Microphone => PermissionResponse::Default,
        PermissionKind::DisplayCapture => PermissionResponse::Default,
        _ => PermissionResponse::Default,
    }
}

fn window_state_payload(window: &WebviewWindow, registry: &WindowRegistry) -> Value {
    let (x, y) = window
        .outer_position()
        .map(|position| {
            let scale = window.scale_factor().ok().unwrap_or(1.0).max(0.1);
            (
                ((position.x as f64) / scale).round() as i32,
                ((position.y as f64) / scale).round() as i32,
            )
        })
        .unwrap_or((0, 0));
    let (width, height) = window
        .inner_size()
        .map(|size| {
            let scale = window.scale_factor().ok().unwrap_or(1.0).max(0.1);
            (
                ((size.width as f64) / scale).round() as u32,
                ((size.height as f64) / scale).round() as u32,
            )
        })
        .unwrap_or((1280, 800));
    let maximized = window.is_maximized().ok().unwrap_or(false);
    let zoom_level = registry.zoom_level(window.label()).unwrap_or(0.0);
    let mut payload = json!({
        "label": window.label(),
        "id": registry.generation(window.label()).unwrap_or(1),
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "maximized": maximized,
        "minimized": false,
        "fullscreen": false,
        "zoomLevel": zoom_level,
        "zoomFactor": 1.2_f64.powf(zoom_level),
        "focused": window.is_focused().ok().unwrap_or(false),
        "destroyed": false,
    });
    if let Some(url) = registry
        .record(window.label())
        .and_then(|record| record.current_url)
    {
        payload["url"] = Value::String(url.to_string());
    }
    payload
}

pub fn handle_node_request(
    app: &AppHandle,
    state: &NativeState,
    request: NativeRequest,
) -> Result<Value, String> {
    let window_label = request.window_label.clone();
    if let Some(message) = updater_command_error(&request.method, PERSONAL_INSTALL_BUILD) {
        return Err(message.into());
    }
    if request.method.starts_with("browser.") {
        let label = window_label
            .as_deref()
            .ok_or_else(|| "browser native request requires a trusted window label".to_string())?;
        trusted_webview(app, state, label)?;
        return crate::browser::dispatch(app, label, &request.method, request.params);
    }
    match request.method.as_str() {
        "app.bootstrap" => Ok(bootstrap_payload(app, &state.paths)),
        "app.rendererReady" => {
            let label = request
                .window_label
                .clone()
                .ok_or_else(|| "rendererReady requires a trusted window label".to_string())?;
            let window = trusted_webview(app, state, &label)?;
            window
                .show()
                .map_err(|error| format!("failed to show renderer: {error}"))?;
            window
                .set_focus()
                .map_err(|error| format!("failed to focus renderer: {error}"))?;
            #[cfg(target_os = "macos")]
            invalidate_window(&window)?;
            state.emit_node_event("window:ready", json!({"label": label}), Some(label));
            Ok(Value::Null)
        }
        "app.rendererBootFailed" => {
            let label = request
                .window_label
                .clone()
                .ok_or_else(|| "rendererBootFailed requires a trusted window label".to_string())?;
            let window = trusted_webview(app, state, &label)?;
            let _ = window.show();
            let _ = window.set_focus();
            state.emit_node_event("window:renderer-boot-failed", request.params, Some(label));
            Ok(Value::Null)
        }
        "window.create" => {
            let options = as_object(&request.params)?;
            let requested = options
                .get("label")
                .or_else(|| options.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("main");
            let label = if requested == "main" && state.windows.is_registered("main") {
                format!("window-{}", NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed))
            } else {
                sanitize_label(requested)
            };
            let state_snapshot = parse_window_state(options);
            let key = options
                .get("key")
                .and_then(Value::as_str)
                .unwrap_or(&label)
                .to_string();
            let org_id = options
                .get("orgId")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let window = create_window(app, state, &label, key, org_id, state_snapshot, true)?;
            Ok(window_state_payload(&window, &state.windows))
        }
        "window.close" => {
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            let window = app
                .get_webview_window(&label)
                .ok_or_else(|| format!("window {label} not found"))?;
            let _ = window.close();
            Ok(Value::Null)
        }
        "window.show"
        | "window.hide"
        | "window.focus"
        | "window.restore"
        | "window.minimize"
        | "window.maximize"
        | "window.unmaximize"
        | "window.reload"
        | "window.reloadIgnoringCache" => {
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            let window = app
                .get_webview_window(&label)
                .ok_or_else(|| format!("window {label} not found"))?;
            match request.method.as_str() {
                "window.show" => window.show(),
                "window.hide" => window.hide(),
                "window.focus" => window.set_focus(),
                "window.restore" => window.unminimize(),
                "window.minimize" => window.minimize(),
                "window.maximize" => window.maximize(),
                "window.unmaximize" => window.unmaximize(),
                "window.reload" => {
                    state.emit_node_event(
                        "window:reload",
                        json!({"label": label}),
                        Some(label.clone()),
                    );
                    window.reload()
                }
                "window.reloadIgnoringCache" => match allocate_devtools_message_id() {
                    Ok(id) => window.send_dev_tools_message(
                        json!({"id":id,"method":"Page.reload","params":{"ignoreCache":true}})
                            .to_string()
                            .as_bytes(),
                    ),
                    Err(_) => window.reload(),
                },
                _ => return Err("unsupported native window operation".into()),
            }
            .map_err(|error| format!("{} failed: {error}", request.method))?;
            #[cfg(target_os = "macos")]
            if matches!(request.method.as_str(), "window.show" | "window.restore") {
                invalidate_window(&window)?;
            }
            Ok(window_state_payload(&window, &state.windows))
        }
        "window.invalidate" => {
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            let window = trusted_webview(app, state, &label)?;
            invalidate_window(&window)?;
            Ok(Value::Null)
        }
        "window.setBackgroundThrottling" => {
            let enabled = as_object(&request.params)?
                .get("enabled")
                .and_then(Value::as_bool)
                .ok_or_else(|| "window.setBackgroundThrottling requires enabled".to_string())?;
            if enabled {
                Err("CEF background timer throttling cannot be enabled per window".into())
            } else {
                #[cfg(target_os = "macos")]
                {
                    Ok(json!({"enabled": false, "scope": "runtime"}))
                }
                #[cfg(not(target_os = "macos"))]
                {
                    Err("disabling background throttling is unsupported on this platform".into())
                }
            }
        }
        "window.setOpenPolicy" => {
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            trusted_webview(app, state, &label)?;
            let policy = as_object(&request.params)?
                .get("policy")
                .and_then(Value::as_str)
                .ok_or_else(|| "window.setOpenPolicy requires policy".to_string())?;
            if policy != "native" {
                return Err("only the native window-open policy is supported".into());
            }
            Ok(json!({"policy": "native", "enforced": true}))
        }
        "window.setZoomLevel" => {
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            let level = as_object(&request.params)?
                .get("level")
                .and_then(Value::as_f64)
                .ok_or_else(|| "window.setZoomLevel requires numeric level".to_string())?;
            let window = app
                .get_webview_window(&label)
                .ok_or_else(|| format!("window {label} not found"))?;
            state.windows.set_zoom_level(&label, level);
            window
                .set_zoom(1.2_f64.powf(level))
                .map_err(|error| format!("failed to set zoom: {error}"))?;
            Ok(Value::Null)
        }
        "window.setSize" => {
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            let options = as_object(&request.params)?;
            let width = options
                .get("width")
                .and_then(Value::as_f64)
                .ok_or_else(|| "window.setSize requires width".to_string())?;
            let height = options
                .get("height")
                .and_then(Value::as_f64)
                .ok_or_else(|| "window.setSize requires height".to_string())?;
            let window = app
                .get_webview_window(&label)
                .ok_or_else(|| format!("window {label} not found"))?;
            window
                .set_size(tauri::LogicalSize::new(width.max(400.0), height.max(400.0)))
                .map_err(|error| format!("failed to resize window: {error}"))?;
            Ok(window_state_payload(&window, &state.windows))
        }
        "window.restoreState" => {
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            let options = as_object(&request.params)?;
            let window = trusted_webview(app, state, &label)?;
            let snapshot = parse_window_state(options);
            window
                .set_position(tauri::LogicalPosition::new(
                    snapshot.x as f64,
                    snapshot.y as f64,
                ))
                .map_err(|error| format!("failed to restore window position: {error}"))?;
            window
                .set_size(tauri::LogicalSize::new(
                    snapshot.width as f64,
                    snapshot.height as f64,
                ))
                .map_err(|error| format!("failed to restore window size: {error}"))?;
            if snapshot.is_maximized {
                window.maximize().map_err(|error| error.to_string())?;
            } else {
                window.unmaximize().map_err(|error| error.to_string())?;
            }
            if let Some(level) = snapshot.zoom_level {
                state.windows.set_zoom_level(&label, level);
                window
                    .set_zoom(1.2_f64.powf(level))
                    .map_err(|error| error.to_string())?;
            }
            Ok(window_state_payload(&window, &state.windows))
        }
        "window.setTitle" => {
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            let title = as_object(&request.params)?
                .get("title")
                .and_then(Value::as_str)
                .ok_or_else(|| "window.setTitle requires title".to_string())?;
            let window = app
                .get_webview_window(&label)
                .ok_or_else(|| format!("window {label} not found"))?;
            window
                .set_title(title)
                .map_err(|error| format!("failed to set window title: {error}"))?;
            Ok(Value::Null)
        }
        "menu.setApplicationMenu" => {
            let template = as_object(&request.params)?
                .get("template")
                .ok_or_else(|| "menu.setApplicationMenu requires template".to_string())?;
            let menu = build_native_menu(app, template)?;
            app.set_menu(menu)
                .map_err(|error| format!("failed to set application menu: {error}"))?;
            Ok(Value::Null)
        }
        "menu.popupContext" => {
            let params = as_object(&request.params)?;
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            if window_label
                .as_deref()
                .is_some_and(|caller| caller != label)
            {
                return Err("menu.popupContext cannot target another window".into());
            }
            let window = trusted_webview(app, state, &label)?;
            let items = params
                .get("items")
                .ok_or_else(|| "menu.popupContext requires items".to_string())?;
            register_context_menu_targets(&state.context_menu_targets, items, &label)?;
            build_native_menu(app, items)?
                .popup(window.as_ref().window())
                .map_err(|error| format!("failed to open context menu: {error}"))?;
            Ok(Value::Null)
        }
        "tray.create" => {
            let options = as_object(&request.params)?;
            let tray_id = options
                .get("trayId")
                .or_else(|| options.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("superset-tray")
                .to_string();
            let menu = tray_menu(app).map_err(|error| error.to_string())?;
            let mut builder = TrayIconBuilder::with_id(tray_id.clone())
                .menu(&menu)
                .tooltip(
                    options
                        .get("tooltip")
                        .and_then(Value::as_str)
                        .unwrap_or(APP_NAME),
                );
            if let Some(path) = options.get("iconPath").and_then(Value::as_str) {
                if let Ok(icon) = Image::from_path(path) {
                    builder = builder.icon(icon).icon_as_template(true);
                }
            }
            builder
                .build(app)
                .map_err(|error| format!("failed to create tray icon: {error}"))?;
            Ok(json!({"id": tray_id}))
        }
        "tray.setMenu" => {
            let params = as_object(&request.params)?;
            let tray_id = params
                .get("trayId")
                .and_then(Value::as_str)
                .ok_or_else(|| "tray.setMenu requires trayId".to_string())?;
            let template = params
                .get("items")
                .ok_or_else(|| "tray.setMenu requires items".to_string())?;
            let menu = build_native_menu(app, template)?;
            let tray = app
                .tray_by_id(&tray_id.to_string())
                .ok_or_else(|| format!("tray {tray_id} not found"))?;
            tray.set_menu(Some(menu))
                .map_err(|error| format!("failed to update tray menu: {error}"))?;
            Ok(Value::Null)
        }
        "tray.destroy" => {
            if let Some(id) = as_object(&request.params)?
                .get("trayId")
                .and_then(Value::as_str)
            {
                let _ = app.remove_tray_by_id(&id.to_string());
            }
            Ok(Value::Null)
        }
        "app.setBadgeCount" => {
            let count = as_object(&request.params)?
                .get("count")
                .and_then(Value::as_i64)
                .unwrap_or(0)
                .max(0);
            if let Some(window) = focused_webview(app).or_else(|| app.get_webview_window("main")) {
                window
                    .set_badge_count((count > 0).then_some(count))
                    .map_err(|error| format!("failed to set badge count: {error}"))?;
            }
            Ok(Value::Null)
        }
        "app.setDockIcon" => {
            let params = as_object(&request.params)?;
            let icon = if let Some(path) = params.get("path").and_then(Value::as_str) {
                Image::from_path(path)
                    .map_err(|error| format!("failed to load dock icon: {error}"))?
            } else if let Some(data) = params.get("dataBase64").and_then(Value::as_str) {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .map_err(|error| format!("invalid dock icon data: {error}"))?;
                Image::from_bytes(&bytes)
                    .map_err(|error| format!("failed to decode dock icon: {error}"))?
            } else {
                return Err("app.setDockIcon requires path or dataBase64".into());
            };
            for window in app.webview_windows().values() {
                let _ = window.set_icon(icon.clone());
            }
            Ok(Value::Null)
        }
        "window.setTitleBarOverlay" => {
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            let window = app
                .get_webview_window(&label)
                .ok_or_else(|| format!("window {label} not found"))?;
            #[cfg(target_os = "macos")]
            window
                .set_title_bar_style(tauri::TitleBarStyle::Overlay)
                .map_err(|error| format!("failed to set titlebar overlay: {error}"))?;
            Ok(Value::Null)
        }
        "window.sendEvent" => {
            let options = as_object(&request.params)?;
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            let name = options
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| "window.sendEvent requires name".to_string())?;
            let payload = options.get("payload").cloned().unwrap_or(Value::Null);
            if window_label
                .as_deref()
                .is_some_and(|caller| caller != label)
            {
                return Err("window.sendEvent cannot target another window".into());
            }
            trusted_webview(app, state, &label)?;
            app.emit_to(
                EventTarget::webview(&label),
                "desktop:event",
                json!({"name": name, "payload": payload}),
            )
            .map_err(|error| format!("failed to send event to renderer: {error}"))?;
            Ok(Value::Null)
        }
        "dialog.open" => dialog_open(app, state, &request),
        "dialog.message" | "dialog.error" => dialog_message(
            app,
            state,
            &request.method,
            &request.params,
            window_label.as_deref(),
        ),
        "clipboard.readText" => clipboard_read_text(),
        "clipboard.writeText" => {
            let text = as_object(&request.params)?
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| "clipboard.writeText requires text".to_string())?;
            clipboard_write_text(text)
        }
        "notification.isSupported" => Ok(json!(crate::notifications::is_supported())),
        "notification.show" => crate::notifications::show(app, &state.node, &request.params),
        "notification.close" => crate::notifications::close(app, &state.node, &request.params),
        "permissions.status" => permissions_status(app, state),
        "permissions.requestMedia" => {
            let media_type = as_object(&request.params)?
                .get("mediaType")
                .and_then(Value::as_str)
                .unwrap_or("microphone");
            if media_type != "microphone" {
                return Err("only microphone permission requests are supported".into());
            }
            request_microphone(app, state)
        }
        "permissions.openSettings" => permissions_open_settings(&request.params),
        "shell.openExternal" => shell_open_external(&request.params),
        "window.replaceMisspelling" => {
            let label = resolve_window_label(&request.params, window_label.as_deref())?;
            let value = as_object(&request.params)?
                .get("value")
                .and_then(Value::as_str)
                .ok_or_else(|| "window.replaceMisspelling requires value".to_string())?;
            let window = trusted_webview(app, state, &label)?;
            window
                .eval(&format!(
                    "document.execCommand('insertText', false, {})",
                    serde_json::to_string(value).map_err(|error| error.to_string())?
                ))
                .map_err(|error| format!("failed to replace misspelling: {error}"))?;
            Ok(Value::Null)
        }
        "spell.addWord" => Err("CEF does not expose Chromium's custom dictionary API".into()),
        "shell.openPath" => {
            let path = crate::path_actions::validate_existing_absolute_path(
                as_object(&request.params)?
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "path is required".to_string())?,
                "path",
            )?;
            Ok(Value::String(crate::path_actions::open_path(&path)))
        }
        "shell.showItemInFolder" | "shell.showInFolder" => {
            let path = crate::path_actions::validate_existing_absolute_path(
                as_object(&request.params)?
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "path is required".to_string())?,
                "path",
            )?;
            crate::path_actions::show_item_in_folder(&path)?;
            Ok(Value::Null)
        }
        "shell.trashItem" => {
            let path = crate::path_actions::validate_existing_absolute_path(
                as_object(&request.params)?
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "path is required".to_string())?,
                "path",
            )?;
            crate::path_actions::trash_item(&path)?;
            Ok(Value::Null)
        }
        "shell.openFile" => shell_open_file(&request.params),
        "devtools.enable" => {
            if let Some(window) = focused_webview(app) {
                window.open_devtools();
            }
            Ok(json!({"enabled": true}))
        }
        "browser.tools.configure" => Ok(json!({
            "enabled": false,
            "reason": "CEF native browser tools are used instead of extension loading"
        })),
        "process.metrics" => process_metrics(),
        "app.activate" => {
            emit_app_activate(state);
            Ok(Value::Null)
        }
        "app.setQuitConfirmation" => {
            let enabled = as_object(&request.params)?
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            state
                .skip_quit_confirmation
                .store(!enabled, Ordering::Release);
            Ok(Value::Null)
        }
        "app.quit" => {
            let params = as_object(&request.params)?;
            let force = params
                .get("force")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let full_cleanup = params
                .get("fullCleanup")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if force || full_cleanup {
                state
                    .force_full_cleanup
                    .store(full_cleanup, Ordering::Release);
                state.quitting.store(true, Ordering::Release);
            }
            app.exit(0);
            Ok(Value::Null)
        }
        "app.quitCompletely" => {
            state.force_full_cleanup.store(true, Ordering::Release);
            state.quitting.store(true, Ordering::Release);
            app.exit(0);
            Ok(Value::Null)
        }
        "app.exit" => {
            let code = as_object(&request.params)?
                .get("code")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            state.quitting.store(true, Ordering::Release);
            app.exit(code as i32);
            Ok(Value::Null)
        }
        "app.relaunch" => {
            state.quitting.store(true, Ordering::Release);
            app.restart();
        }
        "app.restart" => {
            state.quitting.store(true, Ordering::Release);
            app.restart();
        }
        "updater.configure" => {
            if tauri::is_dev() {
                return Err("signed updater is unavailable in development builds".into());
            }
            Ok(json!({"configured": true}))
        }
        "updater.check" => {
            if tauri::is_dev() {
                return Err("signed updater is unavailable in development builds".into());
            }
            let feed_url = as_object(&request.params)?
                .get("feedUrl")
                .and_then(Value::as_str)
                .ok_or_else(|| "updater.check requires feedUrl".to_string())?
                .to_string();
            let app_handle = app.clone();
            let node = state.node.clone();
            let pending = state.pending_update.clone();
            tauri::async_runtime::spawn(async move {
                let _ = node.send_event("updater:status", json!({"status":"checking"}), None);
                let endpoint = match updater_endpoint(&feed_url) {
                    Ok(endpoint) => endpoint,
                    Err(error) => {
                        let _ = node.send_event(
                            "updater:error",
                            json!({"message": error.to_string()}),
                            None,
                        );
                        return;
                    }
                };
                let mut builder = app_handle.updater_builder();
                builder = match builder.endpoints(vec![endpoint]) {
                    Ok(builder) => builder,
                    Err(error) => {
                        let _ = node.send_event(
                            "updater:error",
                            json!({"message": error.to_string()}),
                            None,
                        );
                        return;
                    }
                };
                let updater = match builder.build() {
                    Ok(updater) => updater,
                    Err(error) => {
                        let _ = node.send_event(
                            "updater:error",
                            json!({"message": error.to_string()}),
                            None,
                        );
                        return;
                    }
                };
                match updater.check().await {
                    Ok(None) => {
                        let _ = node.send_event("updater:status", json!({"status":"idle"}), None);
                    }
                    Ok(Some(update)) => {
                        let version = update.version.clone();
                        let _ = node.send_event(
                            "updater:status",
                            json!({"status":"downloading","version":version}),
                            None,
                        );
                        match update
                            .download(|chunk, total| {
                                let transferred = chunk as u64;
                                let percent = total
                                    .filter(|total| *total > 0)
                                    .map(|total| (transferred as f64 / total as f64) * 100.0)
                                    .unwrap_or(0.0);
                                let _ = node.send_event(
                                    "updater:status",
                                    json!({"status":"downloading","version":version,"progress":{"percent":percent,"transferredBytes":transferred,"totalBytes":total.unwrap_or(0)}}),
                                    None,
                                );
                            }, || {})
                            .await
                        {
                            Ok(bytes) => {
                                if let Ok(mut pending) = pending.lock() {
                                    *pending = Some((update, bytes));
                                }
                                let _ = node.send_event(
                                    "updater:status",
                                    json!({"status":"ready","version":version}),
                                    None,
                                );
                            }
                            Err(error) => {
                                let _ = node.send_event("updater:error", json!({"message":error.to_string()}), None);
                            }
                        }
                    }
                    Err(error) => {
                        let _ = node.send_event(
                            "updater:error",
                            json!({"message":error.to_string()}),
                            None,
                        );
                    }
                }
            });
            Ok(Value::Null)
        }
        "updater.install" => {
            let pending = state.pending_update.clone();
            let app_handle = app.clone();
            let node = state.node.clone();
            state.quitting.store(true, Ordering::Release);
            tauri::async_runtime::spawn_blocking(move || {
                let update = pending.lock().ok().and_then(|mut pending| pending.take());
                let Some((update, bytes)) = update else {
                    let _ = node.send_event(
                        "updater:error",
                        json!({"message":"No verified update is ready to install"}),
                        None,
                    );
                    return;
                };
                if let Err(error) = update.restart_after_install(true).install(&bytes) {
                    let _ = node.send_event(
                        "updater:error",
                        json!({"message":error.to_string()}),
                        None,
                    );
                    return;
                }
                let _ = app_handle.exit(0);
            });
            Ok(Value::Null)
        }
        "profile.migration.status" => {
            serde_json::to_value(state.migration.status()).map_err(|error| error.to_string())
        }
        "profile.migration.ingest" => {
            serde_json::to_value(state.migration.ingest_export(request.params)?)
                .map_err(|error| error.to_string())
        }
        "profile.migration.claim" => {
            let params = as_object(&request.params)?;
            let migration_id = params
                .get("migrationId")
                .and_then(Value::as_str)
                .ok_or_else(|| "migrationId is required".to_string())?;
            let label = request
                .window_label
                .as_deref()
                .ok_or_else(|| "migration claim requires a trusted window label".to_string())?;
            trusted_webview(app, state, label)?;
            serde_json::to_value(state.migration.claim(migration_id, label)?)
                .map_err(|error| error.to_string())
        }
        "profile.migration.localStorageBatch" => {
            let params = as_object(&request.params)?;
            let migration_id = params
                .get("migrationId")
                .and_then(Value::as_str)
                .ok_or_else(|| "migrationId is required".to_string())?;
            let cursor = params.get("cursor").and_then(Value::as_u64).unwrap_or(0) as usize;
            let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(128) as usize;
            serde_json::to_value(state.migration.local_storage_batch(
                migration_id,
                cursor,
                limit,
            )?)
            .map_err(|error| error.to_string())
        }
        "profile.migration.indexedDbBatch" => {
            let params = as_object(&request.params)?;
            let migration_id = params
                .get("migrationId")
                .and_then(Value::as_str)
                .ok_or_else(|| "migrationId is required".to_string())?;
            let database = params
                .get("database")
                .and_then(Value::as_str)
                .ok_or_else(|| "database is required".to_string())?;
            let store = params
                .get("store")
                .and_then(Value::as_str)
                .ok_or_else(|| "store is required".to_string())?;
            let cursor = params.get("cursor").and_then(Value::as_u64).unwrap_or(0) as usize;
            let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(128) as usize;
            serde_json::to_value(state.migration.indexed_db_batch(
                migration_id,
                database,
                store,
                cursor,
                limit,
            )?)
            .map_err(|error| error.to_string())
        }
        "profile.migration.complete" | "profile.migrationComplete" => {
            let params = as_object(&request.params)?;
            let migration_id = params
                .get("migrationId")
                .and_then(Value::as_str)
                .ok_or_else(|| "migrationId is required".to_string())?;
            let token = params
                .get("ownerToken")
                .and_then(Value::as_str)
                .ok_or_else(|| "ownerToken is required".to_string())?;
            serde_json::to_value(state.migration.complete(migration_id, token)?)
                .map_err(|error| error.to_string())
        }
        "profile.migration.release" => {
            let token = as_object(&request.params)?
                .get("ownerToken")
                .and_then(Value::as_str)
                .ok_or_else(|| "ownerToken is required".to_string())?;
            state.migration.release(token)?;
            Ok(Value::Null)
        }
        _ => Err(format!("Unsupported native method: {}", request.method)),
    }
}

#[tauri::command]
pub async fn native_command(
    window: WebviewWindow,
    state: State<'_, NativeState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if !state.windows.is_trusted_window(&window) {
        return Err("native command caller is not a trusted app renderer".into());
    }
    let label = window.label().to_string();
    let app = window.app_handle().clone();
    let state = state.inner().clone();
    if method.starts_with("browser.") {
        return spawn_blocking(move || crate::browser::dispatch(&app, &label, &method, params))
            .await
            .map_err(|error| format!("browser command task failed: {error}"))?;
    }
    spawn_blocking(move || {
        handle_node_request(
            &app,
            &state,
            NativeRequest {
                id: "renderer-native-command".into(),
                method,
                params,
                window_label: Some(label),
            },
        )
    })
    .await
    .map_err(|error| format!("native command task failed: {error}"))?
}

#[tauri::command]
pub async fn desktop_rpc(
    window: WebviewWindow,
    state: State<'_, NativeState>,
    message: Value,
) -> Result<Value, String> {
    if !state.windows.is_trusted_window(&window) {
        return Err("desktop RPC caller is not a trusted app renderer".into());
    }
    let label = window.label().to_string();
    let node = state.node.clone();
    spawn_blocking(move || node.request("trpc", message, Some(label)))
        .await
        .map_err(|error| format!("desktop RPC task failed: {error}"))?
}

pub fn handle_window_event(
    app: &AppHandle,
    state: &NativeState,
    window: &tauri::Window,
    event: &WindowEvent,
) {
    let label = window.label().to_string();
    if label == "profile-migration" {
        return;
    }
    match event {
        WindowEvent::Focused(focused) => {
            state.emit_node_event("window:focus", json!({"focused": focused}), Some(label))
        }
        WindowEvent::Moved(position) => {
            let scale = window.scale_factor().ok().unwrap_or(1.0);
            let (x, y) = physical_position_to_logical(position.x, position.y, scale);
            state.emit_node_event("window:moved", json!({"x": x, "y": y}), Some(label));
        }
        WindowEvent::Resized(size) => {
            let scale = window.scale_factor().ok().unwrap_or(1.0);
            let (width, height) = physical_size_to_logical(size.width, size.height, scale);
            let maximized = window.is_maximized().ok().unwrap_or(false);
            state.emit_node_event(
                "window:resized",
                json!({"width": width, "height": height, "maximized": maximized}),
                Some(label),
            );
        }
        WindowEvent::CloseRequested { api, .. } => {
            if state.quitting.load(Ordering::Acquire) {
                return;
            }
            let label = window.label().to_string();
            let approved = state
                .closing_windows
                .lock()
                .ok()
                .map(|mut closing| closing.remove(&label))
                .unwrap_or(false);
            if approved {
                return;
            }
            api.prevent_close();
            let app_handle = app.clone();
            let state = state.clone();
            std::thread::spawn(move || {
                let decision = state.node.request_without_timeout(
                    "window.closeRequested",
                    json!({"windowLabel": label, "deadline": Value::Null}),
                    Some(label.clone()),
                );
                let allow = decision
                    .ok()
                    .and_then(|value| value.get("allow").and_then(Value::as_bool))
                    .unwrap_or(true);
                if !allow {
                    return;
                }
                if let Some(window) = app_handle.get_webview_window(&label) {
                    let snapshot = state.windows.capture_state(&window);
                    state.emit_node_event(
                        "window:closing",
                        json!({"label": label.clone(), "state": snapshot}),
                        Some(label.clone()),
                    );
                }
                if let Ok(mut closing) = state.closing_windows.lock() {
                    closing.insert(label.clone());
                }
                let app_for_run = app_handle.clone();
                let _ = app_handle.run_on_main_thread(move || {
                    if let Some(window) = app_for_run.get_webview_window(&label) {
                        let _ = window.close();
                    }
                });
            });
        }
        WindowEvent::Destroyed => {
            state.windows.unregister(window.label());
            state.emit_node_event(
                "window:closed",
                json!({"label": window.label(), "destroyed": true}),
                Some(label),
            );
            #[cfg(not(target_os = "macos"))]
            if app.webview_windows().is_empty() && !state.quitting.load(Ordering::Acquire) {
                app.exit(0);
            }
        }
        _ => {}
    }
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = focused_webview(app).or_else(|| app.get_webview_window("main")) {
        let _ = window.show();
        let _ = window.set_focus();
        #[cfg(target_os = "macos")]
        let _ = invalidate_window(&window);
    }
}

fn emit_app_activate(state: &NativeState) {
    state.emit_node_event("app:activate", Value::Null, None);
}

fn invalidate_window(window: &WebviewWindow) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }
    let scale = window
        .scale_factor()
        .map_err(|error| format!("failed to read window scale factor: {error}"))?;
    let original = window
        .inner_size()
        .map_err(|error| format!("failed to read window size: {error}"))?;
    let original_logical = original.to_logical::<f64>(scale);
    let bumped_logical =
        tauri::LogicalSize::new(original_logical.width + 1.0, original_logical.height);
    window
        .set_size(bumped_logical)
        .map_err(|error| format!("failed to invalidate window compositor: {error}"))?;

    let window = window.clone();
    std::thread::Builder::new()
        .name("superset-window-invalidate".into())
        .spawn(move || {
            std::thread::sleep(Duration::from_millis(32));
            let app = window.app_handle().clone();
            let _ = app.run_on_main_thread(move || {
                let Ok(scale) = window.scale_factor() else {
                    return;
                };
                let Ok(current) = window.inner_size() else {
                    return;
                };
                let current_logical = current.to_logical::<f64>(scale);
                let expected =
                    tauri::LogicalSize::new(original_logical.width + 1.0, original_logical.height);
                if (current_logical.width - expected.width).abs() > 0.75
                    || (current_logical.height - expected.height).abs() > 0.75
                {
                    return;
                }
                let _ = window.set_size(original_logical);
            });
        })
        .map_err(|error| format!("failed to schedule compositor restore: {error}"))?;
    Ok(())
}

pub fn notify_open_windows(state: &NativeState, app: &AppHandle) {
    let mut persisted = Vec::new();
    for (label, window) in app.webview_windows() {
        if let Some(record) = state.windows.record(&label) {
            if let Some(snapshot) = state.windows.capture_state(&window) {
                persisted.push(PersistedWindow {
                    key: record.key,
                    org_id: record.org_id,
                    state: snapshot,
                });
            }
        }
    }
    state.emit_node_event("windows:state", json!({"windows": persisted}), None);
}

fn focused_webview(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_focused_window()
        .and_then(|window| app.get_webview_window(window.label()))
}

fn normalized_scale_factor(scale: f64) -> f64 {
    if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    }
}

fn physical_position_to_logical(x: i32, y: i32, scale: f64) -> (i32, i32) {
    let scale = normalized_scale_factor(scale);
    (
        ((x as f64) / scale).round() as i32,
        ((y as f64) / scale).round() as i32,
    )
}

fn physical_size_to_logical(width: u32, height: u32, scale: f64) -> (u32, u32) {
    let scale = normalized_scale_factor(scale);
    (
        ((width as f64) / scale).round() as u32,
        ((height as f64) / scale).round() as u32,
    )
}

fn has_registered_app_window(app: &AppHandle, windows: &WindowRegistry) -> bool {
    app.webview_windows()
        .keys()
        .any(|label| windows.is_registered(label))
}

fn as_object(value: &Value) -> Result<&serde_json::Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| "native method params must be an object".to_string())
}

fn resolve_window_label(params: &Value, fallback: Option<&str>) -> Result<String, String> {
    as_object(params)?
        .get("windowLabel")
        .and_then(Value::as_str)
        .or(fallback)
        .map(ToString::to_string)
        .ok_or_else(|| "native window method requires windowLabel".to_string())
}

fn parse_window_state(options: &serde_json::Map<String, Value>) -> WindowState {
    WindowState {
        x: options.get("x").and_then(Value::as_i64).unwrap_or(0) as i32,
        y: options.get("y").and_then(Value::as_i64).unwrap_or(0) as i32,
        width: options
            .get("width")
            .and_then(Value::as_u64)
            .unwrap_or(1280)
            .clamp(400, u32::MAX as u64) as u32,
        height: options
            .get("height")
            .and_then(Value::as_u64)
            .unwrap_or(800)
            .clamp(400, u32::MAX as u64) as u32,
        is_maximized: options
            .get("maximized")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        zoom_level: options.get("zoomLevel").and_then(Value::as_f64),
    }
}

fn clipboard_read_text() -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    let output = Command::new("pbpaste").output();
    #[cfg(target_os = "linux")]
    let output = Command::new("sh").args(["-c", "(wl-paste 2>/dev/null || xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null)"]).output();
    #[cfg(target_os = "windows")]
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", "Get-Clipboard"])
        .output();
    let output = output.map_err(|error| format!("clipboard read failed: {error}"))?;
    if !output.status.success() {
        return Err("clipboard read failed".into());
    }
    Ok(json!({"text": String::from_utf8_lossy(&output.stdout)}))
}

fn clipboard_write_text(text: &str) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    let child = Command::new("pbcopy").stdin(Stdio::piped()).spawn();
    #[cfg(target_os = "linux")]
    let mut child = Command::new("sh").args(["-c", "(wl-copy 2>/dev/null || xclip -selection clipboard 2>/dev/null || xsel --clipboard --input 2>/dev/null)"]).stdin(Stdio::piped()).spawn();
    #[cfg(target_os = "windows")]
    let mut child = Command::new("clip").stdin(Stdio::piped()).spawn();
    let mut child = child.map_err(|error| format!("clipboard write failed: {error}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        use std::io::Write;
        stdin
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    let status = child.wait().map_err(|error| error.to_string())?;
    if !status.success() {
        return Err("clipboard write failed".into());
    }
    Ok(Value::Null)
}

fn dialog_open(
    app: &AppHandle,
    state: &NativeState,
    request: &NativeRequest,
) -> Result<Value, String> {
    let options = as_object(&request.params)?;
    let properties = options
        .get("properties")
        .and_then(Value::as_array)
        .map(|properties| {
            properties
                .iter()
                .filter_map(Value::as_str)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let title = options.get("title").and_then(Value::as_str);
    let default_path = options.get("defaultPath").and_then(Value::as_str);
    let mut builder = app.dialog().file();
    if let Some(title) = title {
        builder = builder.set_title(title);
    }
    if let Some(path) = default_path {
        builder = builder.set_directory(path);
    }
    if let Some(window) = trusted_parent_window(app, state, request.window_label.as_deref())? {
        builder = builder.set_parent(&window);
    }
    if let Some(filters) = options.get("filters").and_then(Value::as_array) {
        for filter in filters {
            let Some(filter) = filter.as_object() else {
                continue;
            };
            let Some(name) = filter.get("name").and_then(Value::as_str) else {
                continue;
            };
            let extensions = filter
                .get("extensions")
                .and_then(Value::as_array)
                .map(|extensions| {
                    extensions
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if !extensions.is_empty() {
                builder = builder.add_filter(name, &extensions);
            }
        }
    }
    let selected = if properties.contains("openDirectory") {
        builder.blocking_pick_folder().map(|path| vec![path])
    } else if properties.contains("multiSelections") {
        builder.blocking_pick_files()
    } else {
        builder.blocking_pick_file().map(|path| vec![path])
    };
    let file_paths = selected
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.to_string())
        .collect::<Vec<_>>();
    Ok(json!({"canceled": file_paths.is_empty(), "filePaths": file_paths}))
}

fn dialog_message(
    app: &AppHandle,
    state: &NativeState,
    method: &str,
    params: &Value,
    window_label: Option<&str>,
) -> Result<Value, String> {
    let options = as_object(params)?;
    let title = options
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or(APP_NAME);
    let message = options.get("message").and_then(Value::as_str).unwrap_or("");
    let detail = options.get("detail").and_then(Value::as_str).unwrap_or("");
    let content = if detail.is_empty() {
        message.to_string()
    } else {
        format!("{message}\n\n{detail}")
    };
    let buttons = options
        .get("buttons")
        .and_then(Value::as_array)
        .map(|buttons| buttons.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_else(|| vec!["OK"]);
    if buttons.len() > 3 {
        return Err("native message dialogs support at most three buttons".into());
    }
    let button_kind = match buttons.as_slice() {
        [] | [_] => {
            MessageDialogButtons::OkCustom(buttons.first().copied().unwrap_or("OK").to_string())
        }
        [ok, cancel] => {
            MessageDialogButtons::OkCancelCustom((*ok).to_string(), (*cancel).to_string())
        }
        [yes, no, cancel, ..] => MessageDialogButtons::YesNoCancelCustom(
            (*yes).to_string(),
            (*no).to_string(),
            (*cancel).to_string(),
        ),
    };
    let kind = if method == "dialog.error" {
        MessageDialogKind::Error
    } else {
        match options
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("info")
        {
            "error" => MessageDialogKind::Error,
            "warning" => MessageDialogKind::Warning,
            _ => MessageDialogKind::Info,
        }
    };
    let mut dialog = app
        .dialog()
        .message(content)
        .title(title)
        .kind(kind)
        .buttons(button_kind);
    if let Some(window) = trusted_parent_window(app, state, window_label)? {
        dialog = dialog.parent(&window);
    }
    let response = dialog.blocking_show_with_result();
    let response_index = match response {
        MessageDialogResult::Yes | MessageDialogResult::Ok => 0,
        MessageDialogResult::No => 1,
        MessageDialogResult::Cancel => options
            .get("cancelId")
            .and_then(Value::as_u64)
            .unwrap_or(buttons.len().saturating_sub(1) as u64)
            as usize,
        MessageDialogResult::Custom(label) => buttons
            .iter()
            .position(|button| *button == label)
            .unwrap_or(0),
    };
    Ok(json!({"response": response_index}))
}

fn process_metrics() -> Result<Value, String> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let output = Command::new("ps")
            .args(["-axo", "pid=,pcpu=,rss=,command="])
            .output()
            .map_err(|error| format!("process metrics failed: {error}"))?;
        if !output.status.success() {
            return Err("process metrics command failed".into());
        }
        let current_pid = std::process::id();
        let mut result = Vec::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let mut fields = line.split_whitespace();
            let Some(pid) = fields.next().and_then(|value| value.parse::<u32>().ok()) else {
                continue;
            };
            let cpu = fields
                .next()
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0);
            let rss_kb = fields
                .next()
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0);
            let command = fields.collect::<Vec<_>>().join(" ");
            let process_type = if pid == current_pid {
                "Browser"
            } else if command.contains("--type=renderer")
                || command.contains("Renderer")
                || command.contains("renderer")
            {
                "Renderer"
            } else {
                "Utility"
            };
            result.push(json!({
                "type": process_type,
                "cpu": {"percentCPUUsage": cpu},
                "memory": {"workingSetSize": rss_kb * 1024.0},
            }));
        }
        return Ok(Value::Array(result));
    }
    #[cfg(target_os = "windows")]
    {
        const SAMPLE_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$before = @{}
$timer = [System.Diagnostics.Stopwatch]::StartNew()
foreach ($process in [System.Diagnostics.Process]::GetProcesses()) {
  try { $before[$process.Id] = $process.TotalProcessorTime.TotalSeconds } catch {} finally { $process.Dispose() }
}
Start-Sleep -Milliseconds 100
$elapsed = $timer.Elapsed.TotalSeconds
$rows = @(
  foreach ($process in [System.Diagnostics.Process]::GetProcesses()) {
    try {
      $cpu = 0.0
      if ($before.ContainsKey($process.Id) -and $elapsed -gt 0) {
        $cpu = 100.0 * ($process.TotalProcessorTime.TotalSeconds - $before[$process.Id]) / $elapsed / [Environment]::ProcessorCount
      }
      $type = if ($process.Id -eq [int]$env:SUPERSET_NATIVE_PID) { 'Browser' } elseif ($process.ProcessName -match '(?i)renderer') { 'Renderer' } else { 'Utility' }
      [pscustomobject]@{
        type = $type
        cpu = [pscustomobject]@{ percentCPUUsage = [Math]::Max(0.0, $cpu) }
        memory = [pscustomobject]@{ workingSetSize = [double]$process.WorkingSet64 }
      }
    } catch {} finally { $process.Dispose() }
  }
)
ConvertTo-Json -InputObject $rows -Compress -Depth 4
"#;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", SAMPLE_SCRIPT])
            .env("SUPERSET_NATIVE_PID", std::process::id().to_string())
            .output()
            .map_err(|error| format!("process metrics failed: {error}"))?;
        if !output.status.success() {
            return Err("process metrics command failed".into());
        }
        let metrics: Value = serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("process metrics response was invalid: {error}"))?;
        Ok(match metrics {
            Value::Array(_) => metrics,
            Value::Null => Value::Array(Vec::new()),
            value => Value::Array(vec![value]),
        })
    }
}

fn updater_endpoint(feed_url: &str) -> Result<Url, String> {
    let mut endpoint = Url::parse(feed_url).map_err(|error| error.to_string())?;
    if !endpoint.path().ends_with(".json") {
        let path = format!("{}/latest.json", endpoint.path().trim_end_matches('/'));
        endpoint.set_path(&path);
    }
    Ok(endpoint)
}

fn updater_command_error(method: &str, personal_install: bool) -> Option<&'static str> {
    (personal_install && method.starts_with("updater."))
        .then_some("Updater is disabled in the local personal build")
}

fn permissions_status(app: &AppHandle, state: &NativeState) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    let accessibility = unsafe { objc2_application_services::AXIsProcessTrusted() };
    #[cfg(not(target_os = "macos"))]
    let accessibility = false;
    let full_disk_access = check_full_disk_access();
    let microphone_state = focused_trusted_webview(app, state)
        .map(|window| query_microphone_permission(&window))
        .transpose()?
        .unwrap_or_else(|| {
            state
                .permission_snapshot
                .lock()
                .ok()
                .and_then(|permissions| {
                    permissions
                        .get("microphone")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "not-determined".into())
        });
    if let Ok(mut permissions) = state.permission_snapshot.lock() {
        permissions.insert("microphone".into(), json!(microphone_state));
    }
    let microphone = microphone_state == "granted";
    Ok(json!({
        "fullDiskAccess": full_disk_access,
        "accessibility": accessibility,
        "microphone": microphone,
    }))
}

fn request_microphone(app: &AppHandle, state: &NativeState) -> Result<Value, String> {
    let window = focused_trusted_webview(app, state)
        .or_else(|| {
            app.get_webview_window("main")
                .filter(|window| state.windows.is_trusted_window(window))
        })
        .ok_or_else(|| {
            "no trusted app window is available for microphone permission".to_string()
        })?;
    window
        .eval("window.__supersetMicrophoneResult=null; navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{stream.getTracks().forEach(track=>track.stop()); window.__supersetMicrophoneResult=true},()=>window.__supersetMicrophoneResult=false)")
        .map_err(|error| format!("failed to start microphone permission request: {error}"))?;
    let (sender, receiver) = mpsc::sync_channel(1);
    loop {
        if app.get_webview_window(window.label()).is_none() {
            return Err(
                "microphone permission request was canceled because its window closed".into(),
            );
        }
        let sender = sender.clone();
        window
            .eval_with_callback("window.__supersetMicrophoneResult", move |result| {
                let _ = sender.send(result);
            })
            .map_err(|error| format!("microphone permission response failed: {error}"))?;
        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(value) if value.trim() == "true" => {
                cache_microphone_state(state, "granted");
                return Ok(json!(true));
            }
            Ok(value) if value.trim() == "false" => {
                cache_microphone_state(state, "denied");
                return Ok(json!(false));
            }
            Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("microphone permission request was interrupted".into());
            }
        }
    }
}

fn trusted_webview(
    app: &AppHandle,
    state: &NativeState,
    label: &str,
) -> Result<WebviewWindow, String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window {label} not found"))?;
    if !state.windows.is_trusted_window(&window) {
        return Err(format!("window {label} is not a trusted app renderer"));
    }
    Ok(window)
}

fn trusted_parent_window(
    app: &AppHandle,
    state: &NativeState,
    label: Option<&str>,
) -> Result<Option<WebviewWindow>, String> {
    label
        .map(|label| trusted_webview(app, state, label).map(Some))
        .unwrap_or(Ok(None))
}

fn focused_trusted_webview(app: &AppHandle, state: &NativeState) -> Option<WebviewWindow> {
    focused_webview(app).filter(|window| state.windows.is_trusted_window(window))
}

fn query_microphone_permission(window: &WebviewWindow) -> Result<String, String> {
    window
        .eval("window.__supersetMicrophonePermission='querying'; if (navigator.permissions && navigator.permissions.query) { navigator.permissions.query({name:'microphone'}).then(result=>window.__supersetMicrophonePermission=result.state).catch(()=>window.__supersetMicrophonePermission='not-determined') } else { window.__supersetMicrophonePermission='not-determined' }")
        .map_err(|error| format!("failed to query microphone permission: {error}"))?;
    let (sender, receiver) = mpsc::sync_channel(1);
    for _ in 0..10 {
        let sender = sender.clone();
        window
            .eval_with_callback(
                "JSON.stringify(window.__supersetMicrophonePermission)",
                move |result| {
                    let _ = sender.send(result);
                },
            )
            .map_err(|error| format!("microphone permission status failed: {error}"))?;
        if let Ok(raw) = receiver.recv_timeout(Duration::from_millis(50)) {
            if let Ok(value) = serde_json::from_str::<String>(&raw) {
                if matches!(value.as_str(), "granted" | "denied" | "prompt") {
                    return Ok(if value == "prompt" {
                        "not-determined".into()
                    } else {
                        value
                    });
                }
            }
        }
    }
    Ok("not-determined".into())
}

fn cache_microphone_state(state: &NativeState, value: &str) {
    if let Ok(mut permissions) = state.permission_snapshot.lock() {
        permissions.insert("microphone".into(), json!(value));
    }
}

fn initial_permission_snapshot() -> Value {
    #[cfg(target_os = "macos")]
    let accessibility = unsafe { objc2_application_services::AXIsProcessTrusted() };
    #[cfg(not(target_os = "macos"))]
    let accessibility = false;
    json!({
        "fullDiskAccess": check_full_disk_access(),
        "accessibility": accessibility,
        "microphone": "not-determined",
    })
}

#[cfg(target_os = "macos")]
fn check_full_disk_access() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    for path in [
        home.join("Library/Application Support/com.apple.TCC/TCC.db"),
        home.join("Library/Safari/History.db"),
        home.join("Library/Safari/Bookmarks.plist"),
        home.join("Library/Messages/chat.db"),
    ] {
        match fs::OpenOptions::new().read(true).open(path) {
            Ok(file) => {
                drop(file);
                return true;
            }
            Err(error) if matches!(error.kind(), std::io::ErrorKind::NotFound) => continue,
            Err(error) if error.raw_os_error() == Some(libc::ENOTDIR) => continue,
            Err(_) => return false,
        }
    }
    false
}

#[cfg(not(target_os = "macos"))]
fn check_full_disk_access() -> bool {
    false
}

fn permissions_open_settings(params: &Value) -> Result<Value, String> {
    let permission = as_object(params)?
        .get("permission")
        .and_then(Value::as_str)
        .ok_or_else(|| "permissions.openSettings requires permission".to_string())?;
    let url = match permission {
        "fullDiskAccess" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
        }
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        "microphone" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        "appleEvents" => {
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation"
        }
        "localNetwork" => {
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocalNetwork"
        }
        _ => return Err("unknown macOS permission destination".into()),
    };
    #[cfg(not(target_os = "macos"))]
    return Err("macOS privacy settings are not available on this platform".into());
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("/usr/bin/open")
            .arg(url)
            .status()
            .map_err(|error| format!("failed to open permission settings: {error}"))?;
        if !status.success() {
            return Err("permission settings opener failed".into());
        }
        Ok(Value::Null)
    }
}

fn shell_open_external(params: &Value) -> Result<Value, String> {
    let url = as_object(params)?
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "shell.openExternal requires url".to_string())?;
    let parsed = Url::parse(url).map_err(|error| format!("invalid external URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("external URL scheme is not allowed".into());
    }
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(url).status();
    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(url).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", url]).status();
    let status = status.map_err(|error| format!("failed to open external URL: {error}"))?;
    if !status.success() {
        return Err("external URL opener failed".into());
    }
    Ok(Value::Null)
}

fn local_path_param(params: &Value, key: &str) -> Result<PathBuf, String> {
    let path = as_object(params)?
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} is required"))?;
    let path = PathBuf::from(path);
    if !path.is_absolute() || !path.exists() {
        return Err(format!("{key} must be an existing absolute path"));
    }
    Ok(path)
}

fn shell_show_in_folder(params: &Value) -> Result<Value, String> {
    let path = local_path_param(params, "path")?;
    let parent = path.parent().unwrap_or(&path);
    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .args(["-R", path.to_string_lossy().as_ref()])
        .status();
    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(parent).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .status();
    let status = status.map_err(|error| format!("failed to show file: {error}"))?;
    if !status.success() {
        return Err("file manager failed".into());
    }
    Ok(Value::Null)
}

fn shell_open_file(params: &Value) -> Result<Value, String> {
    let path = local_path_param(params, "path")?;
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&path).status();
    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(&path).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd")
        .args(["/C", "start", "", &path.to_string_lossy()])
        .status();
    let status = status.map_err(|error| format!("failed to open file: {error}"))?;
    if !status.success() {
        return Err("file opener failed".into());
    }
    Ok(Value::Null)
}

fn apple_script_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(target_os = "windows")]
fn powershell_string(value: &str) -> String {
    format!("'{}'", value.replace('"', "\"\"").replace('\'', "''"))
}

pub fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::DynRuntime>> {
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(
                app,
                "new-window",
                "New Window",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "open-project",
                "Open Repo...",
                true,
                Some("CmdOrCtrl+O"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close-window", "Close Window", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?,
            &MenuItem::with_id(
                app,
                "check-updates",
                "Check for Updates...",
                !PERSONAL_INSTALL_BUILD,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quit Superset"))?,
            &MenuItem::with_id(
                app,
                "quit-completely",
                "Quit Superset Completely",
                true,
                None::<&str>,
            )?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(app, "force-reload", "Force Reload", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "toggle-devtools",
                "Toggle Developer Tools",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "toggle-presets-bar",
                "Toggle Scripts Bar",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "close-window",
                "Close Window",
                true,
                Some("CmdOrCtrl+Shift+Q"),
            )?,
        ],
    )?;
    let resources = Submenu::with_items(
        app,
        "Resources",
        true,
        &[&MenuItem::with_id(
            app,
            "check-resources",
            "Check Resources",
            true,
            None::<&str>,
        )?],
    )?;
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "documentation", "Documentation", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "contact", "Contact Us", true, None::<&str>)?,
            &MenuItem::with_id(app, "report-issue", "Report Issue", true, None::<&str>)?,
            &MenuItem::with_id(app, "discord", "Join Discord", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "keyboard-shortcuts",
                "Keyboard Shortcuts",
                true,
                Some("CmdOrCtrl+/"),
            )?,
        ],
    )?;
    Menu::with_items(app, &[&file, &edit, &view, &window, &resources, &help])
}

pub fn handle_menu_event(app: &AppHandle, state: &NativeState, id: &str) {
    if let Some(action) = id.strip_prefix("node-action:") {
        if let Some(target) = state
            .context_menu_targets
            .lock()
            .ok()
            .and_then(|mut targets| targets.remove(action))
        {
            if trusted_webview(app, state, &target.window_label).is_ok() {
                state.emit_node_event(
                    "menu:contextAction",
                    json!({"action": action}),
                    Some(target.window_label),
                );
            }
        } else if action.starts_with("tray-action-") {
            state.emit_node_event("tray:action", json!({"action": action}), None);
        } else if action.starts_with("context-action-") || action.starts_with("browser-context-") {
            return;
        } else {
            state.emit_node_event("menu:action", json!({"action": action}), None);
        }
        return;
    }
    match id {
        "close-window" => {
            if let Some(window) = focused_webview(app) {
                let _ = window.close();
            }
        }
        "reload" => {
            if let Some(window) = focused_webview(app) {
                let _ = window.reload();
            }
        }
        "force-reload" => {
            if let Some(window) = focused_webview(app) {
                let _ = window.reload();
            }
        }
        "toggle-devtools" => {
            if let Some(window) = focused_webview(app) {
                window.open_devtools();
            }
        }
        "quit-completely" => {
            state.emit_node_event("menu:clicked", json!({"id": id}), None);
        }
        "tray-open" | "tray-settings" | "tray-updates" | "tray-close" => {
            handle_tray_event(app, state, id);
        }
        "new-window" | "open-project" | "settings" | "check-updates" | "toggle-presets-bar"
        | "check-resources" | "keyboard-shortcuts" => {
            state.emit_node_event("menu:clicked", json!({"id": id}), None);
        }
        "documentation" => {
            let _ = shell_open_external(&json!({"url":"https://docs.superset.sh"}));
        }
        "contact" => {
            let _ = shell_open_external(&json!({"url":"mailto:hi@superset.sh"}));
        }
        "report-issue" => {
            let _ = shell_open_external(
                &json!({"url":"https://github.com/superset-sh/superset/issues/new"}),
            );
        }
        "discord" => {
            let _ = shell_open_external(&json!({"url":"https://discord.gg/superset"}));
        }
        _ => {}
    }
}

pub fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::DynRuntime>> {
    let menu = Menu::new(app)?;
    let open = MenuItem::with_id(app, "tray-open", "Open Superset", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "tray-settings", "Settings", true, None::<&str>)?;
    let updates = MenuItem::with_id(
        app,
        "tray-updates",
        "Check for Updates",
        !PERSONAL_INSTALL_BUILD,
        None::<&str>,
    )?;
    let close = MenuItem::with_id(app, "tray-close", "Close Superset", true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "quit-completely",
        "Quit Superset Completely",
        true,
        None::<&str>,
    )?;
    menu.append(&open)?;
    menu.append(&settings)?;
    menu.append(&updates)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&close)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn build_native_menu(app: &AppHandle, template: &Value) -> Result<Menu<tauri::DynRuntime>, String> {
    let entries = template
        .as_array()
        .ok_or_else(|| "menu template must be an array".to_string())?;
    let menu = Menu::new(app).map_err(|error| error.to_string())?;
    for (index, entry) in entries.iter().enumerate() {
        menu.append(&*build_native_menu_item(
            app,
            entry,
            format!("native-menu-{index}"),
        )?)
        .map_err(|error| error.to_string())?;
    }
    Ok(menu)
}

fn register_context_menu_targets(
    targets: &Arc<Mutex<HashMap<String, ContextMenuTarget>>>,
    template: &Value,
    window_label: &str,
) -> Result<(), String> {
    fn visit(value: &Value, actions: &mut Vec<String>) {
        match value {
            Value::Array(entries) => {
                for entry in entries {
                    visit(entry, actions);
                }
            }
            Value::Object(object) => {
                if let Some(action) = object.get("action").and_then(Value::as_str) {
                    actions.push(action.to_string());
                }
                if let Some(submenu) = object.get("submenu") {
                    visit(submenu, actions);
                }
            }
            _ => {}
        }
    }

    let mut actions = Vec::new();
    visit(template, &mut actions);
    let now = std::time::Instant::now();
    let mut targets = targets
        .lock()
        .map_err(|_| "context-menu routing state was poisoned".to_string())?;
    targets.retain(|_, target| now.duration_since(target.registered_at).as_secs() < 120);
    for action in actions {
        while targets.len() >= 512 {
            let oldest = targets
                .iter()
                .min_by_key(|(_, target)| target.registered_at)
                .map(|(action, _)| action.clone());
            let Some(oldest) = oldest else { break };
            targets.remove(&oldest);
        }
        targets.insert(
            action,
            ContextMenuTarget {
                window_label: window_label.to_string(),
                registered_at: now,
            },
        );
    }
    Ok(())
}

fn build_native_menu_item(
    app: &AppHandle,
    entry: &Value,
    id: String,
) -> Result<Box<dyn tauri::menu::IsMenuItem<tauri::DynRuntime>>, String> {
    let object = as_object(entry)?;
    if object.get("type").and_then(Value::as_str) == Some("separator") {
        return Ok(Box::new(
            PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?,
        ));
    }
    if let Some(submenu) = object.get("submenu") {
        let title = object.get("label").and_then(Value::as_str).unwrap_or("");
        let children = submenu
            .as_array()
            .ok_or_else(|| "menu submenu must be an array".to_string())?;
        let submenu = Submenu::new(app, title, true).map_err(|error| error.to_string())?;
        for (index, child) in children.iter().enumerate() {
            submenu
                .append(&*build_native_menu_item(
                    app,
                    child,
                    format!("{id}-{index}"),
                )?)
                .map_err(|error| error.to_string())?;
        }
        return Ok(Box::new(submenu));
    }
    let label = object.get("label").and_then(Value::as_str).unwrap_or("");
    if let Some(role) = object.get("role").and_then(Value::as_str) {
        let predefined = match role {
            "undo" => Some(PredefinedMenuItem::undo(app, None)),
            "redo" => Some(PredefinedMenuItem::redo(app, None)),
            "cut" => Some(PredefinedMenuItem::cut(app, None)),
            "copy" => Some(PredefinedMenuItem::copy(app, None)),
            "paste" => Some(PredefinedMenuItem::paste(app, None)),
            "selectAll" => Some(PredefinedMenuItem::select_all(app, None)),
            "minimize" => Some(PredefinedMenuItem::minimize(app, None)),
            "zoom" => Some(PredefinedMenuItem::maximize(app, None)),
            "close" => Some(PredefinedMenuItem::close_window(app, None)),
            "quit" => Some(PredefinedMenuItem::quit(app, None)),
            "fullscreen" | "togglefullscreen" => Some(PredefinedMenuItem::fullscreen(app, None)),
            "hide" => Some(PredefinedMenuItem::hide(app, None)),
            "hideOthers" => Some(PredefinedMenuItem::hide_others(app, None)),
            "unhide" => Some(PredefinedMenuItem::show_all(app, None)),
            "services" => Some(PredefinedMenuItem::services(app, None)),
            "about" => Some(PredefinedMenuItem::about(app, None, None)),
            _ => None,
        };
        if let Some(item) = predefined {
            return item
                .map(|item| Box::new(item) as Box<dyn tauri::menu::IsMenuItem<tauri::DynRuntime>>)
                .map_err(|error| error.to_string());
        }
    }
    let item_id = object
        .get("action")
        .and_then(Value::as_str)
        .map(|action| format!("node-action:{action}"))
        .or_else(|| {
            object
                .get("role")
                .and_then(Value::as_str)
                .map(|role| format!("native-role:{role}"))
        })
        .unwrap_or(id);
    let accelerator = object.get("accelerator").and_then(Value::as_str);
    let enabled = object
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let item = MenuItem::with_id(app, item_id, label, enabled, accelerator)
        .map_err(|error| error.to_string())?;
    Ok(Box::new(item))
}

pub fn init_tray(app: &AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let menu = tray_menu(app)?;
        let icon_path = app.path().resource_dir()?.join("tray/iconTemplate.png");
        let icon = Image::from_path(icon_path)?;
        let _tray = tauri::tray::TrayIconBuilder::with_id("superset-tray")
            .icon(icon)
            .icon_as_template(true)
            .tooltip(APP_NAME)
            .menu(&menu)
            .build(app)?;
    }
    Ok(())
}

pub fn handle_tray_event(app: &AppHandle, state: &NativeState, id: &str) {
    match id {
        "tray-open" => {
            if app.webview_windows().is_empty() {
                emit_app_activate(state);
            } else {
                focus_main_window(app);
            }
        }
        "tray-settings" => state.emit_node_event("menu:clicked", json!({"id":"settings"}), None),
        "tray-updates" => {
            state.emit_node_event("menu:clicked", json!({"id":"check-updates"}), None)
        }
        "tray-close" => {
            state.emit_node_event("menu:clicked", json!({"id":"quit"}), None);
        }
        "quit-completely" => {
            state.emit_node_event("menu:clicked", json!({"id":"quit-completely"}), None);
        }
        _ => {}
    }
}

fn precomputed_cache_path(configured_product_name: &str) -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let app_path = absolute_path(
        env::var_os("SUPERSET_APP_PATH")
            .map(PathBuf::from)
            .or_else(|| {
                tauri::is_dev().then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
            })
            .unwrap_or_else(|| PathBuf::from(".")),
    );
    resolve_user_data_path(&home, &app_path, configured_product_name).join("cef")
}

fn handle_node_event(app: &AppHandle, windows: &WindowRegistry, event: NativeEvent) {
    if let Some(label) = event.window_label.as_deref() {
        let Some(window) = app.get_webview_window(label) else {
            return;
        };
        if !windows.is_trusted_window(&window) {
            return;
        }
        if event.name.starts_with("trpc:")
            || event.name.starts_with("browser:")
            || event.name.starts_with("renderer:")
            || event.name == "deep-link"
        {
            let _ = app.emit_to(
                EventTarget::webview(label),
                "desktop:event",
                json!({"name": event.name, "payload": event.payload}),
            );
        }
        return;
    }
    if event.name == "app:focus" {
        focus_main_window(app);
    } else if event.name == "native:disconnected" {
        for (label, window) in app.webview_windows() {
            if windows.is_trusted_window(&window) {
                let _ = app.emit_to(
                    EventTarget::webview(&label),
                    "desktop:event",
                    json!({"name":"native:disconnected","payload":{"reason":"Node service disconnected"}}),
                );
            }
        }
    }
}

fn protocol_response(
    status: http::StatusCode,
    content_type: &str,
    body: Vec<u8>,
) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header(http::header::CONTENT_TYPE, content_type)
        .header(http::header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

fn project_icon_path(project_id: &str) -> Option<PathBuf> {
    if project_id.is_empty()
        || project_id.len() > 128
        || !project_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return None;
    }
    let home = env::var_os("SUPERSET_HOME_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".superset")))?;
    let directory = home.join("project-icons");
    fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.file_stem().and_then(|stem| stem.to_str()) == Some(project_id)
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| {
                        matches!(
                            extension.to_ascii_lowercase().as_str(),
                            "png" | "jpg" | "jpeg" | "svg" | "ico"
                        )
                    })
        })
}

fn font_path(filename: &str) -> Option<PathBuf> {
    if filename.is_empty()
        || filename.len() > 128
        || !filename.starts_with("SF-Mono-")
        || !filename.ends_with(".otf")
        || filename.contains('/')
        || filename.contains('\\')
    {
        return None;
    }
    [
        "/System/Applications/Utilities/Terminal.app/Contents/Resources/Fonts",
        "/System/Library/Fonts",
        "/Library/Fonts",
    ]
    .into_iter()
    .map(PathBuf::from)
    .map(|directory| directory.join(filename))
    .find(|path| path.is_file())
}

fn register_asset_protocols(
    builder: tauri::Builder<tauri::DynRuntime>,
) -> tauri::Builder<tauri::DynRuntime> {
    builder
        .register_asynchronous_uri_scheme_protocol(
            "superset-icon",
            |_context, request, responder| {
                let project_id = request
                    .uri()
                    .path()
                    .trim_start_matches('/')
                    .strip_prefix("projects/")
                    .unwrap_or_default();
                let response = project_icon_path(project_id)
                    .and_then(|path| {
                        let content_type = match path
                            .extension()
                            .and_then(|extension| extension.to_str())
                            .unwrap_or_default()
                            .to_ascii_lowercase()
                            .as_str()
                        {
                            "svg" => "image/svg+xml",
                            "jpg" | "jpeg" => "image/jpeg",
                            "ico" => "image/x-icon",
                            _ => "image/png",
                        };
                        fs::read(path)
                            .ok()
                            .map(|body| protocol_response(http::StatusCode::OK, content_type, body))
                    })
                    .unwrap_or_else(|| {
                        protocol_response(
                            http::StatusCode::NOT_FOUND,
                            "text/plain",
                            b"Not found".to_vec(),
                        )
                    });
                responder.respond(response);
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "superset-font",
            |_context, request, responder| {
                let filename = request
                    .uri()
                    .path()
                    .trim_start_matches('/')
                    .strip_prefix("fonts/")
                    .unwrap_or_default();
                let response = font_path(filename)
                    .and_then(|path| fs::read(path).ok())
                    .map(|body| protocol_response(http::StatusCode::OK, "font/otf", body))
                    .unwrap_or_else(|| {
                        protocol_response(
                            http::StatusCode::NOT_FOUND,
                            "text/plain",
                            b"Not found".to_vec(),
                        )
                    });
                responder.respond(response);
            },
        )
}

pub fn run() -> Result<(), String> {
    let context = tauri::generate_context!();
    let configured_product_name = context.config().product_name.as_deref().unwrap_or(APP_NAME);
    let protocol_schemes = protocol_schemes(context.config());
    let cache_path = precomputed_cache_path(configured_product_name);
    fs::create_dir_all(&cache_path)
        .map_err(|error| format!("failed to create CEF cache path: {error}"))?;
    let remote_debugging = configured_remote_debugging()?;
    let mut runtime = tauri_runtime_cef::Cef::default()
        .root_cache_path(&cache_path)
        .deep_link_schemes(protocol_schemes)
        .remote_debugging(remote_debugging)
        .command_line_arg(
            "disk-cache-size",
            Some((1024_u64 * 1024 * 1024).to_string()),
        )
        .with_settings(|settings| settings.persist_session_cookies = 1);
    #[cfg(target_os = "macos")]
    {
        runtime = runtime.command_line_arg("disable-background-timer-throttling", None::<String>);
    }

    register_asset_protocols(tauri::Builder::default())
        .runtime(runtime)
        .menu(menu)
        .invoke_handler(tauri::generate_handler![desktop_rpc, native_command])
        .on_menu_event(|app, event| {
            if let Some(state) = app.try_state::<NativeState>() {
                handle_menu_event(app, &state, &event.id().0);
            }
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            if let Some(state) = app.try_state::<NativeState>() {
                handle_window_event(&app, &state, window, event);
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();
            let paths = resolve_paths(&app_handle)?;
            let migration = ProfileMigration::new_for_runtime(
                paths.user_data_path.clone(),
                paths.dev_port,
            )?;
            // The browser partition must be staged before Node can restore a window
            // and create its first guest webview. The product name is the baked
            // Electron identity used for the legacy Safe Storage keychain item;
            // do not derive it from the new executable or a QA profile name.
            let _guest_profile_migration =
                crate::guest_profile_migration::migrate_selected_profile(
                    &paths.legacy_profile_path,
                    &paths.product_name,
                    &paths.user_data_path,
                    &crate::browser::browser_data_store_directory(&paths.cache_path),
                )?;
            app_handle
                .plugin(tauri_plugin_dialog::init())
                .map_err(|error| format!("failed to initialize dialog plugin: {error}"))?;
			if !PERSONAL_INSTALL_BUILD {
				let configured_pubkey = app
					.config()
					.plugins
					.0
					.get("updater")
					.and_then(|value| value.get("pubkey"))
					.and_then(Value::as_str)
					.unwrap_or_default();
				if !tauri::is_dev() && configured_pubkey == "__SUPERSET_TAURI_UPDATER_PUBKEY__" {
					return Err("signed updater public key is missing from this release build".into());
				}
				let updater_builder = tauri_plugin_updater::Builder::new();
				let updater_builder = if let Ok(pubkey) = env::var("SUPERSET_TAURI_UPDATER_PUBKEY") {
					updater_builder.pubkey(pubkey)
				} else {
					updater_builder
				};
				app_handle
					.plugin(updater_builder.build())
					.map_err(|error| format!("failed to initialize signed updater: {error}"))?;
			}
            let windows = WindowRegistry::new(paths.superset_home_path.clone(), paths.dev_port);
            // Establish the migration marker and source snapshot before Node can restore any
            // application renderer that may hydrate the target origin.
            let export_start = crate::legacy_exporter::start(
                &app_handle,
                &migration,
                &windows,
                &paths.legacy_profile_path,
                &paths.cache_path,
                &paths.user_data_path,
            )?;
            if export_start == crate::legacy_exporter::LegacyExportStart::Failed
                && migration.status().state != "error"
            {
                return Err("legacy profile exporter failed without recording its state".into());
            }
            let quitting = Arc::new(AtomicBool::new(false));
            let closing_windows = Arc::new(Mutex::new(HashSet::new()));
            let host_slot: Arc<Mutex<Option<NodeHost>>> = Arc::new(Mutex::new(None));
            let (startup_complete_tx, startup_complete_rx) = mpsc::sync_channel(1);
            let event_windows = windows.clone();
            let event_app = app_handle.clone();
            let event_handler = Arc::new(move |event: NativeEvent| {
                if matches!(event.name.as_str(), "ready" | "native:disconnected") {
                    let _ = startup_complete_tx.try_send(());
                }
                handle_node_event(&event_app, &event_windows, event);
            });
            let request_app = app_handle.clone();
            let request_windows = windows.clone();
            let request_paths = paths.clone();
            let request_quitting = quitting.clone();
            let request_migration = migration.clone();
            let request_closing_windows = closing_windows.clone();
            let force_full_cleanup = Arc::new(AtomicBool::new(false));
            let request_force_full_cleanup = force_full_cleanup.clone();
            let pending_update: Arc<Mutex<Option<(Update, Vec<u8>)>>> = Arc::new(Mutex::new(None));
            let request_pending_update = pending_update.clone();
            let skip_quit_confirmation = Arc::new(AtomicBool::new(false));
            let request_skip_quit_confirmation = skip_quit_confirmation.clone();
            let permission_snapshot = Arc::new(Mutex::new(HashMap::new()));
            let context_menu_targets = Arc::new(Mutex::new(HashMap::new()));
            let request_permission_snapshot = permission_snapshot.clone();
            let request_context_menu_targets = context_menu_targets.clone();
            let request_slot = host_slot.clone();
            let request_handler = Arc::new(move |request: NativeRequest| {
                let host = request_slot
                    .lock()
                    .ok()
                    .and_then(|slot| slot.clone())
                    .ok_or_else(|| "Node host is not initialized".to_string())?;
                let state = NativeState {
                    node: host,
                    windows: request_windows.clone(),
                    paths: request_paths.clone(),
                    quitting: request_quitting.clone(),
                    migration: request_migration.clone(),
                    closing_windows: request_closing_windows.clone(),
                    force_full_cleanup: request_force_full_cleanup.clone(),
                    pending_update: request_pending_update.clone(),
                    skip_quit_confirmation: request_skip_quit_confirmation.clone(),
                    permission_snapshot: request_permission_snapshot.clone(),
                    context_menu_targets: request_context_menu_targets.clone(),
                };
                handle_node_request(&request_app, &state, request)
            });
            let host = NodeHost::spawn(
                &paths.node_binary,
                &paths.node_service_entry,
                bootstrap_payload(&app_handle, &paths),
                event_handler,
                request_handler,
            )?;
            if let Ok(mut slot) = host_slot.lock() {
                *slot = Some(host.clone());
            }
            let state = NativeState {
                node: host,
                windows: windows.clone(),
                paths: paths.clone(),
                quitting,
                migration,
                closing_windows,
                force_full_cleanup,
                pending_update,
                skip_quit_confirmation,
                permission_snapshot,
                context_menu_targets,
            };
            let browser_state = crate::browser::BrowserState::default();
            let browser_node = state.node.clone();
            browser_state.set_node_event_sink(Arc::new(move |name, payload, label| {
                let _ = browser_node.send_event(&name, payload, label);
            }))?;
            app.manage(browser_state);
            app.manage(state.clone());
            crate::notifications::initialize(&app_handle, &state.node)?;
            init_tray(&app_handle)
                .map_err(|error| format!("failed to initialize tray: {error}"))?;
            let fallback_app = app_handle.clone();
            let fallback_state = state.clone();
            std::thread::Builder::new()
                .name("superset-initial-window-fallback".into())
                .spawn(move || {
                    if startup_complete_rx.recv().is_err() {
                        return;
                    }
                    let app_on_main = fallback_app.clone();
                    let state_on_main = fallback_state.clone();
                    if let Err(error) = fallback_app.run_on_main_thread(move || {
                        if has_registered_app_window(&app_on_main, &state_on_main.windows) {
                            return;
                        }
                        if let Err(error) = create_main_window(&app_on_main, &state_on_main, None) {
                            eprintln!("[native] failed to create initial application window: {error}");
                        }
                    }) {
                        eprintln!("[native] failed to schedule initial application window: {error}");
                    }
                })
                .map_err(|error| format!("failed to start initial-window fallback: {error}"))?;
            Ok(())
        })
        .build(context)
        .map_err(|error| format!("failed to build Tauri application: {error}"))?
        .run(|app, event| match event {
            tauri::RunEvent::Opened { urls } => {
                if let Some(state) = app.try_state::<NativeState>() {
                    state.emit_node_event(
                        "deep-link",
                        json!({"urls": urls.iter().map(ToString::to_string).collect::<Vec<_>>() }),
                        None,
                    );
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(state) = app.try_state::<NativeState>() {
                    emit_app_activate(&state);
                }
            }
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                if let Some(state) = app.try_state::<NativeState>() {
                    if state.quitting.load(Ordering::Acquire)
                        || code.is_some()
                        || state.skip_quit_confirmation.load(Ordering::Acquire)
                    {
                        state.quitting.store(true, Ordering::Release);
                        state.emit_node_event(
                            "app:before-quit",
                            json!({"forceFullCleanup": state.force_full_cleanup.load(Ordering::Acquire)}),
                            None,
                        );
                        notify_open_windows(&state, app);
                        state.node.shutdown(
                            if state.force_full_cleanup.load(Ordering::Acquire) {
                                "quit-completely"
                            } else {
                                "quit"
                            },
                            !state.force_full_cleanup.load(Ordering::Acquire),
                        );
                        return;
                    }
                    api.prevent_exit();
                    let app_handle: AppHandle = (*app).clone();
                    let state = state.inner().clone();
                    std::thread::spawn(move || {
                        let allow = state
                            .node
                            .request_without_timeout(
                                "app.quitRequested",
                                json!({"deadline": Value::Null}),
                                None,
                            )
                            .ok()
                            .and_then(|value| value.get("allow").and_then(Value::as_bool))
                            .unwrap_or(true);
                        if !allow {
                            return;
                        }
                        state.quitting.store(true, Ordering::Release);
                        let app_for_run = app_handle.clone();
                        let _ = app_handle.run_on_main_thread(move || app_for_run.exit(0));
                    });
                }
            }
            _ => {}
        });
    Ok(())
}

fn configured_remote_debugging() -> Result<RemoteDebugging, String> {
    if !cfg!(debug_assertions) {
        return Ok(RemoteDebugging::Disabled);
    }
    let Ok(value) = env::var("RENDERER_REMOTE_DEBUG_PORT") else {
        return Ok(RemoteDebugging::Disabled);
    };
    let port = value.parse::<u16>().map_err(|_| {
        "RENDERER_REMOTE_DEBUG_PORT must be a TCP port between 1024 and 65535".to_string()
    })?;
    if port < 1024 {
        return Err("RENDERER_REMOTE_DEBUG_PORT must be a TCP port between 1024 and 65535".into());
    }
    Ok(RemoteDebugging::Port {
        port,
        allowed_origins: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        physical_position_to_logical, physical_size_to_logical, updater_command_error,
        updater_endpoint,
    };

    #[test]
    fn converts_retina_window_position_to_logical_dips() {
        assert_eq!(physical_position_to_logical(300, -301, 2.0), (150, -151));
    }

    #[test]
    fn converts_retina_window_size_to_logical_dips() {
        assert_eq!(physical_size_to_logical(2561, 1601, 2.0), (1281, 801));
    }

    #[test]
    fn invalid_scale_falls_back_to_one_for_window_events() {
        assert_eq!(physical_position_to_logical(300, 200, 0.0), (300, 200));
        assert_eq!(physical_size_to_logical(1280, 800, f64::NAN), (1280, 800));
    }

    #[test]
    fn explicit_updater_manifest_paths_are_preserved() {
        assert_eq!(
            updater_endpoint(
                "https://github.com/superset-sh/superset/releases/download/desktop-canary/canary.json"
            )
            .unwrap()
            .as_str(),
            "https://github.com/superset-sh/superset/releases/download/desktop-canary/canary.json"
        );
    }

    #[test]
    fn updater_feed_directories_default_to_the_stable_manifest() {
        assert_eq!(
            updater_endpoint("https://github.com/superset-sh/superset/releases/latest/download")
                .unwrap()
                .as_str(),
            "https://github.com/superset-sh/superset/releases/latest/download/latest.json"
        );
    }

    #[test]
    fn personal_build_rejects_updater_native_commands() {
        for method in ["updater.configure", "updater.check", "updater.install"] {
            assert_eq!(
                updater_command_error(method, true),
                Some("Updater is disabled in the local personal build")
            );
        }
        assert_eq!(updater_command_error("window.focus", true), None);
        assert_eq!(updater_command_error("updater.check", false), None);
    }
}
