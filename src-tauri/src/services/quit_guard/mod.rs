//! Purpose: the guarded app-quit path (D16).
//!
//! Pipeline: `applicationShouldTerminate:` (`macos`) -> `driver` ->
//! `coordinator` -> `effects` -> NSApp reply; off macOS, the Exit menu item ->
//! `driver_request` -> the same driver -> `AppHandle::exit` (ADR-0090); escape
//! menu -> `driver_escape` -> `coordinator` -> ADR-0027 alert (headless off
//! macOS); new window -> `window_gate` (D74).
//!
//! Key decisions:
//! - The decision logic is a pure state machine in `coordinator`: no
//!   `AppHandle`, no objc, no clock. It compiles on every platform. Only
//!   `macos` (the hook) is cfg-gated; `effects` branches inside per target.
//! - **No new window opens while a request is live** (D74, `window_gate.rs`).
//! - AppKit's raw reply / alert values and the tables over them live in
//!   `native.rs`, re-exported here.
//! - **One quit-committed gate.** `QUIT_COMMITTED` is the single static that
//!   `QuitGuard::new` closes on commit and `commands::draft::save_draft` passes
//!   its write through. Two gates would let an auto-save tick recreate a draft
//!   between the delete and process exit: the resurrection ADR-0025 §4 forbids.
//! - **The gate is a lock, not a flag.** A bare `AtomicBool` made both sides
//!   check-then-act, so a save that read `false` could still land its write
//!   *after* the commit deleted that draft. See `DraftGate`.
//!
//! @coordinates-with docs/adr/0025-app-quit-is-deferred-through-a-native-terminate-hook.md
//! @coordinates-with docs/adr/0027-a-quit-ack-timeout-draws-a-native-alert.md

pub mod coordinator;
pub mod driver;
pub mod effects;
mod events;
pub mod logging;
#[cfg(target_os = "macos")]
pub mod macos;
mod native;
mod plan;
pub mod reply;
mod request;
mod rounds;
mod types;
pub mod window_gate;

use std::sync::{RwLock, RwLockWriteGuard};

pub use coordinator::{Begin, FallbackAnswer};
pub use driver::{deliver_escape, CommitReport, QuitEffects, QuitEvent, QuitGuard};
pub use native::{
    fallback_answer_for, ns_reply_for, InstallOutcome, NS_ALERT_FIRST_BUTTON, NS_TERMINATE_CANCEL,
    NS_TERMINATE_LATER, NS_TERMINATE_NOW,
};
pub use reply::{QuitAnswer, MAX_DISCARD_IDS};

