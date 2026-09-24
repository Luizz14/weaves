use crate::sidecar::{read_frame, write_frame};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::time::Duration;

const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct NativeRequest {
    pub id: String,
    pub method: String,
    pub params: Value,
    pub window_label: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NativeEvent {
    pub name: String,
    pub payload: Value,
    pub window_label: Option<String>,
}

pub type NodeEventHandler = Arc<dyn Fn(NativeEvent) + Send + Sync + 'static>;
pub type NodeRequestHandler =
    Arc<dyn Fn(NativeRequest) -> Result<Value, String> + Send + Sync + 'static>;

struct NodeHostInner {
    writer: mpsc::SyncSender<Value>,
    events: mpsc::SyncSender<NativeEvent>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<String, mpsc::SyncSender<Result<Value, String>>>>,
    ready: (Mutex<bool>, Condvar),
    closed: AtomicBool,
    fatal_notified: AtomicBool,
    active_requests: AtomicUsize,
    next_id: AtomicU64,
    event_handler: NodeEventHandler,
    request_handler: NodeRequestHandler,
}

#[derive(Clone)]
pub struct NodeHost {
    inner: Arc<NodeHostInner>,
}

impl NodeHost {
    pub fn spawn(
        node_binary: &Path,
        service_entry: &Path,
        bootstrap: Value,
        event_handler: NodeEventHandler,
        request_handler: NodeRequestHandler,
    ) -> Result<Self, String> {
        let mut command = Command::new(node_binary);
        command
            .arg(service_entry)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Node logs must never share stdout with the framed transport.
            .stderr(Stdio::inherit())
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .env_remove("ELECTRON_RUN_AS_NODE")
            .env_remove("ELECTRON_NO_ATTACH_CONSOLE")
            .env("SUPERSET_NATIVE_RUNTIME", "tauri")
            .env("SUPERSET_DESKTOP_SERVICE", "1");

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to start Node desktop service: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Node desktop service stdin was not piped".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Node desktop service stdout was not piped".to_string())?;

        let (writer, writer_rx) = mpsc::sync_channel(256);
        let (events, events_rx) = mpsc::sync_channel(512);
        let host = Self {
            inner: Arc::new(NodeHostInner {
                writer,
                events,
                child: Mutex::new(child),
                pending: Mutex::new(HashMap::new()),
                ready: (Mutex::new(false), Condvar::new()),
                closed: AtomicBool::new(false),
                fatal_notified: AtomicBool::new(false),
                active_requests: AtomicUsize::new(0),
                next_id: AtomicU64::new(1),
                event_handler,
                request_handler,
            }),
        };

        let writer_host = host.clone();
        std::thread::Builder::new()
            .name("superset-node-stdio-writer".into())
            .spawn(move || writer_host.write_stdin(stdin, writer_rx))
            .map_err(|error| format!("failed to create Node stdio writer: {error}"))?;
        let event_host = host.clone();
        std::thread::Builder::new()
            .name("superset-node-event-dispatch".into())
            .spawn(move || event_host.dispatch_events(events_rx))
            .map_err(|error| format!("failed to create Node event dispatcher: {error}"))?;

        let reader_host = host.clone();
        std::thread::Builder::new()
            .name("superset-node-stdio".into())
            .spawn(move || reader_host.read_stdout(stdout))
            .map_err(|error| format!("failed to create Node stdio reader: {error}"))?;

        host.send_event("bootstrap", bootstrap, None)?;
        Ok(host)
    }

    pub fn request(
        &self,
        method: &str,
        params: Value,
        window_label: Option<String>,
    ) -> Result<Value, String> {
        self.request_with_timeout(method, params, window_label, DEFAULT_REQUEST_TIMEOUT)
    }

    pub fn request_without_timeout(
        &self,
        method: &str,
        params: Value,
        window_label: Option<String>,
    ) -> Result<Value, String> {
        self.wait_ready(DEFAULT_REQUEST_TIMEOUT)?;
        let id = self.next_id();
        let (sender, receiver) = mpsc::sync_channel(1);
        {
            let mut pending = self
                .inner
                .pending
                .lock()
                .map_err(|_| "Node request state was poisoned".to_string())?;
            if self.inner.closed.load(Ordering::Acquire) {
                return Err("Node transport is closed".into());
            }
            pending.insert(id.clone(), sender);
        }
        let mut message = json!({
            "type": "request",
            "id": id,
            "method": method,
            "params": params,
        });
        if let Some(label) = window_label {
            message["windowLabel"] = Value::String(label);
        }
        if let Err(error) = self.write_message(&message) {
            if let Ok(mut pending) = self.inner.pending.lock() {
                pending.remove(
                    message
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
            }
            return Err(error);
        }
        receiver
            .recv()
            .map_err(|_| "Node transport closed".to_string())?
    }

    pub fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        window_label: Option<String>,
        timeout: Duration,
    ) -> Result<Value, String> {
        self.wait_ready(timeout)?;
        let id = self.next_id();
        let (sender, receiver) = mpsc::sync_channel(1);
        {
            let mut pending = self
                .inner
                .pending
                .lock()
                .map_err(|_| "Node request state was poisoned".to_string())?;
            if self.inner.closed.load(Ordering::Acquire) {
                return Err("Node transport is closed".into());
            }
            pending.insert(id.clone(), sender);
        }

        let mut message = json!({
            "type": "request",
            "id": id,
            "method": method,
            "params": params,
        });
        if let Some(label) = window_label {
            message["windowLabel"] = Value::String(label);
        }
        if let Err(error) = self.write_message(&message) {
            if let Ok(mut pending) = self.inner.pending.lock() {
                pending.remove(
                    message
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
            }
            return Err(error);
        }

        match receiver.recv_timeout(timeout) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(mut pending) = self.inner.pending.lock() {
                    pending.remove(
                        message
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                    );
                }
                Err(format!("Node request timed out: {method}"))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err("Node transport closed".into()),
        }
    }

    pub fn send_event(
        &self,
        name: &str,
        payload: Value,
        window_label: Option<String>,
    ) -> Result<(), String> {
        let mut message = json!({
            "type": "event",
            "name": name,
            "payload": payload,
        });
        if let Some(label) = window_label {
            message["windowLabel"] = Value::String(label);
        }
        self.write_message(&message)
    }

    pub fn shutdown(&self, reason: &str, preserve_pty_sessions: bool) {
        if !self.inner.closed.load(Ordering::Acquire) {
            let _ = self.request_with_timeout(
                "shutdown",
                json!({
                    "reason": reason,
                    "preservePtySessions": preserve_pty_sessions,
                }),
                None,
                SHUTDOWN_TIMEOUT,
            );
        }
        self.close_transport("Node transport stopped");
    }

    pub fn is_ready(&self) -> bool {
        self.inner
            .ready
            .0
            .lock()
            .map(|ready| *ready)
            .unwrap_or(false)
    }

    fn next_id(&self) -> String {
        let counter = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        format!("rust-{}-{counter}", std::process::id())
    }

    fn wait_ready(&self, timeout: Duration) -> Result<(), String> {
        let (lock, condition) = &self.inner.ready;
        let mut ready = lock
            .lock()
            .map_err(|_| "Node readiness state was poisoned".to_string())?;
        if *ready {
            return Ok(());
        }
        let (new_ready, _) = condition
            .wait_timeout_while(ready, timeout, |is_ready| {
                !*is_ready && !self.inner.closed.load(Ordering::Acquire)
            })
            .map_err(|_| "Node readiness wait failed".to_string())?;
        ready = new_ready;
        if *ready {
            Ok(())
        } else if self.inner.closed.load(Ordering::Acquire) {
            Err("Node transport closed before ready".into())
        } else {
            Err("Node service did not become ready".into())
        }
    }

    fn write_message(&self, message: &Value) -> Result<(), String> {
        if self.inner.closed.load(Ordering::Acquire) {
            return Err("Node transport is closed".into());
        }
        self.inner
            .writer
            .try_send(message.clone())
            .map_err(|error| {
                self.close_transport("Node transport output queue is full");
                format!("Node transport output queue is full: {error}")
            })
    }

    fn write_stdin(&self, mut stdin: ChildStdin, receiver: mpsc::Receiver<Value>) {
        while !self.inner.closed.load(Ordering::Acquire) {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(message) => {
                    if let Err(error) = write_frame(&mut stdin, &message) {
                        self.close_transport(&format!("Node transport write failed: {error}"));
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    fn dispatch_events(&self, receiver: mpsc::Receiver<NativeEvent>) {
        while !self.inner.closed.load(Ordering::Acquire) {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(event) => (self.inner.event_handler)(event),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    fn read_stdout(&self, stdout: impl std::io::Read) {
        let mut reader = std::io::BufReader::new(stdout);
        loop {
            match read_frame(&mut reader) {
                Ok(Some(message)) => self.receive(message),
                Ok(None) => {
                    self.close_transport("Node service exited");
                    break;
                }
                Err(error) => {
                    self.close_transport(&format!("Invalid Node frame: {error}"));
                    break;
                }
            }
        }
    }

    fn receive(&self, message: Value) {
        let Some(kind) = message.get("type").and_then(Value::as_str) else {
            self.close_transport("Node frame is missing a message type");
            return;
        };
        match kind {
            "response" => {
                let Some(id) = message.get("id").and_then(Value::as_str) else {
                    self.close_transport("Node response is missing an id");
                    return;
                };
                let result = if let Some(error) = message.get("message").and_then(Value::as_str) {
                    Err(error.to_string())
                } else if let Some(value) = message.get("value") {
                    Ok(value.clone())
                } else {
                    self.close_transport("Node response is missing value");
                    return;
                };
                if let Ok(mut pending) = self.inner.pending.lock() {
                    if let Some(sender) = pending.remove(id) {
                        let _ = sender.send(result);
                    }
                }
            }
            "error" => {
                let Some(id) = message.get("id").and_then(Value::as_str) else {
                    self.close_transport("Node error is missing an id");
                    return;
                };
                let error = message
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Node request failed")
                    .to_string();
                if let Ok(mut pending) = self.inner.pending.lock() {
                    if let Some(sender) = pending.remove(id) {
                        let _ = sender.send(Err(error));
                    }
                }
            }
            "event" => {
                let Some(name) = message.get("name").and_then(Value::as_str) else {
                    self.close_transport("Node event is missing a name");
                    return;
                };
                let Some(payload) = message.get("payload") else {
                    self.close_transport("Node event is missing payload");
                    return;
                };
                let event = NativeEvent {
                    name: name.to_string(),
                    payload: payload.clone(),
                    window_label: message
                        .get("windowLabel")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                };
                if event.name == "ready" {
                    if let Ok(mut ready) = self.inner.ready.0.lock() {
                        *ready = true;
                        self.inner.ready.1.notify_all();
                    }
                }
                if self.inner.events.try_send(event).is_err() {
                    self.close_transport("Node event queue is full");
                }
            }
            "request" => {
                let Some(id) = message.get("id").and_then(Value::as_str) else {
                    self.close_transport("Node request is missing an id");
                    return;
                };
                let Some(method) = message.get("method").and_then(Value::as_str) else {
                    self.close_transport("Node request is missing a method");
                    return;
                };
                let Some(params) = message.get("params") else {
                    self.close_transport("Node request is missing params");
                    return;
                };
                if self.inner.active_requests.fetch_add(1, Ordering::AcqRel) >= 64 {
                    self.inner.active_requests.fetch_sub(1, Ordering::AcqRel);
                    let response =
                        json!({"type":"error", "id":id, "message":"Node request queue is full"});
                    let _ = self.write_message(&response);
                    return;
                }
                let request = NativeRequest {
                    id: id.to_string(),
                    method: method.to_string(),
                    params: params.clone(),
                    window_label: message
                        .get("windowLabel")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                };
                let host = self.clone();
                std::thread::spawn(move || {
                    let result = (host.inner.request_handler)(request.clone());
                    let response = match result {
                        Ok(value) => json!({"type":"response", "id":request.id, "value":value}),
                        Err(message) => json!({"type":"error", "id":request.id, "message":message}),
                    };
                    let _ = host.write_message(&response);
                    host.inner.active_requests.fetch_sub(1, Ordering::AcqRel);
                });
            }
            _ => self.close_transport("Unknown Node frame type"),
        }
    }

    fn close_transport(&self, reason: &str) {
        if self.inner.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Ok(mut ready) = self.inner.ready.0.lock() {
            *ready = false;
            self.inner.ready.1.notify_all();
        }
        let error = reason.to_string();
        if let Ok(mut pending) = self.inner.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(error.clone()));
            }
        }
        if let Ok(mut child) = self.inner.child.lock() {
            let _ = child.kill();
        }
        if self.inner.fatal_notified.swap(true, Ordering::AcqRel) == false {
            (self.inner.event_handler)(NativeEvent {
                name: "native:disconnected".into(),
                payload: json!({"reason":"Node service disconnected"}),
                window_label: None,
            });
        }
    }
}

impl Drop for NodeHostInner {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
