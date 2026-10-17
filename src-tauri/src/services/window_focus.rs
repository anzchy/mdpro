//! Purpose: records which window has focus: one `window.focus` /
//! `window.blur` log line, the MCP shadow store's focused window (D217) and
//! the menu's `MenuFocus`, which picks the window a menu action goes to
//! (D261).
//!
//! Key decisions: `main.rs` calls this from `app.run`'s
//! `RunEvent::WindowEvent`, never from `Builder::on_window_event`. Tauri
//! registers a window's `on_window_event` listener by posting a message to the
//! event loop after the window is built, and building a window makes it key.
//! A window created at runtime (⌘⇧N, an external open) can therefore have its
//! one initial focus event dispatched before that listener exists, and the
//! event is lost; the app-level callback is invoked for every window the
//! runtime knows, with no registration step.
//!
//! The two stores are fed the same event but kept apart: the shadow store's
//! copy is also cleared on the vetoable `CloseRequested`, `MenuFocus` only on
//! `Destroyed`.
//!
//! @coordinates-with main.rs (the `app.run` callback), shadow_store.rs
//! @coordinates-with menu_target.rs (`MenuFocus`)

use crate::menu::MenuFocus;
use crate::models::{LogEntryPayload, LogLevel, LogStatus, SharedShadowStore};
use crate::services::{logger, shadow_store};
use serde_json::json;

/// The log event name for a focus change.
pub fn focus_event_name(focused: bool) -> &'static str {
    if focused {
        "window.focus"
    } else {
        "window.blur"
    }
}

/// Applies a focus change to the shadow store: focus makes `label` the
/// focused window; blur clears it only while `label` is still the focused
/// one, so a blur that arrives after another window's focus is harmless.
pub fn apply_focus(store: &SharedShadowStore, label: &str, focused: bool) -> Result<(), String> {
    if focused {
        shadow_store::set_focused_window(store, label)
    } else {
        shadow_store::clear_focused_window_if(store, label)
    }
}

/// Logs the focus change and applies it to the shadow store and to the
/// menu's `MenuFocus`, each when it is managed.
pub fn on_focus_event(
    store: Option<&SharedShadowStore>,
    menu_focus: Option<&MenuFocus>,
    label: &str,
    focused: bool,
) {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: focus_event_name(focused).to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(json!({
            "windowId": label,
            "windowLabel": label
        })),
        duration_ms: None,
        error: None,
    });
    if let Some(store) = store {
        let _ = apply_focus(store, label, focused);
    }
    if let Some(menu_focus) = menu_focus {
        menu_focus.apply(label, focused);
    }
}

#[cfg(test)]
#[path = "window_focus_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "window_focus_wiring_tests.rs"]
mod wiring_tests;
