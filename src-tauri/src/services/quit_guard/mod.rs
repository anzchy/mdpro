//! Purpose: the guarded app-quit path (D16).
//!
//! Pipeline: `applicationShouldTerminate:` (WI-4) -> driver (WI-3) ->
//! `coordinator` (this work item) -> NSApp reply.
//!
//! Key decisions:
//! - The decision logic is a pure state machine in `coordinator`: no
//!   `AppHandle`, no objc, no clock. It compiles on every platform.
//! - Only the hook and the effects adapter are `cfg(target_os = "macos")`.
//! - **One quit-committed flag.** `QUIT_COMMITTED` is the single static that
//!   `QuitGuard::new` sets on commit and `commands::draft::save_draft` reads.
//!   Two flags would let an auto-save tick recreate a draft between the delete
//!   and process exit, which is the resurrection ADR-0025 §4 forbids.
//!
//! @coordinates-with docs/adr/0025-app-quit-is-deferred-through-a-native-terminate-hook.md
//! @coordinates-with docs/adr/0027-a-quit-ack-timeout-draws-a-native-alert.md

pub mod coordinator;
pub mod driver;
pub mod effects;
mod events;
pub mod logging;
pub mod reply;
mod types;

use std::sync::atomic::AtomicBool;

pub use driver::{CommitReport, QuitEffects, QuitEvent, QuitGuard};
pub use reply::{QuitAnswer, MAX_DISCARD_IDS};

/// Set once a quit has committed. From that moment `save_draft` refuses to
/// write, so an auto-save tick cannot recreate a draft the user discarded.
/// There is no production reset: the process is on its way out.
pub(crate) static QUIT_COMMITTED: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
pub(crate) fn reset_quit_committed_for_tests() {
    QUIT_COMMITTED.store(false, std::sync::atomic::Ordering::SeqCst);
}

/// Route a window event to the guard.
///
/// **Only `Destroyed`.** A window that is really gone counts as `clean` and
/// lets the quit move on; `CloseRequested` must not, because the user can still
/// keep that window open (ADR-0025 §2, manual gate G20). Routing it would quit
/// past a window the user just chose to save.
pub fn on_window_event<E: QuitEffects>(
    guard: &QuitGuard<E>,
    label: &str,
    event: &tauri::WindowEvent,
) {
    if matches!(event, tauri::WindowEvent::Destroyed) {
        guard.window_gone(label);
    }
}

#[cfg(test)]
#[path = "driver_tests.rs"]
mod driver_tests;

#[cfg(test)]
#[path = "driver_prop_tests.rs"]
mod driver_prop_tests;
