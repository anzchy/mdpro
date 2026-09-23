//! Purpose: the wire vocabulary of `quit_guard_reply`, and the id validation
//! that stands between the webview and `delete_draft`.
//!
//! Key decisions:
//! - `QuitAnswer` is a strict serde enum: an unknown string is a deserialize
//!   error rather than a silently tolerated answer (ADR-0025 §2).
//! - `document_ids` is accepted **only** with `discard`. `Some([])` on any other
//!   answer is an error, not a tolerated no-op: a caller that sends ids with
//!   `clean` has a bug, and swallowing it hides which quit deleted what.
//! - **Refusals never quote an id.** The error text is logged as
//!   `app.quit.answer` and handed back to the webview, so it names only an
//!   index or the cap. The quit logs are counts-only (D16F WI-3).
//!
//! @coordinates-with docs/adr/0025-app-quit-is-deferred-through-a-native-terminate-hook.md

use crate::services::draft;
use serde::{Deserialize, Serialize};

/// A `discard` may not carry more ids than this: the crate-wide per-window
/// document limit, the same bound MCP applies to one window's sync payload, so
/// a window can always discard every document it is allowed to hold (D16F
/// WI-4). The cap exists so a hostile payload cannot make the commit path walk
/// an unbounded list of filesystem operations.
pub const MAX_DISCARD_IDS: usize = crate::MAX_DOCUMENTS_PER_WINDOW;

/// No single discarded id may be longer than this, in bytes. The app's own ids
/// are far shorter — a UUID is 36 bytes and `doc-${Date.now()}-${hex}` is about
/// 31 — and 128 still leaves the `{id}.draft.json` bundle name well inside a
/// 255-byte filename, so an over-long id is refused here rather than by the
/// filesystem halfway through a commit.
pub const MAX_DISCARD_ID_BYTES: usize = 128;

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
/// error describing the refusal. The error names an index or a limit, never an
/// id. Nothing on disk is touched here.
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
    for (index, id) in ids.iter().enumerate() {
        if !draft::is_valid_draft_id(id) {
            return Err(format!("invalid document id at index {index}"));
        }
        if id.len() > MAX_DISCARD_ID_BYTES {
            return Err(format!("document id exceeds {MAX_DISCARD_ID_BYTES} bytes"));
        }
    }
    Ok(ids)
}

#[cfg(test)]
#[path = "reply_tests.rs"]
mod reply_tests;

#[cfg(test)]
#[path = "reply_validate_tests.rs"]
mod reply_validate_tests;
