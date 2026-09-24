//! Tauri shim for D29 routing: binds the tested planner and executor to the
//! runtime. Not unit-testable; covered by the G-D29-1..7 GUI checks.
//!
//! Key decisions:
//! - **No decision lives here.** The shim builds the live-label set and the
//!   four closures, and nothing else; every branch is in `plan_route` and
//!   `execute_plan`.
//! - **`emit` returns `Err` when the window is gone.** It looks the window up
//!   with `get_webview_window` first, because `emit_to` a missing label is
//!   not an error: without the lookup a window closed between building the
//!   live set and the emit would silently swallow the open.
//! - **The route log is Info/Success**, except when the executor passes an
//!   emit error (the new-window fallback): then it is Warn/Fail with the text.
//! - `open_file_in_new_window` and `has_windows_with_documents` moved here
//!   from `main.rs` unchanged, so the shim can call them.
//!
//! @coordinates-with src-tauri/src/main.rs
use super::{
    execute_plan, lookup_all, plan_route, OpenInWindowPayload, RouteTarget, Source,
    OPEN_IN_WINDOW_EVENT,
};
use crate::models::{LogEntryPayload, LogLevel, LogStatus, SharedShadowStore};
use crate::services::logger;
use serde_json::json;
use std::collections::HashSet;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Route each external-open path to the window that holds it, or keep
/// today's behaviour for it. Logs one `file.open.route` per path.
pub fn route_external_open(app: &AppHandle, paths: Vec<String>, source: Source) {
    let live: HashSet<String> = app.webview_windows().into_keys().collect();
    let store = app.try_state::<SharedShadowStore>();
    let lookups = lookup_all(store.as_deref(), &paths, &live);
    let plan = plan_route(source, &lookups, has_windows_with_documents(app));
    execute_plan(
        &plan,
        source,
        |target: &RouteTarget| emit_to_window(app, target),
        |path: String| open_file_in_new_window(app, path),
        |group: Vec<String>| {
            let _ = app.emit("file:open", group);
        },
        |context, error: Option<String>| {
            // A failed emit (fell back to a new window) is a Warn/Fail with its reason.
            let (level, status) = match error {
                Some(_) => (LogLevel::Warn, LogStatus::Fail),
                None => (LogLevel::Info, LogStatus::Success),
            };
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

/// Open file in a new window
pub fn open_file_in_new_window(app: &AppHandle, path: String) {
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
