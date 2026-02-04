// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_app_lib::models::{LogEntryPayload, LogLevel, LogStatus, SharedServerConfig, SharedShadowStore};
use tokio::sync::oneshot;

// Store the shutdown sender so the HTTP server stays alive
static MCP_SHUTDOWN: OnceLock<Mutex<Option<oneshot::Sender<()>>>> = OnceLock::new();
use tauri_app_lib::services::{http_server, logger, shadow_store};

// Track whether app has fully initialized (setup complete, main window ready)
static APP_READY: OnceLock<AtomicBool> = OnceLock::new();

fn is_app_ready() -> bool {
    APP_READY
        .get()
        .map(|b| b.load(Ordering::SeqCst))
        .unwrap_or(false)
}

fn set_app_ready() {
    APP_READY
        .get_or_init(|| AtomicBool::new(false))
        .store(true, Ordering::SeqCst);
}

// Hold paths from RunEvent::Opened that arrive before setup() completes
// setup() will transfer these to LaunchState
static PENDING_OPEN_PATHS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

fn pending_paths() -> &'static Mutex<Vec<String>> {
    PENDING_OPEN_PATHS.get_or_init(|| Mutex::new(Vec::new()))
}

fn add_pending_paths(paths: Vec<String>) {
    if let Ok(mut pending) = pending_paths().lock() {
        pending.extend(paths);
    }
}

fn take_pending_paths() -> Vec<String> {
    if let Ok(mut pending) = pending_paths().lock() {
        std::mem::take(&mut *pending)
    } else {
        Vec::new()
    }
}

#[derive(Clone, Copy)]
struct MoveState {
    last_seen: std::time::Instant,
    x: i32,
    y: i32,
}

fn move_cache() -> &'static Mutex<HashMap<String, MoveState>> {
    static CACHE: OnceLock<Mutex<HashMap<String, MoveState>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Heuristic: treat a lone default "main" window as empty (no document yet).
/// This allows Finder/CLI opens at startup to load into the existing window
/// instead of creating a second blank window.
fn has_windows_with_documents(app: &tauri::AppHandle) -> bool {
    let windows: Vec<_> = app.webview_windows().into_iter().collect();
    if windows.is_empty() {
        return false;
    }
    if windows.len() == 1 {
        if let Some((label, _)) = windows.first() {
            return label != "main";
        }
    }
    true
}

/// Open file in a new window
fn open_file_in_new_window(app: &tauri::AppHandle, path: String) {
    let window_id = format!("mdpro-{}", uuid::Uuid::new_v4());
    // Encode the path as URL parameter so the React app can read it on load
    // This avoids the race condition where emit() fires before React is ready
    let encoded_path = urlencoding::encode(&path);
    let url = WebviewUrl::App(format!("/?open={}", encoded_path).into());

    match WebviewWindowBuilder::new(app, &window_id, url)
        .title("Untitled - mdpro")
        .inner_size(1200.0, 800.0)
        .min_inner_size(600.0, 400.0)
        .build()
    {
        Ok(window) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "window.open".to_string(),
                status: LogStatus::Success,
                action_id: None,
                context: Some(json!({
                    "windowId": window_id,
                    "windowLabel": window.label(),
                    "filePath": path
                })),
                duration_ms: None,
                error: None,
            });
        }
        Err(e) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Error,
                event: "window.open".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: Some(json!({
                    "windowId": window_id,
                    "filePath": path
                })),
                duration_ms: None,
                error: Some(e.to_string()),
            });
        }
    }
}

