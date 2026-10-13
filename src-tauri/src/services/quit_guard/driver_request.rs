//! Purpose: the guarded quit off macOS (D190-WI-4, ADR-0090). The app menu's
//! Exit item opens the same request `applicationShouldTerminate:` opens on
//! macOS, and the ADR-0027 alert, which is not drawn off macOS, is answered
//! headlessly.
//!
//! Pipeline: Exit (`menu.rs` `request_guarded_quit`) -> `request_quit` ->
//! `begin` -> phase 1 / prompts / re-check / backstop -> commit ->
//! `reply(true)` -> `AppHandle::exit(0)` (`effects.rs`) -> `RunEvent::Exit` ->
//! `app_exit::run_exit_cleanup` (`main.rs`).
//!
//! Key decisions:
//! - **Nothing to guard exits through the same effect.** On macOS AppKit acts
//!   on `NSTerminateNow` itself; off macOS `request_quit` calls `reply(true)`,
//!   so every exit, immediate or committed, is the one `AppHandle::exit(0)`.
//! - **A timeout never quits on its own** (`headless_fallback_answer` is
//!   `None`): the off-macOS `native_fallback` reports `false`, the driver
//!   releases the request to the windows, and a wedged webview is escaped by
//!   "Stop Waiting and Quit…", as on macOS.
//! - **The escape answers `QuitAnyway`**: choosing it is the person's answer,
//!   so it takes the alert's Quit Without Saving path, which deletes no draft
//!   (ADR-0027 §5). No dialog is drawn (rfd deferred, ADR-0090).
//!
//! @coordinates-with src-tauri/src/menu.rs
//! @coordinates-with src-tauri/src/services/quit_guard/effects.rs
//! @coordinates-with docs/adr/0090-windows-and-linux-quit-through-the-quit-guard.md

use super::{Begin, FallbackAnswer, FallbackCause, QuitEffects, QuitGuard};

impl<E: QuitEffects> QuitGuard<E> {
    /// The menu's Exit item was chosen off macOS: open a quit request over the
    /// windows open right now, or exit at once when there is nothing to guard.
    /// A nested request while one is live (`AlreadyPending`) does nothing.
    pub fn request_quit<S: AsRef<str>>(&self, window_labels: &[S], now_ms: u64) -> Begin {
        let begin = self.begin(window_labels, now_ms);
        if begin == Begin::TerminateNow && !self.effects.reply(true) {
            super::logging::log_effect_failed(0, "reply");
        }
        begin
    }
}

/// The answer the ADR-0027 alert gives off macOS, where no alert is drawn:
/// the escape quits without saving, a timeout gives no answer.
pub fn headless_fallback_answer(cause: FallbackCause) -> Option<FallbackAnswer> {
    match cause {
        FallbackCause::Escape => Some(FallbackAnswer::QuitAnyway),
        FallbackCause::Timeout => None,
    }
}

#[cfg(test)]
#[path = "driver_headless_tests.rs"]
mod headless_tests;
