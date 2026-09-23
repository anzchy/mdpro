//! Purpose: the wire vocabulary of `quit_guard_reply`, and the id validation
//! that stands between the webview and `delete_draft`.
//!
//! Key decisions:
//! - `QuitAnswer` is a strict serde enum: an unknown string is a deserialize
//!   error rather than a silently tolerated answer (ADR-0025 §2).
//! - `document_ids` is accepted **only** with `discard`. `Some([])` on any other
//!   answer is an error, not a tolerated no-op: a caller that sends ids with
//!   `clean` has a bug, and swallowing it hides which quit deleted what.
//!
//! @coordinates-with docs/adr/0025-app-quit-is-deferred-through-a-native-terminate-hook.md

use crate::services::draft;
use serde::{Deserialize, Serialize};

/// A `discard` may not carry more ids than this. One window's dirty documents,
/// generously bounded — the cap exists so a hostile payload cannot make the
/// commit path walk an unbounded list of filesystem operations.
pub const MAX_DISCARD_IDS: usize = 64;

/// One window's answer to a quit request, as it crosses the IPC boundary.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum QuitAnswer {
    Clean,
    Dirty,
    Discard,
    Cancel,
    /// The phase-2 delivery ack (ADR-0029 §1). It carries no ids — it says only
    /// that the dialog reached the screen — and `validate_discard_ids` refuses
    /// any that are sent with it, exactly as it does for `clean` and `cancel`.
    Delivered,
}

/// Validate a reply's `document_ids` against its answer.
///
/// Returns the ids to discard (empty for every answer but `discard`), or an
/// error describing the refusal. Nothing on disk is touched here.
pub fn validate_discard_ids(
    answer: QuitAnswer,
    document_ids: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let Some(ids) = document_ids else {
        return Ok(Vec::new());
    };
    if answer != QuitAnswer::Discard {
        return Err(format!(
            "documentIds is only valid with the discard answer, not {answer:?}"
        ));
    }
    if ids.len() > MAX_DISCARD_IDS {
        return Err(format!(
            "too many documentIds: {} (the limit is {MAX_DISCARD_IDS})",
            ids.len()
        ));
    }
    // The same rule `bundle_path` enforces, applied before anything is deleted
    // so one hostile id refuses the whole list instead of half-deleting it.
    if let Some(bad) = ids.iter().find(|id| !draft::is_valid_draft_id(id)) {
        return Err(format!("invalid document id: {bad:?}"));
    }
    Ok(ids)
}

#[cfg(test)]
#[path = "reply_tests.rs"]
mod reply_tests;
