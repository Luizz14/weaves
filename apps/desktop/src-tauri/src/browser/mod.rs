pub mod popup_policy;

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::webview::{DownloadControl, DownloadEvent, NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, WebviewUrl};
use tauri_runtime_cef::{
    AsCefWindowOpener, DevToolsProtocol, FrameEvent, FrameEventKind, RuntimeStyle,
    WebviewBuilderCefExt, WebviewCefExt, allocate_devtools_message_id,
};

use self::popup_policy::{OpenTarget, classify_open};

const BROWSER_EVENT: &str = "browser:event";
const NATIVE_TIMEOUT: Duration = Duration::from_secs(10);
const BROWSER_DATA_STORE: [u8; 16] = *b"superset-browser";

pub fn browser_data_store_directory(cache_root: &Path) -> PathBuf {
    cache_root.join(data_store_directory_name(&BROWSER_DATA_STORE))
}

fn data_store_directory_name(identifier: &[u8; 16]) -> String {
    let hex: String = identifier
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!(
        "DataStore-{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

const GUEST_BRIDGE_SCRIPT: &str = r#"(() => {
  if (window.__supersetNativeBridgeInstalled) return;
  window.__supersetNativeBridgeInstalled = true;
  window.__supersetForwardableChords = new Set();
  const chord = (event) => [
    event.metaKey ? 'meta' : '', event.ctrlKey ? 'ctrl' : '',
    event.altKey ? 'alt' : '', event.shiftKey ? 'shift' : '',
    String(event.code || event.key || '').toLowerCase().replace(/key|digit|numpad/g, ''),
  ].filter(Boolean).join('+');
  document.addEventListener('keydown', (event) => {
    const value = chord(event);
    if (!window.__supersetForwardableChords.has(value)) return;
    event.preventDefault();
    event.stopPropagation();
    console.info('__SUPERSET_INPUT__' + JSON.stringify({
      key: event.key, code: event.code, meta: event.metaKey,
      control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey,
    }));
  }, true);
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    const selection = window.getSelection()?.toString() || '';
    console.info('__SUPERSET_CONTEXT__' + JSON.stringify({
      linkURL: target?.href || '', pageURL: location.href,
      selectionText: selection.slice(0, 4096), x: event.clientX, y: event.clientY,
    }));
  }, true);
  document.addEventListener('mousedown', () => console.info('__SUPERSET_FOCUS__'), true);
})();"#;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug)]
struct PaneMetadata {
    workspace_id: Option<String>,
    owner_label: String,
    url: String,
    title: String,
    is_loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
    zoom_factor: f64,
}

#[derive(Clone)]
struct ActiveDownload {
	pane_id: String,
	owner_label: String,
	save_path: Option<PathBuf>,
	control: Option<DownloadControl>,
}

struct CdpMethodResult {
	success: bool,
	value: Value,
}

#[derive(Default)]
pub struct BrowserState {
    panes: Mutex<HashMap<String, PaneMetadata>>,
    active_downloads: Mutex<HashMap<String, ActiveDownload>>,
    pending_download_paths: Mutex<HashMap<(String, String), VecDeque<PathBuf>>>,
    reserved_download_paths: Mutex<HashSet<PathBuf>>,
    pending_cdp:
        Arc<Mutex<HashMap<(String, i32), mpsc::Sender<Result<CdpMethodResult, String>>>>>,
    cdp_sessions: Arc<Mutex<HashMap<String, String>>>,
    node_event_sink: Mutex<Option<Arc<dyn Fn(String, Value, Option<String>) + Send + Sync>>>,
}

