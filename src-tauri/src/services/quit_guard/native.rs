//! Purpose: the platform-free half of the macOS terminate hook: AppKit's raw
//! reply and alert-button values, the `Begin` -> reply table, the alert-button
//! -> answer table, and the install outcome. Moved verbatim out of `mod.rs`
//! under rule 50 §6 (D190-WI-4); `mod.rs` re-exports every item, so callers
//! and `native_tests.rs` are unchanged.
//!
//! Key decisions:
//! - Pure and compiled on every platform, so the tables AppKit reads are
//!   covered by tests that need no AppKit.
//!
//! @coordinates-with src-tauri/src/services/quit_guard/macos.rs

use super::{Begin, FallbackAnswer};

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
