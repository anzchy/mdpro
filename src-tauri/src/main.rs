// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let watcher =
                tauri_app_lib::services::file_watcher::FileWatcher::new(app.handle().clone());
            app.manage(watcher);
            app.manage(tauri_app_lib::menu::MenuState::default());
            let menu = tauri_app_lib::menu::build_menu(&app.handle(), &[])?;
            app.set_menu(menu)?;
            let launch_state = tauri_app_lib::launch::LaunchState::default();
            let args = tauri_app_lib::launch::filter_launch_paths(std::env::args().skip(1));
            launch_state.set_paths(args);
            app.manage(launch_state);
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = tauri_app_lib::launch::filter_launch_paths(args);
            if !paths.is_empty() {
                let _ = app.emit("file:open", paths);
            }
        }))
        .on_menu_event(|app, event| {
            tauri_app_lib::menu::handle_menu_event(app, event);
        })
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
