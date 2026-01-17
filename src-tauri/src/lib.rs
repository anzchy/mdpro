pub mod models;

// Placeholder command until IPC modules are implemented.
#[tauri::command]
pub fn health_check() -> String {
    "ok".to_string()
}
