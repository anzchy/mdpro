// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::ThemeChanged(theme) = event {
                tauri_app_lib::services::file_watcher::emit_theme_changed(
                    &window.app_handle(),
                    theme,
                );
            }
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri_app_lib::commands::handlers())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
