// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager, RunEvent};

fn main() {
    let app = tauri::Builder::default()
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // Handle macOS "Open With" file associations
        if let RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| {
                    if url.scheme() == "file" {
                        url.to_file_path().ok().and_then(|p| {
                            let path_str = p.to_string_lossy().to_string();
                            let ext = p.extension()?.to_str()?;
                            if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") {
                                Some(path_str)
                            } else {
                                None
                            }
                        })
                    } else {
                        None
                    }
                })
                .collect();

            if !paths.is_empty() {
                // Store in launch state if app just started, otherwise emit event
                if let Some(state) = app_handle.try_state::<tauri_app_lib::launch::LaunchState>() {
                    let existing = state.take_paths();
                    if existing.is_empty() {
                        // App just started, store for initial load
                        state.set_paths(paths);
                    } else {
                        // Restore existing and emit new paths
                        state.set_paths(existing);
                        let _ = app_handle.emit("file:open", paths);
                    }
                } else {
                    let _ = app_handle.emit("file:open", paths);
                }
            }
        }
    });
}
