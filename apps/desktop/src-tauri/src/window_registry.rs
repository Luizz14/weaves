use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::WebviewWindow;
use url::Url;

const DEFAULT_WIDTH: u32 = 1280;
const DEFAULT_HEIGHT: u32 = 800;
const MIN_WIDTH: u32 = 400;
const MIN_HEIGHT: u32 = 400;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub is_maximized: bool,
    #[serde(default)]
    pub zoom_level: Option<f64>,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            x: 0,
            y: 0,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            is_maximized: false,
            zoom_level: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWindow {
    pub key: String,
    pub org_id: Option<String>,
    pub state: WindowState,
}

#[derive(Debug, Clone)]
pub struct WindowRecord {
    pub label: String,
    pub key: String,
    pub org_id: Option<String>,
    pub generation: u64,
    pub trusted: bool,
    pub current_url: Option<Url>,
}

#[derive(Clone)]
pub struct WindowRegistry {
    inner: Arc<Mutex<HashMap<String, WindowRecord>>>,
    zoom_levels: Arc<Mutex<HashMap<String, f64>>>,
    expected_dev_port: Option<u16>,
}

impl WindowRegistry {
    pub fn new(_data_dir: PathBuf, expected_dev_port: Option<u16>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            zoom_levels: Arc::new(Mutex::new(HashMap::new())),
            expected_dev_port,
        }
    }

    pub fn register(
        &self,
        window: &WebviewWindow,
        key: String,
        org_id: Option<String>,
    ) -> Result<(), String> {
        self.register_label(window.label(), key, org_id)
    }

    fn register_label(
        &self,
        label: &str,
        key: String,
        org_id: Option<String>,
    ) -> Result<(), String> {
        let label = label.to_string();
        let mut records = self
            .inner
            .lock()
            .map_err(|_| "Window registry was poisoned".to_string())?;
        let generation = records
            .get(&label)
            .map_or(1, |record| record.generation.saturating_add(1));
        records.insert(
            label.clone(),
            WindowRecord {
                label: label.clone(),
                key,
                org_id,
                generation,
                trusted: false,
                current_url: None,
            },
        );
        if let Ok(mut zoom_levels) = self.zoom_levels.lock() {
            zoom_levels.entry(label).or_insert(0.0);
        }
        Ok(())
    }

    pub fn unregister(&self, label: &str) {
        if let Ok(mut records) = self.inner.lock() {
            records.remove(label);
        }
        if let Ok(mut zoom_levels) = self.zoom_levels.lock() {
            zoom_levels.remove(label);
        }
    }

    pub fn mark_page(&self, label: &str, url: &Url) -> bool {
        let Ok(mut records) = self.inner.lock() else {
            return false;
        };
        let Some(record) = records.get_mut(label) else {
            return false;
        };
        let trusted = self.is_app_url(url);
        let was_trusted = record.trusted;
        record.current_url = Some(url.clone());
        record.trusted = trusted;
        trusted && was_trusted
    }

    pub fn mark_untrusted(&self, label: &str) {
        if let Ok(mut records) = self.inner.lock() {
            if let Some(record) = records.get_mut(label) {
                record.trusted = false;
            }
        }
    }

    pub fn is_registered(&self, label: &str) -> bool {
        self.inner
            .lock()
            .map(|records| records.contains_key(label))
            .unwrap_or(false)
    }

    pub fn is_trusted_label(&self, label: &str) -> bool {
        self.record(label).is_some_and(|record| {
            record.trusted
                && record
                    .current_url
                    .as_ref()
                    .is_some_and(|url| self.is_app_url(url))
        })
    }

    pub fn generation(&self, label: &str) -> Option<u64> {
        self.inner
            .lock()
            .ok()
            .and_then(|records| records.get(label).map(|record| record.generation))
    }

    pub fn record(&self, label: &str) -> Option<WindowRecord> {
        self.inner
            .lock()
            .ok()
            .and_then(|records| records.get(label).cloned())
    }

    pub fn set_zoom_level(&self, label: &str, level: f64) {
        if let Ok(mut zoom_levels) = self.zoom_levels.lock() {
            zoom_levels.insert(label.to_string(), level);
        }
    }

    pub fn zoom_level(&self, label: &str) -> Option<f64> {
        self.zoom_levels
            .lock()
            .ok()
            .and_then(|zoom_levels| zoom_levels.get(label).copied())
    }

    pub fn is_trusted_window(&self, window: &WebviewWindow) -> bool {
        self.is_trusted_label(window.label())
    }

    pub fn is_app_url(&self, url: &Url) -> bool {
        if url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none() {
            return true;
        }
        if matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none()
        {
            return true;
        }
        if matches!(url.scheme(), "http" | "https")
            && matches!(url.host_str(), Some("127.0.0.1" | "[::1]"))
        {
            return self
                .expected_dev_port
                .is_some_and(|port| url.port() == Some(port));
        }
        false
    }

    pub fn capture_state(&self, window: &WebviewWindow) -> Option<WindowState> {
        let position = window.outer_position().ok()?;
        let size = window.inner_size().ok()?;
        let scale_factor = window.scale_factor().ok().unwrap_or(1.0).max(0.1);
        let is_maximized = window.is_maximized().ok().unwrap_or(false);
        let zoom_level = self.zoom_level(window.label());
        Some(WindowState {
            x: ((position.x as f64) / scale_factor).round() as i32,
            y: ((position.y as f64) / scale_factor).round() as i32,
            width: ((size.width as f64) / scale_factor)
                .round()
                .max(MIN_WIDTH as f64) as u32,
            height: ((size.height as f64) / scale_factor)
                .round()
                .max(MIN_HEIGHT as f64) as u32,
            is_maximized,
            zoom_level,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::WindowRegistry;
    use std::path::PathBuf;
    use url::Url;

    #[test]
    fn cached_trust_fails_closed_until_a_committed_app_page() {
        let registry = WindowRegistry::new(PathBuf::new(), Some(3145));
        registry
            .register_label("main", "window-key".into(), None)
            .unwrap();

        assert!(!registry.is_trusted_label("main"));

        registry.mark_page("main", &Url::parse("http://127.0.0.1:3145/").unwrap());
        assert!(registry.is_trusted_label("main"));
    }

    #[test]
    fn denied_navigation_does_not_poison_the_current_app_document() {
        let registry = WindowRegistry::new(PathBuf::new(), Some(3145));
        registry
            .register_label("main", "window-key".into(), None)
            .unwrap();
        let app_url = Url::parse("http://127.0.0.1:3145/").unwrap();
        registry.mark_page("main", &app_url);
        assert!(registry.is_trusted_label("main"));

        // The shell's navigation guard rejects this URL without calling mark_page,
        // so the already-committed app document keeps its native bridge.
        assert!(registry.is_trusted_label("main"));
    }

    #[test]
    fn committed_remote_navigation_revokes_then_app_return_restores_trust() {
        let registry = WindowRegistry::new(PathBuf::new(), Some(3145));
        registry
            .register_label("main", "window-key".into(), None)
            .unwrap();
        let app_url = Url::parse("http://127.0.0.1:3145/").unwrap();
        registry.mark_page("main", &app_url);
        assert!(registry.is_trusted_label("main"));

        registry.mark_page("main", &Url::parse("https://example.com/").unwrap());
        assert!(!registry.is_trusted_label("main"));

        registry.mark_page("main", &app_url);
        assert!(registry.is_trusted_label("main"));
    }
}