impl BrowserState {
    pub fn set_node_event_sink(
        &self,
        sink: Arc<dyn Fn(String, Value, Option<String>) + Send + Sync>,
    ) -> Result<(), String> {
        self.node_event_sink
            .lock()
            .map_err(|_| "browser state lock poisoned".to_string())?
            .replace(sink);
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaneInfo {
    pane_id: String,
    workspace_id: Option<String>,
    url: String,
    title: String,
    is_loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
    zoom_factor: f64,
}

impl PaneMetadata {
    fn info(&self, pane_id: &str) -> PaneInfo {
        PaneInfo {
            pane_id: pane_id.to_string(),
            workspace_id: self.workspace_id.clone(),
            url: self.url.clone(),
            title: self.title.clone(),
            is_loading: self.is_loading,
            can_go_back: self.can_go_back,
            can_go_forward: self.can_go_forward,
            zoom_factor: self.zoom_factor,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePaneParams {
    pane_id: String,
    workspace_id: Option<String>,
    url: String,
    visible: Option<bool>,
    bounds: Option<Bounds>,
}

#[derive(Debug, Deserialize)]
struct PaneParams {
    pane_id: String,
}

#[derive(Debug, Deserialize)]
struct NavigateParams {
    pane_id: String,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VisibilityParams {
    pane_id: String,
    visible: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZoomParams {
    pane_id: String,
    zoom_factor: f64,
}

#[derive(Debug, Deserialize)]
struct BoundsParams {
    pane_id: String,
    bounds: Bounds,
}

#[derive(Debug, Deserialize)]
struct EvalParams {
    pane_id: String,
    code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CdpAttachParams {
    pane_id: String,
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CdpSendParams {
    pane_id: String,
    session_id: String,
    message: String,
}

#[derive(Debug, Deserialize)]
struct CdpDetachParams {
    pane_id: String,
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesignScreenshotParams {
    pane_id: String,
    rect: Bounds,
}

#[derive(Debug, Deserialize)]
struct DesignModeParams {
    pane_id: String,
    action: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FindInPageParams {
    pane_id: String,
    text: String,
    forward: Option<bool>,
    find_next: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct StopFindInPageParams {
    pane_id: String,
    action: String,
}

#[derive(Debug, Deserialize)]
struct DeviceEmulationParams {
    pane_id: String,
    params: Option<DeviceMetrics>,
}

#[derive(Debug, Deserialize)]
struct DeviceMetrics {
    width: f64,
    height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CookieDomainParams {
    domain: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CookieSetManyParams {
    pane_id: String,
    cookies: Vec<Value>,
}

#[derive(Debug, Deserialize)]
struct DownloadCancelParams {
    id: String,
}

#[derive(Debug, Deserialize)]
struct ForwardableChordsParams {
    chords: Vec<String>,
}

fn parse<T: for<'de> Deserialize<'de>>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|error| format!("invalid browser parameters: {error}"))
}

fn state(app: &AppHandle) -> Result<tauri::State<'_, BrowserState>, String> {
    app.try_state::<BrowserState>()
        .ok_or_else(|| "BrowserState is not managed by the native shell".to_string())
}

struct QueuedBrowserEvent {
    app: AppHandle,
    label: String,
    payload: Value,
    node_sink: Option<Arc<dyn Fn(String, Value, Option<String>) + Send + Sync>>,
}

static EVENT_QUEUE: OnceLock<Arc<Mutex<VecDeque<QueuedBrowserEvent>>>> = OnceLock::new();
static EVENT_WORKER_RUNNING: AtomicBool = AtomicBool::new(false);
const MAX_EVENT_QUEUE: usize = 512;

fn event_queue() -> Arc<Mutex<VecDeque<QueuedBrowserEvent>>> {
    EVENT_QUEUE
        .get_or_init(|| Arc::new(Mutex::new(VecDeque::new())))
        .clone()
}

fn event_is_lossy(payload: &Value) -> bool {
    matches!(
        payload.get("kind").and_then(Value::as_str),
        Some("console" | "frame" | "cdp")
    )
}

fn start_event_worker(queue: Arc<Mutex<VecDeque<QueuedBrowserEvent>>>) {
    if EVENT_WORKER_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            let next = queue.lock().ok().and_then(|mut queue| queue.pop_front());
            let Some(event) = next else {
                EVENT_WORKER_RUNNING.store(false, Ordering::Release);
                if queue.lock().ok().is_some_and(|queue| !queue.is_empty()) {
                    start_event_worker(queue.clone());
                }
                return;
            };
            let _ = event.app.emit_to(
                EventTarget::Webview {
                    label: event.label.clone(),
                },
                BROWSER_EVENT,
                event.payload.clone(),
            );
            if let Some(sink) = event.node_sink {
                let deep_link =
                    event.payload.get("kind").and_then(Value::as_str) == Some("deepLink");
                sink(
                    BROWSER_EVENT.to_string(),
                    event.payload.clone(),
                    Some(event.label),
                );
                if deep_link {
                    sink("deep-link".to_string(), event.payload, None);
                }
            }
        }
    });
}

fn emit_to_label(app: &AppHandle, label: &str, payload: Value) {
    let queue = event_queue();
    let node_sink = app.try_state::<BrowserState>().and_then(|state| {
        state
            .node_event_sink
            .lock()
            .ok()
            .and_then(|sink| sink.clone())
    });
    if let Ok(mut events) = queue.lock() {
        if events.len() >= MAX_EVENT_QUEUE {
            if event_is_lossy(&payload) {
                if payload.get("kind").and_then(Value::as_str) == Some("cdp") {
                    if let Some(sink) = node_sink.as_ref() {
                        sink(
                            BROWSER_EVENT.to_string(),
                            json!({
                                "kind": "cdpClosed",
                                "paneId": payload.get("paneId"),
                                "reason": "native browser event backpressure",
                            }),
                            Some(label.to_string()),
                        );
                    }
                }
                return;
            }
            if let Some(index) = events
                .iter()
                .position(|event| event_is_lossy(&event.payload))
            {
                events.remove(index);
            } else {
                return;
            }
        }
        events.push_back(QueuedBrowserEvent {
            app: app.clone(),
            label: label.to_string(),
            payload,
            node_sink,
        });
    }
    start_event_worker(queue);
}

fn emit_for_pane(app: &AppHandle, pane_id: &str, payload: Value) {
    let label = app.try_state::<BrowserState>().and_then(|state| {
        state
            .panes
            .lock()
            .ok()
            .and_then(|panes| panes.get(pane_id).map(|pane| pane.owner_label.clone()))
    });
    if let Some(label) = label {
        emit_to_label(app, &label, payload);
    }
}

fn require_webview(
    app: &AppHandle,
    caller_label: &str,
    pane_id: &str,
) -> Result<tauri::Webview, String> {
    let state = state(app)?;
    {
        let panes = state
            .panes
            .lock()
            .map_err(|_| "browser state lock poisoned".to_string())?;
        let pane = panes
            .get(pane_id)
            .ok_or_else(|| format!("no browser pane {pane_id}"))?;
        if pane.owner_label != caller_label {
            return Err("browser pane belongs to another trusted renderer".to_string());
        }
    }
    app.get_webview(&native_label(pane_id))
        .ok_or_else(|| format!("native browser pane {pane_id} is not live"))
}

fn native_label(pane_id: &str) -> String {
    let sanitized: String = pane_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '-'
            }
        })
        .collect();
    format!("browser-{sanitized}")
}

fn allow_guest_url(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about")
}

fn deep_link_schemes() -> Vec<String> {
    let mut schemes = vec!["superset".to_string()];
    if let Ok(workspace) = std::env::var("SUPERSET_WORKSPACE_NAME")
        && !workspace.is_empty()
    {
        let workspace = workspace
            .to_ascii_lowercase()
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || character == '-' {
                    character
                } else {
                    '-'
                }
            })
            .take(32)
            .collect::<String>();
        if !workspace.is_empty() && workspace != "superset" {
            schemes.push(format!("superset-{workspace}"));
        }
    }
    schemes
}

fn opener_disposition<O: AsCefWindowOpener>(
    opener: &O,
) -> tauri_runtime_cef::cef::WindowOpenDisposition {
    opener
        .as_cef_window_opener()
        .map(|opener| opener.disposition())
        .unwrap_or(tauri_runtime_cef::cef::WindowOpenDisposition::UNKNOWN)
}

fn frame_event_name(event: &FrameEvent) -> (&'static str, Option<String>) {
    match &event.kind {
        FrameEventKind::Created => ("created", None),
        FrameEventKind::Attached => ("attached", None),
        FrameEventKind::Detached => ("detached", None),
        FrameEventKind::Destroyed => ("destroyed", None),
        FrameEventKind::NavigationStarted { url } => ("navigationStarted", Some(url.to_string())),
        FrameEventKind::DocumentCommitted { url } => ("navigationCommitted", Some(url.to_string())),
        FrameEventKind::NavigationFailed { url } => ("navigationFailed", Some(url.to_string())),
        FrameEventKind::AddressChanged { url } => ("addressChanged", Some(url.to_string())),
        FrameEventKind::LoadingStateChanged { is_loading } => (
            if *is_loading {
                "loadingStarted"
            } else {
                "loadingFinished"
            },
            None,
        ),
        FrameEventKind::MainFrameChanged => ("mainFrameChanged", None),
        FrameEventKind::RendererTerminated => ("rendererTerminated", None),
        _ => ("frame", None),
    }
}

fn page_capture_result(result: Value, url: String) -> Result<Value, String> {
    let base64 = result
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| "native screenshot did not return PNG data".to_string())?;
    Ok(json!({"base64": base64, "url": url}))
}

fn cdp_result_value(result: Value) -> Result<Value, String> {
    if let Some(details) = result.get("exceptionDetails") {
        return Err(details.to_string());
    }
    Ok(result
        .get("result")
        .and_then(|value| value.get("value"))
        .cloned()
        .unwrap_or(Value::Null))
}

fn register_cdp_observer(
    app: &AppHandle,
    pane_id: &str,
    webview: &tauri::Webview,
) -> Result<(), String> {
    let app = app.clone();
    let pane_id_owned = pane_id.to_string();
    let browser_state = state(&app)?;
    let pending = browser_state.pending_cdp.clone();
    let sessions = browser_state.cdp_sessions.clone();
    webview
		.on_dev_tools_protocol(move |protocol| match protocol {
			DevToolsProtocol::MethodResult {
				message_id,
				success,
				result,
			} => {
					let payload = serde_json::from_slice::<Value>(&result)
						.unwrap_or_else(|_| json!({"raw": String::from_utf8_lossy(&result)}));
					if let Ok(mut pending) = pending.lock()
						&& let Some(sender) = pending.remove(&(pane_id_owned.clone(), message_id))
					{
						let _ = sender.send(Ok(CdpMethodResult {
							success,
							value: payload,
						}));
						return;
					}
				emit_for_pane(
					&app,
					&pane_id_owned,
					json!({
						"kind": "cdp",
						"paneId": pane_id_owned,
						"payload": payload.to_string()
					}),
				);
			}
            DevToolsProtocol::Event { method, params } => {
                let payload = json!({"method": method, "params": serde_json::from_slice::<Value>(&params).unwrap_or(Value::Null)});
                let session_id = sessions
                    .lock()
                    .ok()
                    .and_then(|sessions| sessions.get(&pane_id_owned).cloned());
				emit_for_pane(
					&app,
					&pane_id_owned,
					json!({"kind": "cdp", "paneId": pane_id_owned, "sessionId": session_id, "payload": payload.to_string()}),
                );
			}
			DevToolsProtocol::Message(_) => {}
		})
		.map_err(|error| error.to_string())?;
    Ok(())
}

fn send_cdp_response(
    app: &AppHandle,
    caller_label: &str,
    pane_id: &str,
    method: &str,
    params: Value,
    session_id: Option<Value>,
) -> Result<CdpMethodResult, String> {
    let webview = require_webview(app, caller_label, pane_id)?;
    let id = allocate_devtools_message_id().map_err(|error| error.to_string())?;
    let (sender, receiver) = mpsc::channel();
    state(app)?
        .pending_cdp
        .lock()
        .map_err(|_| "browser state lock poisoned".to_string())?
        .insert((pane_id.to_string(), id), sender);
    let mut message = json!({"id": id, "method": method, "params": params});
    if let Some(session_id) = session_id {
        message["sessionId"] = session_id;
    }
    let message = message.to_string();
    if let Err(error) = webview.send_dev_tools_message(message.as_bytes()) {
        state(app)?
            .pending_cdp
            .lock()
            .ok()
            .map(|mut pending| pending.remove(&(pane_id.to_string(), id)));
        return Err(error.to_string());
    }
    match receiver.recv_timeout(NATIVE_TIMEOUT) {
        Ok(result) => result,
        Err(_) => {
            let _ = state(app).and_then(|state| {
                state
                    .pending_cdp
                    .lock()
                    .map_err(|_| "browser state lock poisoned".to_string())?
                    .remove(&(pane_id.to_string(), id));
                Ok(())
            });
            Err(format!("CEF did not answer {method} in time"))
        }
    }
}

fn send_cdp(
	app: &AppHandle,
	caller_label: &str,
	pane_id: &str,
	method: &str,
	params: Value,
) -> Result<Value, String> {
	let response = send_cdp_response(app, caller_label, pane_id, method, params, None)?;
	if response.success {
		return Ok(response.value);
	}
	Err(response
		.value
		.get("message")
		.and_then(Value::as_str)
		.map(ToOwned::to_owned)
		.unwrap_or_else(|| response.value.to_string()))
}

fn send_raw_cdp(
    app: &AppHandle,
    caller_label: &str,
    params: CdpSendParams,
) -> Result<Value, String> {
    require_webview(app, caller_label, &params.pane_id)?;
    let active_session = state(app)?
        .cdp_sessions
        .lock()
        .map_err(|_| "browser CDP state lock poisoned".to_string())?
        .get(&params.pane_id)
        .cloned()
        .ok_or_else(|| "browser CDP session is not attached".to_string())?;
    if active_session != params.session_id {
        return Err("browser CDP session does not match the attached session".to_string());
    }
    let input: Value = serde_json::from_str(&params.message)
        .map_err(|error| format!("invalid CDP message: {error}"))?;
    let method = input
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| "CDP message is missing method".to_string())?;
    let id = input.get("id").cloned().unwrap_or(Value::Null);
    let session_id = input.get("sessionId").cloned();
	let response = send_cdp_response(
        app,
        caller_label,
        &params.pane_id,
        method,
        input.get("params").cloned().unwrap_or_else(|| json!({})),
        session_id.clone(),
    );
	let mut envelope = match response {
		Ok(response) if response.success => json!({"id": id, "result": response.value}),
		Ok(response) => {
			let error = response
				.value
				.get("error")
				.cloned()
				.unwrap_or(response.value);
			json!({"id": id, "error": error})
		}
		Err(error) => json!({"id": id, "error": {"code": -32000, "message": error}}),
	};
	if let Some(session_id) = session_id {
		envelope["sessionId"] = session_id;
	}
    Ok(json!({"payload": envelope.to_string()}))
}

fn pane_url(app: &AppHandle, caller_label: &str, pane_id: &str) -> Result<String, String> {
    require_webview(app, caller_label, pane_id)?
        .url()
        .map(|url| url.to_string())
        .map_err(|error| error.to_string())
}

fn update_pane_info(app: &AppHandle, pane_id: &str, patch: Value) {
    if let Some(state) = app.try_state::<BrowserState>() {
        if let Ok(mut panes) = state.panes.lock()
            && let Some(pane) = panes.get_mut(pane_id)
        {
            if let Some(url) = patch.get("url").and_then(Value::as_str) {
                pane.url = url.to_string();
            }
            if let Some(title) = patch.get("title").and_then(Value::as_str) {
                pane.title = title.to_string();
            }
            if let Some(is_loading) = patch.get("isLoading").and_then(Value::as_bool) {
                pane.is_loading = is_loading;
            }
            if let Some(can_go_back) = patch.get("canGoBack").and_then(Value::as_bool) {
                pane.can_go_back = can_go_back;
            }
            if let Some(can_go_forward) = patch.get("canGoForward").and_then(Value::as_bool) {
                pane.can_go_forward = can_go_forward;
            }
        }
    }
}

fn refresh_history_state_deferred(app: &AppHandle, pane_id: &str, native_label: &str) {
    let app = app.clone();
    let pane_id = pane_id.to_string();
    let native_label = native_label.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(webview) = app.get_webview(&native_label) else {
            return;
        };
        let can_go_back = webview.can_go_back().unwrap_or(false);
        let can_go_forward = webview.can_go_forward().unwrap_or(false);
        update_pane_info(
            &app,
            &pane_id,
            json!({
                "canGoBack": can_go_back,
                "canGoForward": can_go_forward,
            }),
        );
        emit_for_pane(
            &app,
            &pane_id,
            json!({
                "kind": "paneState",
                "paneId": pane_id,
                "canGoBack": can_go_back,
                "canGoForward": can_go_forward,
            }),
        );
    });
}

