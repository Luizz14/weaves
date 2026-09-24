#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri_runtime_cef::cef_entry_point]
fn main() {
    if let Err(error) = superset_desktop_native::run() {
        eprintln!("[native] Superset could not start: {error}");
        std::process::exit(1);
    }
}
