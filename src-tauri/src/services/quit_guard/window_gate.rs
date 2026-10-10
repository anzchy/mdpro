//! Purpose: refuse to open a new window while a quit request is live (D74).
//!
//! Pipeline: `commands::window::create_window` / `open_route::tauri_glue::
//! route_external_open` -> `new_window_gate` -> `QuitGuard::is_request_live`
//! -> build the window, or refuse it.
//!
//! Key decisions:
//! - **Refuse, do not enrol.** A request snapshots its windows at `begin`
//!   (`request.rs`); a window opened after that is never asked, never prompted
//!   and never waited for by the backstop, so its edits could be lost at the
//!   commit. Refusing the window keeps the snapshot complete. Adding late
//!   windows to a live request was the alternative; it would reopen phase 1
//!   mid-prompt and was not taken.
//! - **Every live state refuses**, the native alert's included (ADR-0027): the
//!   request is live until the coordinator drops it, at a commit or a cancel.
//! - **The gate is checked, then the lock is dropped, then the caller builds.**
//!   `WebviewWindowBuilder::build` blocks on the main thread, which is where
//!   `applicationShouldTerminate:` takes the coordinator mutex, so holding the
//!   mutex across a build could deadlock (see `driver.rs`, "No effect ever runs
//!   under the lock"). The cost is a residual race: a quit that begins between
//!   the check and the build still misses that window, exactly as before D74.
//! - **No guard managed means allow**: before `setup()` manages the guard there
//!   is no request to protect.
//!
//! @coordinates-with src-tauri/src/commands/window.rs
//! @coordinates-with src-tauri/src/services/open_route/tauri_glue.rs
//! @coordinates-with docs/adr/0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md
//! @coordinates-with docs/adr/0066-no-new-windows-while-a-quit-request-is-live.md
use super::driver::{QuitEffects, QuitGuard};

/// The error `create_window` returns while a quit is pending. The frontend
/// (`windowService.createWindow`) matches it literally, so it is a contract.
pub const QUIT_PENDING_REFUSAL: &str = "window_refused_quit_pending";

/// `Ok` when a new window may open now; `Err(QUIT_PENDING_REFUSAL)` while a
/// quit request is live. Takes the coordinator mutex only for the read.
pub fn new_window_gate<E: QuitEffects>(guard: Option<&QuitGuard<E>>) -> Result<(), &'static str> {
    match guard {
        Some(guard) if guard.is_request_live() => Err(QUIT_PENDING_REFUSAL),
        _ => Ok(()),
    }
}

#[cfg(test)]
#[path = "window_gate_tests.rs"]
mod tests;