/// Install the native terminate hook.
///
/// A no-op off macOS: there is no `applicationShouldTerminate:` to add. There
/// the app menu's Exit item opens the request instead (`request_quit`,
/// ADR-0090).
pub fn install(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::install(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// The gate between a committed quit and the auto-save ticks still running.
///
/// It is a lock rather than a flag because the two sides each do **two** things
/// and both pairs have to be indivisible:
///
/// - a save *checks* the gate and then *writes* a draft;
/// - a commit *closes* the gate and then *deletes* the discarded drafts.
///
/// With an `AtomicBool` the pairs could interleave: a save that read `false`,
/// then stalled, would write its draft back after the commit had already
/// deleted it, and the next launch would offer to recover work the user
/// explicitly discarded (ADR-0025 §4). The `RwLock` makes a save and a commit
/// mutually exclusive instead of merely ordered.
///
/// **Lock ordering: this gate is the OUTER lock.** It may be taken while
/// nothing else is held, and `QuitGuard`'s coordinator mutex may be taken only
/// *after* the gate guard has been dropped — never the other way round. The
/// driver is the only place the two meet; see `driver::QuitGuard::run`.
pub struct DraftGate {
    closed: RwLock<bool>,
}

impl DraftGate {
    pub(crate) const fn new() -> Self {
        Self {
            closed: RwLock::new(false),
        }
    }

    /// Run `write` while the gate is provably open, or return `None` because a
    /// quit has already committed.
    ///
    /// The read guard is held for the whole of `write`, which is what stops a
    /// commit from deleting a draft that `write` is in the middle of saving.
    /// Taking a closure rather than handing the guard out is deliberate: a
    /// caller cannot accidentally check the gate and write outside it.
    pub(crate) fn if_open<T>(&self, write: impl FnOnce() -> T) -> Option<T> {
        // The guard is bound, not dereferenced into a temporary: it has to
        // outlive `write()`. Reading the flag and then writing outside the
        // guard is the check-then-act this type exists to make impossible.
        let closed = self.read_guard();
        if *closed {
            return None;
        }
        Some(write())
    }

    /// Close the gate. Every saver is kept out until the returned guard drops,
    /// so the caller can delete the discarded drafts knowing that none of them
    /// can be written back behind it.
    pub(crate) fn close(&self) -> RwLockWriteGuard<'_, bool> {
        let mut closed = self.closed.write().unwrap_or_else(|e| e.into_inner());
        *closed = true;
        closed
    }

    /// Poisoning: a saver that panicked cannot have torn a `bool`, and refusing
    /// here would strand every later save, so the value is recovered — the same
    /// rule `macos::set_host` follows.
    fn read_guard(&self) -> std::sync::RwLockReadGuard<'_, bool> {
        self.closed.read().unwrap_or_else(|e| e.into_inner())
    }

    /// Has a quit committed? Blocking, so it must not be called by anything
    /// already holding a guard on this gate.
    #[cfg(test)]
    pub(crate) fn is_closed(&self) -> bool {
        *self.read_guard()
    }

    /// Is the closing critical section running right now?
    ///
    /// Non-blocking on purpose: its only caller is the `on_delete` observation
    /// hook, which the driver invokes *while holding the write guard*. A
    /// blocking read there would deadlock against the very guard it is asking
    /// about.
    #[cfg(test)]
    pub(crate) fn is_held_closed(&self) -> bool {
        matches!(
            self.closed.try_read(),
            Err(std::sync::TryLockError::WouldBlock)
        )
    }

    #[cfg(test)]
    pub(crate) fn reopen_for_tests(&self) {
        *self.closed.write().unwrap_or_else(|e| e.into_inner()) = false;
    }
}

/// Closed once a quit has committed. From that moment `save_draft` refuses to
/// write, so an auto-save tick cannot recreate a draft the user discarded.
/// There is no production reset: the process is on its way out.
pub(crate) static QUIT_COMMITTED: DraftGate = DraftGate::new();

#[cfg(test)]
pub(crate) fn reset_quit_committed_for_tests() {
    QUIT_COMMITTED.reopen_for_tests();
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
        // The window event carries no timestamp, and the coordinator needs one
        // to date any prompt this gone lets through; this is the same
        // monotonic clock every other production entry point reads.
        guard.window_gone(label, effects::now_ms());
    }
}

#[cfg(test)]
#[path = "native_tests.rs"]
mod native_tests;

#[cfg(test)]
#[path = "driver_fixtures.rs"]
mod driver_fixtures;

#[cfg(test)]
#[path = "driver_tests.rs"]
mod driver_tests;

#[cfg(test)]
#[path = "driver_commit_tests.rs"]
mod driver_commit_tests;

#[cfg(test)]
#[path = "driver_concurrency_tests.rs"]
mod driver_concurrency_tests;

#[cfg(test)]
#[path = "driver_window_tests.rs"]
mod driver_window_tests;

#[cfg(test)]
#[path = "driver_prop_tests.rs"]
mod driver_prop_tests;

#[cfg(test)]
#[path = "driver_deadline_tests.rs"]
mod driver_deadline_tests;

#[cfg(test)]
#[path = "driver_fixtures_tests.rs"]
mod driver_fixtures_tests;

#[cfg(test)]
#[path = "driver_cap_tests.rs"]
mod driver_cap_tests;
#[cfg(test)]
#[path = "driver_commit_log_tests.rs"]
mod driver_commit_log_tests;
#[cfg(test)]
#[path = "driver_redaction_tests.rs"]
mod driver_redaction_tests;
#[cfg(test)]
#[path = "driver_request_tests.rs"]
mod driver_request_tests;
#[cfg(test)]
#[path = "effects_exit_tests.rs"]
mod effects_exit_tests;
