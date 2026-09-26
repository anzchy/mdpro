//! Purpose: whether a draft is offered in the *Recover drafts* dialog
//! (ADR-0038 §3). Pure; owner liveness is already folded into `in_use`.
use super::InUseReason;

/// Hidden while in use. Otherwise shown, except a recovered draft with no
/// owner (today's behaviour). A recovered draft whose owner is dead is shown
/// again: that is a crash after recovery, before the next autosave.
pub fn visible(recovered: bool, has_owner: bool, in_use: Option<InUseReason>) -> bool {
    match in_use {
        Some(InUseReason::OwnedByLiveWindow) | Some(InUseReason::OpenInWindow) => false,
        None => !recovered || has_owner,
    }
}

#[cfg(test)]
#[path = "visibility_tests.rs"]
mod visibility_tests;
