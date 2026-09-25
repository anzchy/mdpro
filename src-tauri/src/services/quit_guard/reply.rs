//! Purpose: the wire vocabulary of `quit_guard_reply`, and the id and count
//! validation that stands between the webview and `delete_draft` / the commit
//! report.
//!
//! Key decisions:
//! - `QuitAnswer` is a strict serde enum: an unknown string is a deserialize
//!   error rather than a silently tolerated answer (ADR-0025 §2).
//! - `document_ids` is accepted **only** with `discard`. `Some([])` on any other
//!   answer is an error, not a tolerated no-op: a caller that sends ids with
//!   `clean` has a bug, and swallowing it hides which quit deleted what.
//! - `drafted` (ADR-0035 §4) carries `draftedCount` / `failedCount`; the counts
//!   are accepted **only** with `drafted`, both are required, and each is
//!   capped at `MAX_BACKSTOP_COUNT` (`validate_backstop_counts`).
//! - `drafted` may also carry `documentIds` (ADR-0035 review M-1): the ids the
//!   window discarded and then redrafted after an edit, whose drafts the commit
//!   must keep. They pass `validate_undiscard_ids` — the discard rules, applied
//!   to `drafted` only. `validate_discard_ids` still refuses ids on `drafted`.
//! - **Refusals never quote an id.** The error text is logged as
//!   `app.quit.answer` and handed back to the webview, so it names only an
//!   index or the cap, and a count refusal names the field or the cap, never the
//!   value sent. The quit logs are counts-only (D16F WI-3).
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
    /// The backstop answer (ADR-0035 §4): the window drafted its dirty
    /// documents. It carries two counts, and optionally the ids it redrafted
    /// after discarding them (review M-1).
    Drafted,
}

/// A `drafted` count may not exceed this: the per-window document limit, plus
/// one for the active document's flush that may fail beside it (ADR-0035 §4).
/// The cap keeps a hostile payload from writing an absurd tally into the commit
/// report and its log line.
pub const MAX_BACKSTOP_COUNT: u32 = crate::MAX_DOCUMENTS_PER_WINDOW as u32 + 1;

/// Validate a reply's `draftedCount` / `failedCount` against its answer.
///
/// Accepted only for `drafted` with both counts present and each at most
/// `MAX_BACKSTOP_COUNT`; returns `(drafted, failed)`. Every other answer is
/// refused — with a count present, because counts belong to `drafted` only;
/// without one, because no other answer has counts to validate. A refusal names
/// the field or the cap, never the value that was sent.
pub fn validate_backstop_counts(
    answer: QuitAnswer,
    drafted_count: Option<u32>,
    failed_count: Option<u32>,
) -> Result<(u32, u32), String> {
    if answer != QuitAnswer::Drafted {
        return Err(format!(
            "draftedCount/failedCount are allowed only with drafted, not {answer:?}"
        ));
    }
    let Some(drafted) = drafted_count else {
        return Err("drafted counts required: draftedCount is missing".to_string());
    };
    let Some(failed) = failed_count else {
        return Err("drafted counts required: failedCount is missing".to_string());
    };
    if drafted > MAX_BACKSTOP_COUNT {
        return Err(format!("draftedCount exceeds {MAX_BACKSTOP_COUNT}"));
    }
    if failed > MAX_BACKSTOP_COUNT {
        return Err(format!("failedCount exceeds {MAX_BACKSTOP_COUNT}"));
    }
    Ok((drafted, failed))
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
    check_id_list(ids)
}

/// Validate a `drafted` reply's `document_ids`: the ids its window discarded in
/// this request and redrafted in the backstop after an edit (ADR-0035 review
/// M-1). Accepted only with `drafted`, under exactly the discard rules — the
/// same cap, the same id shape, the same never-quote-an-id refusals.
pub fn validate_undiscard_ids(
    answer: QuitAnswer,
    document_ids: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let Some(ids) = document_ids else {
        return Ok(Vec::new());
    };
    if answer != QuitAnswer::Drafted {
        return Err(format!(
            "undiscarded documentIds are only valid with drafted, not {answer:?}"
        ));
    }
    check_id_list(ids)
}

/// The cap and the per-id shape rule shared by both id lists.
fn check_id_list(ids: Vec<String>) -> Result<Vec<String>, String> {
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

#[cfg(test)]
#[path = "reply_backstop_tests.rs"]
mod reply_backstop_tests;