fn remove_pane_metadata(app: &AppHandle, pane_id: &str) {
	if let Some(state) = app.try_state::<BrowserState>()
		&& let Ok(mut panes) = state.panes.lock()
	{
		panes.remove(pane_id);
	}
}

fn reserve_download_path(
    app: &AppHandle,
    state: &BrowserState,
    suggested_name: &str,
) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;

    let sanitized_name = suggested_name
        .chars()
        .map(|character| {
            if character.is_control() || matches!(character, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    let sanitized_name = sanitized_name.trim_matches([' ', '.']);
    let filename = if sanitized_name.is_empty() || sanitized_name == "." || sanitized_name == ".." {
        "download"
    } else {
        sanitized_name
    };
    let path = Path::new(filename);
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("download");
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("");
    let mut reserved = state
        .reserved_download_paths
        .lock()
        .map_err(|_| "browser download state lock poisoned".to_string())?;

    for suffix in 0..10_000_u32 {
        let candidate_name = if suffix == 0 {
            filename.to_string()
        } else if extension.is_empty() {
            format!("{stem} ({suffix})")
        } else {
            format!("{stem} ({suffix}).{extension}")
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() && reserved.insert(candidate.clone()) {
            return Ok(candidate);
        }
    }
    Err("could not reserve a unique browser download path".to_string())
}

fn take_pending_download_path(
    state: &BrowserState,
    pane_id: &str,
    url: &str,
) -> Option<PathBuf> {
    let key = (pane_id.to_string(), url.to_string());
    let mut pending = state.pending_download_paths.lock().ok()?;
    let paths = pending.get_mut(&key)?;
    let path = paths.pop_front();
    if paths.is_empty() {
        pending.remove(&key);
    }
    path
}

fn download_state(complete: bool, canceled: bool, interrupted: bool) -> &'static str {
    if canceled {
        "cancelled"
    } else if interrupted {
        "interrupted"
    } else if complete {
        "completed"
    } else {
        "progressing"
    }
}

fn create_pane(
    app: &AppHandle,
    caller_label: &str,
    params: CreatePaneParams,
) -> Result<Value, String> {
    let state = state(app)?;
    if state
        .panes
        .lock()
        .map_err(|_| "browser state lock poisoned".to_string())?
        .contains_key(&params.pane_id)
    {
        return Err(format!("browser pane {} already exists", params.pane_id));
    }
    let window = app
        .get_window(caller_label)
        .ok_or_else(|| format!("trusted renderer window {caller_label} is not live"))?;
    let url = url::Url::parse(&params.url).map_err(|error| error.to_string())?;
    if !allow_guest_url(&url) {
        return Err("browser pane URL scheme is not allowed".to_string());
    }
    let pane_id = params.pane_id.clone();
    let native_pane_label = native_label(&pane_id);
    let event_app = app.clone();
    let event_id = pane_id.clone();
    let title_app = app.clone();
    let title_id = pane_id.clone();
    let nav_app = app.clone();
    let nav_id = pane_id.clone();
    let popup_app = app.clone();
    let popup_id = pane_id.clone();
    let cdp_app = app.clone();
    let cdp_id = pane_id.clone();
    let console_app = app.clone();
    let console_id = pane_id.clone();
    let download_app = app.clone();
    let download_event_app = cdp_app.clone();
    let download_id = pane_id.clone();
    let download_owner_label = caller_label.to_string();
    let page_app = app.clone();
    let page_id = pane_id.clone();
    let page_native_label = native_pane_label.clone();
    let pane_bounds = params.bounds.unwrap_or(Bounds {
        x: 0.,
        y: 0.,
        width: 1.,
        height: 1.,
    });
    let builder: WebviewBuilder<tauri::DynRuntime> =
        WebviewBuilder::new(native_pane_label, WebviewUrl::External(url))
            .data_store_identifier(BROWSER_DATA_STORE)
            .initialization_script(GUEST_BRIDGE_SCRIPT)
		.browser_runtime_style(RuntimeStyle::Alloy)
		.devtools(true)
		.zoom_hotkeys_enabled(false)
		.on_navigation(move |next| {
			if allow_guest_url(next) {
				emit_for_pane(
					&nav_app,
					&nav_id,
					json!({"kind":"navigationStarted","paneId":nav_id,"url":next.to_string()}),
				);
				true
			} else {
				if deep_link_schemes().iter().any(|scheme| scheme == next.scheme()) {
					emit_for_pane(&nav_app, &nav_id, json!({"kind":"deepLink","paneId":nav_id,"url":next.to_string()}));
				}
				false
			}
		})
		.on_new_window(move |next, features| {
			let disposition = opener_disposition(features.opener());
			let target = classify_open(&next, disposition, &deep_link_schemes());
			match target {
				OpenTarget::Popup => {
					emit_for_pane(
						&popup_app,
						&popup_id,
						json!({"kind":"newWindow","paneId":popup_id,"url":next.to_string(),"popup":true}),
					);
					NewWindowResponse::Allow
				}
				OpenTarget::Pane => {
					emit_for_pane(
						&popup_app,
						&popup_id,
						json!({"kind":"newWindow","paneId":popup_id,"url":next.to_string(),"popup":false}),
					);
					NewWindowResponse::Deny
				}
				OpenTarget::DeepLink => {
					emit_for_pane(&popup_app, &popup_id, json!({"kind":"deepLink","paneId":popup_id,"url":next.to_string()}));
					NewWindowResponse::Deny
				}
				OpenTarget::Deny => NewWindowResponse::Deny,
			}
		})
        .on_frame_event(move |event| {
			let (name, url) = frame_event_name(&event);
			let loading = matches!(name, "loadingStarted");
			let mut payload = json!({"kind":name,"paneId":event_id,"browserId":event.browser_id,"frameId":event.frame_id,"isMain":event.is_main,"url":url});
			if matches!(name, "loadingStarted" | "loadingFinished") {
				payload["isLoading"] = Value::Bool(loading);
			}
			if let Some(url) = payload.get("url").and_then(Value::as_str) {
				update_pane_info(&event_app, &event_id, json!({"url":url,"isLoading":loading}));
			}
            emit_for_pane(&event_app, &event_id, payload);
        })
        .on_page_load(move |_webview, payload| {
            let url = payload.url().to_string();
            let is_loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            update_pane_info(&page_app, &page_id, json!({
                "url": url,
                "isLoading": is_loading,
            }));
            if !is_loading {
                refresh_history_state_deferred(&page_app, &page_id, &page_native_label);
            }
            emit_for_pane(&page_app, &page_id, json!({
                "kind": if is_loading { "loadingStarted" } else { "loadingFinished" },
                "paneId": page_id,
                "url": url,
                "isLoading": is_loading,
            }));
        })
        .on_console_message(move |message| {
			emit_for_pane(
				&console_app,
				&console_id,
				json!({"kind":"console","paneId":console_id,"level":format!("{:?}",message.level).to_lowercase(),"message":message.message,"source":message.source,"line":message.line}),
			);
		})
		.on_document_title_changed(move |_webview, title| {
			update_pane_info(&title_app, &title_id, json!({"title":title}));
			emit_for_pane(&title_app, &title_id, json!({"kind":"paneState","paneId":title_id,"title":title}));
		})
		.on_download(move |_webview, event| {
			match event {
				DownloadEvent::Requested { url, destination } => {
					let suggested_name = destination
						.file_name()
						.and_then(|name| name.to_str())
						.filter(|name| !name.is_empty())
						.or_else(|| url.path_segments().and_then(|segments| segments.last()))
						.filter(|name| !name.is_empty())
						.unwrap_or("download");
					let browser_state = match download_event_app.try_state::<BrowserState>() {
						Some(state) => state,
						None => return false,
					};
					let reserved_path = match reserve_download_path(&download_app, &browser_state, suggested_name) {
						Ok(path) => path,
						Err(error) => {
							eprintln!("[browser] could not reserve download path: {error}");
							return false;
						}
					};
					*destination = reserved_path.clone();
					if let Ok(mut pending) = browser_state.pending_download_paths.lock() {
						pending
							.entry((download_id.clone(), url.to_string()))
							.or_default()
							.push_back(reserved_path.clone());
					}
					let filename = reserved_path
						.file_name()
						.map(|name| name.to_string_lossy().to_string());
					emit_to_label(
						&download_event_app,
						&download_owner_label,
						json!({
							"kind":"download",
							"paneId":download_id,
							"url":url.to_string(),
							"filename":filename,
							"savePath":reserved_path.to_string_lossy(),
							"state":"progressing"
						}),
					);
					true
				}
				DownloadEvent::Updated {
					url,
					id,
					received_bytes,
					total_bytes,
					complete,
					canceled,
					interrupted,
					path,
					control,
				} => {
					let Some(browser_state) = download_event_app.try_state::<BrowserState>() else {
						return true;
					};
					let url_string = url.to_string();
					let id = format!("{download_id}:{id}");
					let terminal = complete || canceled || interrupted;
					let previous = browser_state
						.active_downloads
						.lock()
						.ok()
						.and_then(|downloads| downloads.get(&id).cloned());
					let save_path = path
						.or_else(|| previous.as_ref().and_then(|download| download.save_path.clone()))
						.or_else(|| take_pending_download_path(&browser_state, &download_id, &url_string));
					let control = control.or_else(|| previous.and_then(|download| download.control));
					let active = ActiveDownload {
						pane_id: download_id.clone(),
						owner_label: download_owner_label.clone(),
						save_path: save_path.clone(),
						control: control.clone(),
					};
					if let Ok(mut downloads) = browser_state.active_downloads.lock() {
						if terminal {
							downloads.remove(&id);
						} else {
							downloads.insert(id.clone(), active);
						}
					}
					let filename = save_path
						.as_ref()
						.and_then(|path| path.file_name())
						.map(|name| name.to_string_lossy().to_string());
					if terminal {
						if let Some(path) = save_path.as_ref()
							&& let Ok(mut reserved) = browser_state.reserved_download_paths.lock()
						{
							reserved.remove(path);
						}
					}
					emit_to_label(
						&download_event_app,
						&download_owner_label,
						json!({
							"kind":"download",
							"paneId":download_id,
							"id":id,
							"url":url_string,
							"filename":filename,
							"savePath":save_path.as_ref().map(|path| path.to_string_lossy().to_string()),
							"totalBytes":(total_bytes >= 0).then_some(total_bytes),
							"receivedBytes":received_bytes.max(0),
							"state":download_state(complete, canceled, interrupted),
							"completedAt":terminal.then_some(chrono_like_now())
						}),
					);
					true
				}
				// Updated is the ID-bearing terminal event; forwarding Finished too
				// would duplicate every completion in the Node download store.
				DownloadEvent::Finished { .. } => true,
				_ => true,
			}
		});
    let metadata = PaneMetadata {
        workspace_id: params.workspace_id,
        owner_label: caller_label.to_string(),
        url: params.url,
        title: String::new(),
        is_loading: true,
        can_go_back: false,
        can_go_forward: false,
        zoom_factor: 1.,
    };
    let info = metadata.info(&pane_id);
    state
        .panes
        .lock()
        .map_err(|_| "browser state lock poisoned".to_string())?
        .insert(pane_id.clone(), metadata);
    emit_to_label(
        app,
		caller_label,
        json!({"kind":"paneRegistered","paneId":pane_id,"workspaceId":info.workspace_id,"url":info.url,"title":info.title,"isLoading":info.is_loading,"canGoBack":info.can_go_back,"canGoForward":info.can_go_forward,"zoomFactor":info.zoom_factor}),
    );
	let webview = match window.add_child(
		builder,
		LogicalPosition::new(pane_bounds.x, pane_bounds.y),
		LogicalSize::new(pane_bounds.width.max(1.), pane_bounds.height.max(1.)),
	) {
		Ok(webview) => webview,
		Err(error) => {
			remove_pane_metadata(app, &pane_id);
			emit_to_label(
				app,
				caller_label,
				json!({"kind":"paneClosed","paneId":pane_id,"reason":"native child webview creation failed"}),
			);
			return Err(error.to_string());
		}
	};
	if let Err(error) = register_cdp_observer(&cdp_app, &cdp_id, &webview) {
		let _ = webview.close();
		remove_pane_metadata(app, &pane_id);
		emit_to_label(
			app,
			caller_label,
			json!({"kind":"paneClosed","paneId":pane_id,"reason":"CDP observer registration failed"}),
		);
		return Err(error);
	}
	if params.visible == Some(false)
		&& let Err(error) = webview.hide()
	{
		let _ = webview.close();
		remove_pane_metadata(app, &pane_id);
		emit_to_label(
			app,
			caller_label,
			json!({"kind":"paneClosed","paneId":pane_id,"reason":"native child webview could not be hidden"}),
		);
		return Err(error.to_string());
	}
    Ok(serde_json::to_value(info).map_err(|error| error.to_string())?)
}

fn chrono_like_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn dispatch_existing(
    app: &AppHandle,
    caller_label: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
		"browser.pane.destroy" => {
            let p: PaneParams = parse(params)?;
            let webview = require_webview(app, caller_label, &p.pane_id)?;
            let owner_label = state(app)?
                .panes
                .lock()
                .ok()
                .and_then(|panes| panes.get(&p.pane_id).map(|pane| pane.owner_label.clone()));
			let browser_state = state(app)?;
			let pending = {
				let mut pending = browser_state
					.pending_cdp
					.lock()
					.map_err(|_| "browser CDP state lock poisoned".to_string())?;
				let keys = pending
					.keys()
					.filter(|(pane_id, _)| pane_id == &p.pane_id)
					.cloned()
					.collect::<Vec<_>>();
				keys.into_iter()
					.filter_map(|key| pending.remove(&key))
					.collect::<Vec<_>>()
			};
			for sender in pending {
				let _ = sender.send(Err("browser pane closed".to_string()));
			}
			if let Ok(mut sessions) = browser_state.cdp_sessions.lock() {
				sessions.remove(&p.pane_id);
			}
			let downloads = {
				let mut downloads = browser_state
					.active_downloads
					.lock()
					.map_err(|_| "browser download state lock poisoned".to_string())?;
				let ids = downloads
					.iter()
					.filter(|(_, download)| download.pane_id == p.pane_id)
					.map(|(id, _)| id.clone())
					.collect::<Vec<_>>();
				ids.into_iter()
					.filter_map(|id| downloads.remove(&id))
					.collect::<Vec<_>>()
			};
			let reserved_paths = downloads
				.iter()
				.filter_map(|download| download.save_path.as_ref())
				.cloned()
				.collect::<HashSet<_>>();
			if let Ok(mut reserved) = browser_state.reserved_download_paths.lock() {
				reserved.retain(|path| !reserved_paths.contains(path));
			}
			if let Ok(mut pending_paths) = browser_state.pending_download_paths.lock() {
				pending_paths.retain(|(pane_id, _), _| pane_id != &p.pane_id);
			}
			let cancellation = if !downloads.is_empty() {
				let download_controls = downloads
					.into_iter()
					.filter_map(|download| download.control)
					.collect::<Vec<_>>();
				if download_controls.is_empty() {
					Ok(())
				} else {
					webview.with_cef_webview(move |_| {
						for control in download_controls {
							control.cancel();
						}
					})
					.map_err(|error| error.to_string())
				}
			} else {
				Ok(())
			};
			let close_result = webview.close().map_err(|error| error.to_string());
            state(app)?
                .panes
                .lock()
                .map_err(|_| "browser state lock poisoned".to_string())?
                .remove(&p.pane_id);
            if let Some(owner_label) = owner_label {
                emit_to_label(
                    app,
                    &owner_label,
                    json!({"kind":"paneClosed","paneId":p.pane_id}),
                );
            }
			close_result?;
			cancellation?;
            Ok(json!({"success":true}))
        }
        "browser.pane.navigate" => {
            let p: NavigateParams = parse(params)?;
            let url = url::Url::parse(&p.url).map_err(|error| error.to_string())?;
            if !allow_guest_url(&url) {
                return Err("browser pane URL scheme is not allowed".to_string());
            }
            require_webview(app, caller_label, &p.pane_id)?
                .navigate(url)
                .map_err(|error| error.to_string())?;
            Ok(json!({"success":true}))
        }
        "browser.pane.info" => {
            let p: PaneParams = parse(params)?;
            let webview = require_webview(app, caller_label, &p.pane_id)?;
            let url = webview
                .url()
                .map_err(|error| error.to_string())?
                .to_string();
            let can_go_back = webview.can_go_back().map_err(|error| error.to_string())?;
            let can_go_forward = webview
                .can_go_forward()
                .map_err(|error| error.to_string())?;
            let state = state(app)?;
            let mut panes = state
                .panes
                .lock()
                .map_err(|_| "browser state lock poisoned".to_string())?;
            let pane = panes
                .get_mut(&p.pane_id)
                .ok_or_else(|| format!("no browser pane {}", p.pane_id))?;
            pane.url = url;
            pane.can_go_back = can_go_back;
            pane.can_go_forward = can_go_forward;
            Ok(serde_json::to_value(pane.info(&p.pane_id)).map_err(|error| error.to_string())?)
        }
        "browser.panes.list" => {
            let workspace_id = params.get("workspaceId").and_then(Value::as_str);
            let state = state(app)?;
            let panes = state
                .panes
                .lock()
                .map_err(|_| "browser state lock poisoned".to_string())?;
            let result = panes
                .iter()
                .filter(|(_, pane)| pane.owner_label == caller_label)
                .filter(|(_, pane)| {
                    workspace_id
                        .is_none_or(|workspace| pane.workspace_id.as_deref() == Some(workspace))
                })
                .map(|(pane_id, pane)| pane.info(pane_id))
                .collect::<Vec<_>>();
            Ok(serde_json::to_value(result).map_err(|error| error.to_string())?)
        }
        "browser.pane.goBack" => {
            let p: PaneParams = parse(params)?;
            require_webview(app, caller_label, &p.pane_id)?
                .go_back()
                .map_err(|error| error.to_string())?;
            Ok(json!({"success":true}))
        }
        "browser.pane.goForward" => {
            let p: PaneParams = parse(params)?;
            require_webview(app, caller_label, &p.pane_id)?
                .go_forward()
                .map_err(|error| error.to_string())?;
            Ok(json!({"success":true}))
        }
        "browser.pane.reload" => {
            let p: Value = params;
            let pane: PaneParams = parse(p.clone())?;
            let hard = p.get("hard").and_then(Value::as_bool).unwrap_or(false);
            let webview = require_webview(app, caller_label, &pane.pane_id)?;
            if hard {
                let _ = send_cdp(
                    app,
                    caller_label,
                    &pane.pane_id,
                    "Page.reload",
                    json!({"ignoreCache":true}),
                )?;
            } else {
                webview.reload().map_err(|error| error.to_string())?;
            }
            Ok(json!({"success":true}))
        }
        "browser.pane.evaluate" => {
            let p: EvalParams = parse(params)?;
            let result = send_cdp(
                app,
                caller_label,
                &p.pane_id,
                "Runtime.evaluate",
                json!({"expression":p.code,"returnByValue":true,"awaitPromise":true}),
            )?;
            cdp_result_value(result)
        }
        "browser.pane.screenshot" => {
            let p: PaneParams = parse(params)?;
            let url = pane_url(app, caller_label, &p.pane_id)?;
            let result = send_cdp(
                app,
                caller_label,
                &p.pane_id,
                "Page.captureScreenshot",
                json!({"format":"png"}),
            )?;
            page_capture_result(result, url)
        }
        "browser.pane.designMode" => {
            let p: DesignModeParams = parse(params)?;
            let script = match p.action.as_str() {
                "arm" => "window.__supersetDesignMode?.arm?.()",
                _ => "window.__supersetDesignMode?.teardown?.()",
            };
            let _ = send_cdp(
                app,
                caller_label,
                &p.pane_id,
                "Runtime.evaluate",
                json!({"expression":script,"returnByValue":true}),
            )?;
            Ok(json!({"success":true}))
        }
        "browser.pane.findInPage" => {
            let p: FindInPageParams = parse(params)?;
            let expression = serde_json::to_string(&p.text).map_err(|error| error.to_string())?;
            let script = format!(
                "(() => {{ const raw={expression}; const q=raw.toLowerCase(); if (!q) return {{activeMatchOrdinal:0,matches:0}}; const text=(document.body?.innerText||'').toLowerCase(); const matches=text.split(q).length-1; const found=window.find ? window.find(raw,false,{backwards},{wrap},false,false,false) : false; return {{activeMatchOrdinal:found?1:0,matches}}; }})()",
                backwards = if p.forward.unwrap_or(true) {
                    "false"
                } else {
                    "true"
                },
                wrap = if p.find_next.unwrap_or(true) {
                    "true"
                } else {
                    "false"
                },
            );
            let result = send_cdp(
                app,
                caller_label,
                &p.pane_id,
                "Runtime.evaluate",
                json!({"expression":script,"returnByValue":true}),
            )?;
            let result = cdp_result_value(result)?;
            let active = result
                .get("activeMatchOrdinal")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let matches = result.get("matches").and_then(Value::as_u64).unwrap_or(0);
            emit_for_pane(
                app,
                &p.pane_id,
                json!({"kind":"foundInPage","paneId":p.pane_id,"activeMatchOrdinal":active,"matches":matches}),
            );
            Ok(
                json!({"activeMatchOrdinal":active,"matches":matches,"forward":p.forward,"findNext":p.find_next}),
            )
        }
        "browser.pane.stopFindInPage" => {
            let p: StopFindInPageParams = parse(params)?;
            let _ = p.action;
            let _ = send_cdp(
                app,
                caller_label,
                &p.pane_id,
                "Runtime.evaluate",
                json!({"expression":"window.getSelection?.()?.removeAllRanges?.()"}),
            )?;
            Ok(json!({"success":true}))
        }
        "browser.pane.print" => {
            let p: PaneParams = parse(params)?;
            require_webview(app, caller_label, &p.pane_id)?
                .print()
                .map_err(|error| error.to_string())?;
            Ok(json!({"success":true}))
        }
        "browser.pane.designScreenshot" => {
            let p: DesignScreenshotParams = parse(params)?;
            let hide = "window.__supersetDesignMode?.host && (window.__supersetDesignMode.host.style.display='none')";
            let restore = "window.__supersetDesignMode?.host && (window.__supersetDesignMode.host.style.display='')";
            let _ = send_cdp(
                app,
                caller_label,
                &p.pane_id,
                "Runtime.evaluate",
                json!({"expression":hide}),
            )?;
            let result = send_cdp(
                app,
                caller_label,
                &p.pane_id,
                "Page.captureScreenshot",
                json!({"format":"png","clip":{"x":p.rect.x,"y":p.rect.y,"width":p.rect.width,"height":p.rect.height,"scale":1}}),
            );
            let _ = send_cdp(
                app,
                caller_label,
                &p.pane_id,
                "Runtime.evaluate",
                json!({"expression":restore}),
            );
            let result = result?;
            let base64 = result
                .get("data")
                .and_then(Value::as_str)
                .ok_or_else(|| "native design screenshot did not return PNG data".to_string())?;
            Ok(
                json!({"mimeType":"image/png","dataUrl":format!("data:image/png;base64,{base64}"),"width":p.rect.width.round(),"height":p.rect.height.round()}),
            )
        }
        "browser.pane.setBounds" => {
            let p: BoundsParams = parse(params)?;
            require_webview(app, caller_label, &p.pane_id)?
                .set_position(LogicalPosition::new(p.bounds.x, p.bounds.y))
                .map_err(|error| error.to_string())?;
            require_webview(app, caller_label, &p.pane_id)?
                .set_size(LogicalSize::new(
                    p.bounds.width.max(1.),
                    p.bounds.height.max(1.),
                ))
                .map_err(|error| error.to_string())?;
            Ok(json!({"success":true}))
        }
        "browser.pane.setVisibility" => {
            let p: VisibilityParams = parse(params)?;
            if p.visible {
                require_webview(app, caller_label, &p.pane_id)?.show()
            } else {
                require_webview(app, caller_label, &p.pane_id)?.hide()
            }
            .map_err(|error| error.to_string())?;
            Ok(json!({"success":true}))
        }
        "browser.pane.focus" => {
            let p: PaneParams = parse(params)?;
            require_webview(app, caller_label, &p.pane_id)?
                .set_focus()
                .map_err(|error| error.to_string())?;
            emit_for_pane(
                app,
                &p.pane_id,
                json!({"kind":"paneFocus","paneId":p.pane_id}),
            );
            Ok(json!({"success":true}))
        }
        "browser.pane.openDevTools" => {
            let p: PaneParams = parse(params)?;
            require_webview(app, caller_label, &p.pane_id)?.open_devtools();
            Ok(json!({"success":true}))
        }
        "browser.pane.setZoom" => {
            let p: ZoomParams = parse(params)?;
            require_webview(app, caller_label, &p.pane_id)?
                .set_zoom(p.zoom_factor)
                .map_err(|error| error.to_string())?;
            Ok(json!({"success":true}))
        }
        "browser.pane.setDeviceEmulation" => {
            let p: DeviceEmulationParams = parse(params)?;
            let method = if p.params.is_some() {
                "Emulation.setDeviceMetricsOverride"
            } else {
                "Emulation.clearDeviceMetricsOverride"
            };
            let metrics = p.params.map(|metrics| json!({"width":metrics.width.round(),"height":metrics.height.round(),"deviceScaleFactor":1,"mobile":false})).unwrap_or_else(|| json!({}));
            let _ = send_cdp(app, caller_label, &p.pane_id, method, metrics)?;
            Ok(json!({"success":true}))
        }
        "browser.cdp.attach" => {
            let p: CdpAttachParams = parse(params)?;
            require_webview(app, caller_label, &p.pane_id)?;
			let browser_state = state(app)?;
			let mut sessions = browser_state
                .cdp_sessions
                .lock()
                .map_err(|_| "browser CDP state lock poisoned".to_string())?;
			if sessions.contains_key(&p.pane_id) {
				return Err("browser pane already has an attached CDP session".to_string());
			}
			sessions.insert(p.pane_id, p.session_id);
            Ok(json!({"success":true}))
        }
		"browser.cdp.detach" => {
			let p: CdpDetachParams = parse(params)?;
			require_webview(app, caller_label, &p.pane_id)?;
			let state = state(app)?;
			let mut sessions = state
				.cdp_sessions
				.lock()
				.map_err(|_| "browser state lock poisoned".to_string())?
			;
			if sessions.get(&p.pane_id) != Some(&p.session_id) {
				return Err("browser CDP session does not match the attached session".to_string());
			}
			sessions.remove(&p.pane_id);
            Ok(json!({"success":true}))
        }
        "browser.cdp.send" => {
            let p: CdpSendParams = parse(params)?;
            send_raw_cdp(app, caller_label, p)
        }
        "browser.storage.clear" => {
            let p: Value = params;
            let kind = p
                .get("type")
                .or_else(|| p.get("type_"))
                .and_then(Value::as_str)
                .unwrap_or("all");
            let method = match kind {
                "cookies" => "Network.clearBrowserCookies",
                "cache" => "Network.clearBrowserCache",
                _ => "Storage.clearDataForOrigin",
            };
            let panes = state(app)?
                .panes
                .lock()
                .map_err(|_| "browser state lock poisoned".to_string())?
                .iter()
                .filter(|(_, pane)| pane.owner_label == caller_label)
                .map(|(pane_id, _)| pane_id.clone())
                .collect::<Vec<_>>();
            let mut errors = Vec::new();
            for pane_id in panes {
                if let Err(error) = send_cdp(
                    app,
                    caller_label,
                    &pane_id,
                    method,
                    json!({"storageTypes":"all"}),
                ) {
                    errors.push(error);
                }
            }
            if !errors.is_empty() {
                return Err(errors.join("; "));
            }
            Ok(json!({"success":true}))
        }
        "browser.cookies.domains" => {
            let panes = state(app)?
                .panes
                .lock()
                .map_err(|_| "browser state lock poisoned".to_string())?
                .iter()
                .filter(|(_, pane)| pane.owner_label == caller_label)
                .map(|(pane_id, _)| pane_id.clone())
                .collect::<Vec<_>>();
            let mut counts: HashMap<String, usize> = HashMap::new();
            for pane_id in panes {
                if let Ok(result) = send_cdp(
                    app,
                    caller_label,
                    &pane_id,
                    "Network.getAllCookies",
                    json!({}),
                ) && let Some(cookies) = result.get("cookies").and_then(Value::as_array)
                {
                    for cookie in cookies {
                        if let Some(domain) = cookie.get("domain").and_then(Value::as_str) {
                            *counts
                                .entry(domain.trim_start_matches('.').to_string())
                                .or_default() += 1;
                        }
                    }
                }
            }
            Ok(serde_json::to_value(counts.into_iter().map(|(domain, cookie_count)| json!({"domain":domain,"cookieCount":cookie_count})).collect::<Vec<_>>()).map_err(|error| error.to_string())?)
        }
        "browser.cookies.clearDomain" => {
            let p: CookieDomainParams = parse(params)?;
            let panes = state(app)?
                .panes
                .lock()
                .map_err(|_| "browser state lock poisoned".to_string())?
                .iter()
                .filter(|(_, pane)| pane.owner_label == caller_label)
                .map(|(pane_id, _)| pane_id.clone())
                .collect::<Vec<_>>();
            let mut removed = 0_u64;
            for pane_id in panes {
                if let Ok(result) = send_cdp(
                    app,
                    caller_label,
                    &pane_id,
                    "Network.getAllCookies",
                    json!({}),
                ) && let Some(cookies) = result.get("cookies").and_then(Value::as_array)
                {
                    for cookie in cookies {
                        let cookie_domain = cookie
                            .get("domain")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .trim_start_matches('.');
                        if cookie_domain != p.domain.trim_start_matches('.')
                            && !cookie_domain
                                .ends_with(&format!(".{}", p.domain.trim_start_matches('.')))
                        {
                            continue;
                        }
                        let name = cookie
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let path = cookie.get("path").and_then(Value::as_str).unwrap_or("/");
                        if send_cdp(
                            app,
                            caller_label,
                            &pane_id,
                            "Network.deleteCookies",
                            json!({"name":name,"domain":cookie_domain,"path":path}),
                        )
                        .is_ok()
                        {
                            removed += 1;
                        }
                    }
                }
            }
            Ok(json!({"success":true,"domain":p.domain,"removed":removed}))
        }
        "browser.cookies.setMany" => {
            let p: CookieSetManyParams = parse(params)?;
            let mut imported = 0_u64;
            let mut skipped = 0_u64;
            for cookie in p.cookies {
                let domain = cookie
                    .get("domain")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if domain.trim_start_matches('.').ends_with("superset.sh")
                    || domain.contains("localhost")
                    || domain.contains("127.0.0.1")
                {
                    skipped += 1;
                    continue;
                }
                let mut cdp = json!({
                    "name": cookie.get("name").and_then(Value::as_str).unwrap_or_default(),
                    "value": cookie.get("value").and_then(Value::as_str).unwrap_or_default(),
                    "url": cookie.get("url").and_then(Value::as_str),
                    "domain": if domain.is_empty() { Value::Null } else { Value::String(domain.to_string()) },
                    "path": cookie.get("path").and_then(Value::as_str).unwrap_or("/"),
                    "secure": cookie.get("secure").and_then(Value::as_bool).unwrap_or(false),
                    "httpOnly": cookie.get("httpOnly").and_then(Value::as_bool).unwrap_or(false),
                });
                if let Some(expiration) = cookie.get("expirationDate").and_then(Value::as_f64) {
                    cdp["expires"] = Value::from(expiration);
                }
                if send_cdp(app, caller_label, &p.pane_id, "Network.setCookie", cdp).is_ok() {
                    imported += 1;
                } else {
                    skipped += 1;
                }
            }
            Ok(json!({"imported":imported,"skipped":skipped,"keyUnavailable":false}))
        }
        "browser.hotkeys.setForwardableChords" => {
            let p: ForwardableChordsParams = parse(params)?;
            let chords = serde_json::to_string(&p.chords).map_err(|error| error.to_string())?;
            let panes = state(app)?
                .panes
                .lock()
                .map_err(|_| "browser state lock poisoned".to_string())?
                .iter()
                .filter(|(_, pane)| pane.owner_label == caller_label)
                .map(|(pane_id, _)| pane_id.clone())
                .collect::<Vec<_>>();
            let script = format!("window.__supersetForwardableChords = new Set({chords});");
            for pane_id in panes {
                let _ = send_cdp(
                    app,
                    caller_label,
                    &pane_id,
                    "Runtime.evaluate",
                    json!({"expression":script}),
                )?;
            }
            Ok(json!({"success":true}))
        }
        "browser.download.cancel" => {
            let p: DownloadCancelParams = parse(params)?;
            let download = state(app)?
                .active_downloads
                .lock()
                .map_err(|_| "browser download state lock poisoned".to_string())?
                .get(&p.id)
                .cloned()
                .ok_or_else(|| format!("native CEF download {} is no longer active", p.id))?;
            if download.owner_label != caller_label {
                return Err("browser download belongs to another trusted renderer".to_string());
            }
			let Some(control) = download.control else {
                return Err(format!(
                    "native CEF download {} has no cancellation callback",
                    p.id
				));
			};
			require_webview(app, caller_label, &download.pane_id)?
				.with_cef_webview(move |_| control.cancel())
				.map_err(|error| error.to_string())?;
			Ok(json!(true))
        }
        _ => Err(format!("unknown browser method {method}")),
    }
}

/// Native-shell entry point. `caller_label` is supplied by the shell from the
/// trusted Tauri Webview, never from a guest document or renderer payload.
pub fn dispatch(
    app: &AppHandle,
    caller_label: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    if method == "browser.pane.create" {
        return create_pane(app, caller_label, parse(params)?);
    }
    dispatch_existing(app, caller_label, method, params)
}

#[cfg(test)]
mod profile_path_tests {
    use super::browser_data_store_directory;
    use std::path::Path;

    #[test]
    fn browser_profile_matches_the_pinned_cef_data_store_resolver() {
        assert_eq!(
            browser_data_store_directory(Path::new("/fixture/user-data/cef")),
            Path::new(
                "/fixture/user-data/cef/DataStore-73757065-7273-6574-2d62-726f77736572"
            )
        );
    }
}
