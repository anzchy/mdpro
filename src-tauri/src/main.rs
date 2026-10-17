// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::RunEvent;
use tauri::{Manager, WindowEvent};
use tauri_app_lib::launch_args::{self, LaunchSource};
use tauri_app_lib::models::{
    LogEntryPayload, LogLevel, LogStatus, SharedServerConfig, SharedShadowStore,
};
use tauri_app_lib::services::app_exit;
use tauri_app_lib::services::applied_shortcuts::{self, AppliedShortcutsState};
use tauri_app_lib::services::file_watcher::{self, FileWatcher};
use tauri_app_lib::services::mcp_confirm::{
    self,
    effects::{AppConfirmBroker, TauriConfirmEffects},
};
use tauri_app_lib::services::mcp_controller::controller::McpController;
use tauri_app_lib::services::mcp_controller::launch::launch as mcp_launch_through;
use tauri_app_lib::services::mcp_launch;
use tauri_app_lib::services::open_route::{route_external_open, Source};
use tauri_app_lib::services::quit_guard::{
    self,
    effects::{AppQuitGuard, TauriQuitEffects},
};
use tauri_app_lib::services::{app_ready, http_server, logger, shadow_store, window_focus};
const BUILD_ID_RAW: Option<&str> = option_env!("MDPRO_BUILD_ID");
// D175: `<version>@<sha>`, set only by release.yml's app build step; read
// here, not in the lib, so a new id recompiles only this bin (release_info.rs).
const RELEASE_ID_RAW: Option<&str> = option_env!("MDPRO_RELEASE_ID");

// Track whether app has fully initialized (setup complete, main window ready)
static APP_READY: OnceLock<AtomicBool> = OnceLock::new();

#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
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