fn main() {
    let startup = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "app.launch".to_string(),
        status: LogStatus::Start,
        action_id: None,
        context: Some(json!({
            "appVersion": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS
        })),
        duration_ms: None,
        error: None,
    });

    let app = tauri::Builder::default()
        .setup(move |app| {
            let watcher =
                tauri_app_lib::services::file_watcher::FileWatcher::new(app.handle().clone());
            app.manage(watcher);
            app.manage(tauri_app_lib::menu::MenuState::default());

            // Initialize MCP Shadow Store
            let mcp_shadow_store: SharedShadowStore = shadow_store::create_shadow_store();
            app.manage(mcp_shadow_store.clone());

            // Initialize MCP Server Config
            let mcp_server_config: SharedServerConfig = Arc::new(Mutex::new(None));
            app.manage(mcp_server_config.clone());

            // Start HTTP server for MCP
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match http_server::start_server(mcp_shadow_store, mcp_server_config, app_handle).await {
                    Ok((port, shutdown_tx)) => {
                        // Store shutdown sender in static so server stays alive
                        // (dropping the sender triggers graceful shutdown)
                        if let Ok(mut guard) = MCP_SHUTDOWN
                            .get_or_init(|| Mutex::new(None))
                            .lock()
                        {
                            *guard = Some(shutdown_tx);
                        }
                        logger::log_event(LogEntryPayload {
                            level: LogLevel::Info,
                            event: "mcp.http_server.start".to_string(),
                            status: LogStatus::Success,
                            action_id: None,
                            context: Some(json!({ "port": port })),
                            duration_ms: None,
                            error: None,
                        });
                    }
                    Err(e) => {
                        logger::log_event(LogEntryPayload {
                            level: LogLevel::Error,
                            event: "mcp.http_server.start".to_string(),
                            status: LogStatus::Fail,
                            action_id: None,
                            context: None,
                            duration_ms: None,
                            error: Some(e),
                        });
                    }
                }
            });
            let menu = tauri_app_lib::menu::build_menu(&app.handle(), &[], None)?;
            app.set_menu(menu)?;
            let launch_state = tauri_app_lib::launch::LaunchState::default();
            let raw_args: Vec<String> = std::env::args().skip(1).collect();
            let args = tauri_app_lib::launch::filter_launch_paths(raw_args);
            if !args.is_empty() {
                let args_for_log = args.clone();
                logger::log_event(LogEntryPayload {
                    level: LogLevel::Info,
                    event: "file.open.cli".to_string(),
                    status: LogStatus::Success,
                    action_id: None,
                    context: Some(json!({ "filePaths": args_for_log, "source": "cli" })),
                    duration_ms: None,
                    error: None,
                });
            }
            // Check for paths from RunEvent::Opened that arrived before setup()
            let pending = take_pending_paths();
            let mut all_paths = args;
            if !pending.is_empty() {
                logger::log_event(LogEntryPayload {
                    level: LogLevel::Info,
                    event: "app.pending_paths_transfer".to_string(),
                    status: LogStatus::Success,
                    action_id: None,
                    context: Some(json!({
                        "pendingPaths": pending,
                        "cliPaths": all_paths
                    })),
                    duration_ms: None,
                    error: None,
                });
                all_paths.extend(pending);
            }
            launch_state.set_paths(all_paths);
            app.manage(launch_state);
            for (label, window) in app.webview_windows() {
                logger::log_event(LogEntryPayload {
                    level: LogLevel::Info,
                    event: "window.open".to_string(),
                    status: LogStatus::Success,
                    action_id: None,
                    context: Some(json!({
                        "windowId": label,
                        "windowLabel": window.label()
                    })),
                    duration_ms: None,
                    error: None,
                });
            }
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "app.ready".to_string(),
                status: LogStatus::Success,
                action_id: None,
                context: Some(json!({
                    "startupTimeMs": startup.elapsed().as_millis() as u64,
                    "appVersion": env!("CARGO_PKG_VERSION"),
                    "platform": std::env::consts::OS
                })),
                duration_ms: Some(startup.elapsed().as_millis() as u64),
                error: None,
            });
            // Mark app as ready - RunEvent::Opened will now create new windows
            set_app_ready();
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = tauri_app_lib::launch::filter_launch_paths(args);
            if !paths.is_empty() {
                let paths_for_log = paths.clone();
                logger::log_event(LogEntryPayload {
                    level: LogLevel::Info,
                    event: "app.single_instance".to_string(),
                    status: LogStatus::Success,
                    action_id: None,
                    context: Some(json!({ "filePaths": paths_for_log })),
                    duration_ms: None,
                    error: None,
                });
                let paths_for_log = paths.clone();
                logger::log_event(LogEntryPayload {
                    level: LogLevel::Info,
                    event: "file.open.external".to_string(),
                    status: LogStatus::Start,
                    action_id: None,
                    context: Some(json!({ "filePaths": paths_for_log, "source": "single_instance" })),
                    duration_ms: None,
                    error: None,
                });
            }
            if !paths.is_empty() {
                // If windows exist, open each file in a new window
                if has_windows_with_documents(app) {
                    for path in &paths {
                        open_file_in_new_window(app, path.clone());
                    }
                } else {
                    // No windows, emit to let the first window open the file
                    let _ = app.emit("file:open", paths.clone());
                }
                for path in &paths {
                    logger::log_event(LogEntryPayload {
                        level: LogLevel::Info,
                        event: "file.open.external".to_string(),
                        status: LogStatus::Success,
                        action_id: None,
                        context: Some(json!({ "filePath": path, "source": "single_instance" })),
                        duration_ms: None,
                        error: None,
                    });
                }
            }
        }))
        .on_menu_event(|app, event| {
            tauri_app_lib::menu::handle_menu_event(app, event);
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::ThemeChanged(theme) => {
                    tauri_app_lib::services::file_watcher::emit_theme_changed(
                        &window.app_handle(),
                        theme,
                    );
                }
                WindowEvent::Focused(is_focused) => {
                    let event_name = if *is_focused { "window.focus" } else { "window.blur" };
                    logger::log_event(LogEntryPayload {
                        level: LogLevel::Info,
                        event: event_name.to_string(),
                        status: LogStatus::Success,
                        action_id: None,
                        context: Some(json!({
                            "windowId": window.label(),
                            "windowLabel": window.label()
                        })),
                        duration_ms: None,
                        error: None,
                    });

                    // Update MCP Shadow Store focused window
                    if *is_focused {
                        if let Some(store) = window.try_state::<SharedShadowStore>() {
                            let _ = shadow_store::set_focused_window(&store, window.label());
                        }
                    }
                }
                WindowEvent::CloseRequested { .. } => {
                    logger::log_event(LogEntryPayload {
                        level: LogLevel::Info,
                        event: "window.close".to_string(),
                        status: LogStatus::Success,
                        action_id: None,
                        context: Some(json!({
                            "windowId": window.label(),
                            "windowLabel": window.label()
                        })),
                        duration_ms: None,
                        error: None,
                    });

                    // Remove window from MCP Shadow Store
                    if let Some(store) = window.try_state::<SharedShadowStore>() {
                        let _ = shadow_store::remove_window(&store, window.label());
                    }
                }
                WindowEvent::Moved(position) => {
                    let window_id = window.label().to_string();
                    let now = std::time::Instant::now();
                    if let Ok(mut cache) = move_cache().lock() {
                        cache.insert(
                            window_id.clone(),
                            MoveState {
                                last_seen: now,
                                x: position.x,
                                y: position.y,
                            },
                        );
                    }
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(250));
                        if let Ok(mut cache) = move_cache().lock() {
                            if let Some(state) = cache.get(&window_id) {
                                if state.last_seen == now {
                                    logger::log_event(LogEntryPayload {
                                        level: LogLevel::Debug,
                                        event: "window.move".to_string(),
                                        status: LogStatus::Success,
                                        action_id: None,
                                        context: Some(json!({
                                            "windowId": window_id,
                                            "windowLabel": window_id,
                                            "toPosition": { "x": state.x, "y": state.y }
                                        })),
                                        duration_ms: None,
                                        error: None,
                                    });
                                    cache.remove(&window_id);
                                }
                            }
                        }
                    });
                }
                _ => {}
            }
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri_app_lib::commands::handlers())
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(err) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Error,
                event: "app.error".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: Some(json!({ "stage": "build" })),
                duration_ms: Some(startup.elapsed().as_millis() as u64),
                error: Some(err.to_string()),
            });
            panic!("error while building tauri application");
        }
    };

    #[cfg(target_os = "macos")]
    app.run(|app_handle, event| {
        // Handle macOS "Open With" file associations
        if let RunEvent::Opened { ref urls } = event {
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
                let paths_for_log = paths.clone();
                let app_ready = is_app_ready();
                logger::log_event(LogEntryPayload {
                    level: LogLevel::Info,
                    event: "file.open.external".to_string(),
                    status: LogStatus::Start,
                    action_id: None,
                    context: Some(json!({
                        "filePaths": paths_for_log,
                        "source": "finder",
                        "appReady": app_ready
                    })),
                    duration_ms: None,
                    error: None,
                });

                if !app_ready {
                    // App still starting - store paths for main window to load
                    // LaunchState might not exist yet (setup() not complete), use pending_paths
                    add_pending_paths(paths.clone());
                    logger::log_event(LogEntryPayload {
                        level: LogLevel::Info,
                        event: "file.open.external.pending".to_string(),
                        status: LogStatus::Success,
                        action_id: None,
                        context: Some(json!({
                            "pendingPaths": paths,
                            "reason": "app_not_ready"
                        })),
                        duration_ms: None,
                        error: None,
                    });
                } else {
                    // App is ready - open in new windows (app already has documents)
                    for path in &paths {
                        open_file_in_new_window(app_handle, path.clone());
                    }
                }

                for path in &paths {
                    logger::log_event(LogEntryPayload {
                        level: LogLevel::Info,
                        event: "file.open.external".to_string(),
                        status: LogStatus::Success,
                        action_id: None,
                        context: Some(json!({ "filePath": path, "source": "finder" })),
                        duration_ms: None,
                        error: None,
                    });
                }
            }
        }

        if let RunEvent::ExitRequested { .. } = event {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "app.quit".to_string(),
                status: LogStatus::Success,
                action_id: None,
                context: Some(json!({})),
                duration_ms: None,
                error: None,
            });

            // Gracefully shutdown MCP HTTP server by dropping the sender
            if let Some(guard) = MCP_SHUTDOWN.get() {
                if let Ok(mut opt) = guard.lock() {
                    if let Some(tx) = opt.take() {
                        let _ = tx.send(());
                    }
                }
            }

            // Cleanup MCP server config files
            http_server::cleanup_server_config();
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});
}
