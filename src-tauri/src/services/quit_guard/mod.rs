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
#[cfg(target_os = "macos")]
pub mod macos;
pub mod reply;
mod types;

use std::sync::atomic::AtomicBool;

pub use coordinator::{Begin, FallbackAnswer};
pub use driver::{CommitReport, QuitEffects, QuitEvent, QuitGuard};
pub use reply::{QuitAnswer, MAX_DISCARD_IDS};

/// AppKit's `NSApplicationTerminateReply` values, as raw `NSUInteger`s. They are
/// an ABI, not a preference: AppKit reads the number the IMP returns.
pub const NS_TERMINATE_CANCEL: usize = 0;
pub const NS_TERMINATE_NOW: usize = 1;
pub const NS_TERMINATE_LATER: usize = 2;

/// AppKit's `NSAlertFirstButtonReturn`. Buttons are numbered from this in the
/// order they were added, not the order they are drawn.
pub const NS_ALERT_FIRST_BUTTON: isize = 1000;

/// What `begin` tells `applicationShouldTerminate:` to return.
///
/// Pure, and compiled on every platform, so the table that AppKit reads is
/// covered by a test that does not need AppKit.
pub fn ns_reply_for(begin: &Begin) -> usize {
    match begin {
        // Nothing to guard: let AppKit tear the app down now.
        Begin::TerminateNow => NS_TERMINATE_NOW,
        // The coordinator owns the decision; AppKit waits for
        // `replyToApplicationShouldTerminate:`.
        Begin::Later { .. } => NS_TERMINATE_LATER,
        // A nested `terminate:` while a request is live. Cancelling the nested
        // call leaves the pending request intact (ADR-0025 §2).
        Begin::AlreadyPending => NS_TERMINATE_CANCEL,
    }
}

/// Map the timeout alert's button onto the fallback answer (ADR-0027).
///
/// Takes the raw `NSModalResponse` that `runModal` returns rather than a 0-based
/// index, so the whole mapping — including the offset AppKit applies — is inside
/// the tested pure function instead of split across an untestable conversion.
/// Anything that is not the second button is `KeepOpen`: the safe direction,
/// because it never discards.
pub fn fallback_answer_for(modal_response: isize) -> FallbackAnswer {
    if modal_response == NS_ALERT_FIRST_BUTTON + 1 {
        FallbackAnswer::QuitAnyway
    } else {
        FallbackAnswer::KeepOpen
    }
}

/// The result of adding `applicationShouldTerminate:` to the delegate class.
///
/// `AlreadyDefined` is the tao-upgrade failure mode: a future tao that defines
/// the method itself would leave the app quitting unguarded, so it is reported
/// rather than papered over with `class_replaceMethod`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallOutcome {
    Added,
    AlreadyDefined,
    NoDelegate,
}

impl InstallOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            InstallOutcome::Added => "added",
            InstallOutcome::AlreadyDefined => "alreadyDefined",
            InstallOutcome::NoDelegate => "noDelegate",
        }
    }

    /// Only `Added` means the quit is guarded.
    pub fn installed(self) -> bool {
        matches!(self, InstallOutcome::Added)
    }

    /// Why the install failed, for the log's `error` field. A silent failure
    /// here looks like a working app and discards data, so it is never `None`
    /// for a non-`Added` outcome.
    pub fn failure_reason(self) -> Option<&'static str> {
        match self {
            InstallOutcome::Added => None,
            InstallOutcome::AlreadyDefined => {
                Some("the delegate class already implements applicationShouldTerminate:")
            }
            InstallOutcome::NoDelegate => Some("NSApp has no delegate to hook"),
        }
    }
}

/// Install the native terminate hook.
///
/// A no-op off macOS: there is no `applicationShouldTerminate:` to add, and the
/// coordinator has no other caller there.
pub fn install(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::install(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

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
#[path = "native_tests.rs"]
mod native_tests;

#[cfg(test)]
#[path = "driver_tests.rs"]
mod driver_tests;

#[cfg(test)]
#[path = "driver_prop_tests.rs"]
mod driver_prop_tests;