fn main() {
    #[cfg(feature = "verify-run")]
    let verified_run = tauri_app_lib::services::verify_run::enforce();
    // ADR-0047 WI-009: built here because `verified_run` moves into setup.
    #[cfg(feature = "control-channel")]
    let control_plugin = tauri_app_lib::services::control_channel::plugin(&verified_run);
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

    // One-time legacy-draft migration (best-effort, logged; never blocks startup).
    tauri_app_lib::services::draft::migrate_legacy_drafts_logged();

    let app = tauri::Builder::default()
        .setup(move |app| {
            // ADR-0047 WI-002: publish instance.json here, not in main().
            // Plugin setup (single-instance: exit 0 or claim the socket) runs
            // in build() before this closure (tauri 2.9.5 app.rs:2291 vs
            // 1299-1302; tauri-plugin-single-instance 2.3.7), but the plugin
            // falls through and launches on other notify errors, so publication
            // must itself be exclusive. A setup Err panics, hence
            // publish_or_exit prints its own line and exits 78.
            #[cfg(feature = "verify-run")]
            tauri_app_lib::services::verify_run::publish_or_exit(&verified_run, BUILD_ID_RAW);
            // M1a WI-4 (ADR-0114): the run's applied shortcuts, resolved once
            // and managed first, before `build_menu` and before any window
            // can invoke `get_applied_shortcuts`. Fixed for the run.
            app.manage(AppliedShortcutsState::new(
                applied_shortcuts::snapshot_at_startup(),
            ));
            let watcher = FileWatcher::new(app.handle().clone())
                .map_err(Box::<dyn std::error::Error>::from)?;
            app.manage(watcher);
            app.manage(tauri_app_lib::menu::MenuState::default());
            app.manage(tauri_app_lib::menu::MenuFocus::default());

            // The quit guard. Managed state, so the ack timer and the reply
            // command both reach the one guard without an Arc cycle.
            app.manage(AppQuitGuard::new(TauriQuitEffects::new(
                app.handle().clone(),
            )));

            // Initialize MCP Shadow Store
            let mcp_shadow_store: SharedShadowStore = shadow_store::create_shadow_store();
            app.manage(mcp_shadow_store.clone());

            // The MCP write-confirmation broker (ADR-0042): one per app,
            // managed for `mcp_confirm_reply` and the window-event hook,
            // shared with the HTTP router, and cancelled by the controller on
            // server stop / app exit through its stop hook.
            let confirm = Arc::new(AppConfirmBroker::new(TauriConfirmEffects::new(
                app.handle().clone(),
            )));
            app.manage(confirm.clone());

            // MCP server (ADR-0039 gate, ADR-0040 controller): read
            // `mcp.serverEnabled` once, read-only, decide fail-open, and apply
            // the decision through the controller, which owns the server from
            // here on (launch, later toggles, exit).
            match http_server::app_controller_env() {
                Some(env) => {
                    let env = env.with_stop_hook(mcp_confirm::stop_hook(confirm.clone()));
                    let controller = Arc::new(McpController::new(env));
                    app.manage(controller.shared_config());
                    app.manage(controller.clone());
                    let decision = mcp_launch::decide_mcp_launch(mcp_launch::read_server_enabled());
                    let router = http_server::router_factory(
                        mcp_shadow_store,
                        confirm,
                        app.handle().clone(),
                    );
                    // Detached: the controller's snapshot is the record.
                    drop(mcp_launch_through(controller, decision, router));
                }
                None => {
                    let empty: SharedServerConfig = Arc::new(Mutex::new(None));
                    app.manage(empty);
                    logger::log_event(LogEntryPayload {
                        level: LogLevel::Error,
                        event: "mcp.http_server.start".to_string(),
                        status: LogStatus::Fail,
                        action_id: None,
                        context: Some(json!({ "outcome": "no_data_dir" })),
                        duration_ms: None,
                        error: None,
                    });
                }
            }
            let menu = tauri_app_lib::menu::build_menu(app.handle(), &[], None)?;
            app.set_menu(menu)?;
            let launch_state = tauri_app_lib::launch::LaunchState::default();
            let raw_args: Vec<String> = std::env::args().skip(1).collect();
            let filter = launch_args::filter_launch_args(raw_args, None);
            let entry = launch_args::args_filtered_log_entry(LaunchSource::Cli, &filter);
            logger::log_event(entry);
            let args = filter.paths;
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
            // The native terminate hook (ADR-0025). It goes in after the
            // windows are logged, so the install line sits next to them, and
            // before the app is marked ready, so no quit can reach an
            // unguarded delegate.
            quit_guard::install(app.handle());
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "app.ready".to_string(),
                status: LogStatus::Success,
                action_id: None,
                context: Some(app_ready::current_app_ready_context(
                    startup.elapsed().as_millis() as u64,
                    BUILD_ID_RAW,
                    RELEASE_ID_RAW,
                )),
                duration_ms: Some(startup.elapsed().as_millis() as u64),
                error: None,
            });
            // Mark app as ready - RunEvent::Opened will now create new windows
            set_app_ready();
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // Relative args resolve against the *second* process's cwd (D33)
            let filter = launch_args::single_instance_args(args, &cwd);
            let entry = launch_args::args_filtered_log_entry(LaunchSource::SingleInstance, &filter);
            logger::log_event(entry);
            let paths = filter.paths;
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
                    context: Some(
                        json!({ "filePaths": paths_for_log, "source": "single_instance" }),
                    ),
                    duration_ms: None,
                    error: None,
                });
            }
            if !paths.is_empty() {
                // Each path goes to the window that has it, else today's fallback
                route_external_open(app, paths.clone(), Source::SingleInstance);
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
            // The quit guard sees every window event and routes only
            // `Destroyed`; a window the user keeps open must not count as an
            // answer (ADR-0025 §2).
            if let Some(guard) = window.try_state::<AppQuitGuard>() {
                quit_guard::on_window_event(&*guard, window.label(), event);
            }
            // A closed window's pending MCP write confirmations end as 503
            // (ADR-0042); the hook acts on `Destroyed` only, never on a
            // vetoable close request.
            if let Some(confirm) = window.try_state::<Arc<AppConfirmBroker>>() {
                mcp_confirm::on_window_event(&confirm, window.label(), event);
            }
            match event {
                WindowEvent::ThemeChanged(theme) => {
                    file_watcher::emit_theme_changed(window.app_handle(), theme);
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
                WindowEvent::Destroyed => {
                    // D173: the window's watch holds go with it (never on
                    // the vetoable CloseRequested), and its label is fenced
                    // so a late open, Save As or recover cannot hold again.
                    if let Some(watcher) = window.try_state::<FileWatcher>() {
                        watcher.release_window(window.label());
                    }
                    tauri_app_lib::menu::forget_window(window, window.label());
                }
                _ => {}
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    // ADR-0047 WI-009 item 11: the control channel registers after every
    // other plugin; single-instance stays first.
    #[cfg(feature = "control-channel")]
    let app = app.plugin(control_plugin);
    let app = app
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

    // One run loop for every target (D190-WI-4): the Exit cleanup below must
    // run on Windows and Linux too. Only `RunEvent::Opened` is macOS-only.
    app.run(|app_handle, event| {
        // Handle macOS "Open With" file associations
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { ref urls } = event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| {
                    if url.scheme() == "file" {
                        url.to_file_path().ok().and_then(|p| {
                            let path_str = p.to_string_lossy().to_string();
                            let ext = p.extension()?.to_str()?;
                            if ext.eq_ignore_ascii_case("md")
                                || ext.eq_ignore_ascii_case("markdown")
                            {
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
                    // App is ready - route to the window that has it, else a new window
                    route_external_open(app_handle, paths.clone(), Source::Finder);
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

        // D217: focus is recorded here, not in `on_window_event`. That
        // listener is registered on a new window after it is built and made
        // key, so a runtime-created window's first focus could arrive before
        // it and be lost; this callback sees every known window's events.
        if let RunEvent::WindowEvent {
            ref label,
            event: WindowEvent::Focused(focused),
            ..
        } = event
        {
            let store = app_handle.try_state::<SharedShadowStore>();
            let menu_focus = app_handle.try_state::<tauri_app_lib::menu::MenuFocus>();
            window_focus::on_focus_event(store.as_deref(), menu_focus.as_deref(), label, focused);
        }

        // Exit is the only cleanup site. The request-stage event that precedes
        // it can be vetoed, so cleaning up there ran on quits that never
        // happened and still left stale server.port / server.token behind on
        // the ones that did. See services::app_exit.
        if let RunEvent::Exit = event {
            if let Some(controller) = app_handle.try_state::<Arc<McpController>>() {
                app_exit::run_exit_cleanup(&controller);
            }
        }
    });
}
