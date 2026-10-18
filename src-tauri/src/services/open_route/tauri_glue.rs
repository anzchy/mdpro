//! Tauri shim for D29 routing: binds the tested planner and executor to the
//! runtime. Not unit-testable; covered by the G-D29-1..7 GUI checks and the
//! D279 device items, with source pins in `file_open_emit_pin_tests.rs`.
//!
//! Pipeline: live-label set -> `lookup_all` -> `plan_route` (+ the D74 quit
//! gate) -> the `MenuFocus` snapshot (read once, `UNMANAGED_FOCUS` when
//! unmanaged) -> `broadcast_target` -> `execute_plan`, which makes one
//! delivery of the broadcast group to that App-class target (D279).
//!
//! Key decisions:
//! - **No decision lives here.** The shim builds the live-label set, reads
//!   the focus snapshot and builds the four closures, and nothing else; every
//!   branch is in `plan_route`, `broadcast_target` and `execute_plan`.
//! - **Both sends return `Err` when the window is gone.** `emit_to_window`
//!   and the `file:open` closure look the window up with
//!   `get_webview_window` first, because `emit_to` a missing label is not an
//!   error: without the lookup a window closed between building the live set
//!   and the send would silently swallow the open. The `file:open` send goes
//!   to the label it looked up and to no other window (D279); its `Err` is
//!   what reaches `execute_plan`'s send-failure fallback.
//! - **The route log's level and status come from `route_log_severity`**:
//!   Info/Success, Warn/Fail with the text when the executor passes an emit
//!   error, Warn/Cancel for a path refused under a pending quit.
//! - **The D74 quit gate is read once per open**, through
//!   `quit_guard::window_gate::new_window_gate`, and handed to the plan
//!   (`with_quit_pending`); the coordinator lock is not held while any window
//!   is emitted to or built.
//! - `open_file_in_new_window` and `has_windows_with_documents` live here so
//!   the shim can call them. `open_file_in_new_window` restores the file's
//!   stored geometry (D24 follow-up) through
//!   `window_restore::restore_geometry_for` and `apply_resolved`; it holds no
//!   window size of its own. A read failure still opens the window at the
//!   default and logs `window.open` at Warn with `geometryReason: "read_failed"`.
//!
//! @coordinates-with src-tauri/src/main.rs, services/window_restore.rs
use super::plan::broadcast_target;
use super::{
    execute_plan, lookup_all, plan_route, route_log_severity, OpenInWindowPayload, RouteTarget,
    Source, OPEN_IN_WINDOW_EVENT,
};
use crate::menu::menu_target::UNMANAGED_FOCUS;
use crate::menu::MenuFocus;
use crate::models::{LogEntryPayload, LogLevel, LogStatus, SharedShadowStore};
use crate::services::logger;
use crate::services::quit_guard::{effects::AppQuitGuard, window_gate::new_window_gate};
use crate::services::window_restore;
use serde_json::json;
use std::collections::HashSet;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Route each external-open path to the window that holds it, or keep
/// today's behaviour for it. Logs one `file.open.route` per path.
pub fn route_external_open(app: &AppHandle, paths: Vec<String>, source: Source) {
    let live: HashSet<String> = app.webview_windows().into_keys().collect();
    let store = app.try_state::<SharedShadowStore>();
    let lookups = lookup_all(store.as_deref(), &paths, &live);
    // D74: read once, with the coordinator lock released before any window is
    // touched; the plan carries the answer from here on.
    let quit_pending = new_window_gate(app.try_state::<AppQuitGuard>().as_deref()).is_err();
    let plan = plan_route(source, &lookups, has_windows_with_documents(app))
        .with_quit_pending(quit_pending);
    // D279: the broadcast group goes to the one App-class target (D261).
    let focus = app.try_state::<MenuFocus>();
    let snapshot = focus.as_deref().unwrap_or(&UNMANAGED_FOCUS).snapshot();
    let target = broadcast_target(&snapshot, &live);
    execute_plan(
        &plan,
        source,
        &target,
        |target: &RouteTarget| emit_to_window(app, target),
        |path: String| open_file_in_new_window(app, path),
        |label: &str, group: Vec<String>| {
            // `emit_to` a missing label is not an error, so look it up first.
            app.get_webview_window(label)
                .ok_or_else(|| format!("window {label} is gone"))?;
            app.emit_to(label, "file:open", group)
                .map_err(|e| e.to_string())
        },
        |context, error: Option<String>| {
            let (level, status) = route_log_severity(&context, error.as_deref());
            logger::log_event(LogEntryPayload {
                level,
                event: "file.open.route".to_string(),
                status,
                action_id: None,
                context: Some(context),
                duration_ms: None,
                error,
            })
        },
    );
}

/// Unminimize, show and focus the window, then emit to it alone. `Err` when
/// the window no longer exists or the emit fails.
fn emit_to_window(app: &AppHandle, target: &RouteTarget) -> Result<(), String> {
    let window = app
        .get_webview_window(&target.window_label)
        .ok_or_else(|| format!("window {} is gone", target.window_label))?;
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    app.emit_to(
        target.window_label.as_str(),
        OPEN_IN_WINDOW_EVENT,
        OpenInWindowPayload {
            window_label: target.window_label.clone(),
            document_id: target.document_id.clone(),
            path: target.path.clone(),
        },
    )
    .map_err(|e| e.to_string())
}

/// Heuristic: treat a lone default "main" window as empty (no document yet).
/// This allows Finder/CLI opens at startup to load into the existing window
/// instead of creating a second blank window.
pub fn has_windows_with_documents(app: &AppHandle) -> bool {
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

/// Open `path` in a new window at the file's stored geometry, or at the
/// fitted default when there is none (or it cannot be read).
pub fn open_file_in_new_window(app: &AppHandle, path: String) {
    let window_id = format!("mdpro-{}", uuid::Uuid::new_v4());
    // Encode the path as URL parameter so the React app can read it on load
    // This avoids the race condition where emit() fires before React is ready
    let encoded_path = urlencoding::encode(&path);
    let url = WebviewUrl::App(format!("/?open={}", encoded_path).into());
    let (resolved, outcome) =
        window_restore::restore_geometry_for(Some(&path), window_restore::primary_work_area(app));
    let builder = WebviewWindowBuilder::new(app, &window_id, url).title("Untitled - mdpro");

    match window_restore::apply_resolved(builder, &resolved).build() {
        Ok(window) => {
            logger::log_event(LogEntryPayload {
                level: window_restore::restore_log_level(&outcome),
                event: "window.open".to_string(),
                status: LogStatus::Success,
                action_id: None,
                context: Some(window_restore::window_open_context(
                    &window_id,
                    window.label(),
                    &path,
                    &outcome,
                )),
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
