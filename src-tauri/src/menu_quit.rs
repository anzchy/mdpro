//! Purpose: the app menu's Quit item per target, and the log line of the
//! guarded Exit click (D190-WI-4, ADR-0090).
//!
//! Key decisions:
//! - macOS keeps AppKit's predefined Quit (`terminate:`), which the native
//!   terminate hook guards (ADR-0025). Every other target gets a custom Exit
//!   item: muda answers the predefined Quit on Windows with `PostQuitMessage`,
//!   which ends the event loop without `ExitRequested`, without the quit guard
//!   and without the ADR-0035 draft backstop.
//! - The click's log line carries only the outcome and a window count, never
//!   window labels.
//!
//! @coordinates-with src-tauri/src/menu.rs
//! @coordinates-with src-tauri/src/services/quit_guard/driver_request.rs
//! @coordinates-with docs/adr/0090-windows-and-linux-quit-through-the-quit-guard.md

use serde_json::{json, Value};

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use crate::services::quit_guard::Begin;

/// Which Quit item the app menu carries on a target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum QuitItem {
    /// AppKit's `terminate:`, which the native terminate hook guards.
    Predefined,
    /// A custom item routed into `QuitGuard::request_quit`.
    Guarded,
}

/// The Quit item for `os` (`std::env::consts::OS`).
pub(crate) fn quit_item_for(os: &str) -> QuitItem {
    if os == "macos" {
        QuitItem::Predefined
    } else {
        QuitItem::Guarded
    }
}

/// The wire name of what the guarded Exit click did. `None` means no guard was
/// managed (setup never finished), and the app exited directly.
pub(crate) fn exit_outcome_str(begin: Option<&Begin>) -> &'static str {
    match begin {
        Some(Begin::Later { .. }) => "requested",
        Some(Begin::TerminateNow) => "terminateNow",
        Some(Begin::AlreadyPending) => "alreadyPending",
        None => "noGuard",
    }
}

/// The `context` of the `app.quit.menu_exit` line: counts and enums only.
pub(crate) fn exit_log_context(begin: Option<&Begin>, window_count: usize) -> Value {
    json!({
        "outcome": exit_outcome_str(begin),
        "windowCount": window_count,
    })
}

/// Log the guarded Exit click.
pub(crate) fn log_menu_exit(begin: Option<&Begin>, window_count: usize) {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "app.quit.menu_exit".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(exit_log_context(begin, window_count)),
        duration_ms: None,
        error: None,
    });
}

#[cfg(test)]
#[path = "menu_escape_order_tests.rs"]
mod escape_order_tests;

#[cfg(test)]
#[path = "menu_quit_log_tests.rs"]
mod log_tests;
