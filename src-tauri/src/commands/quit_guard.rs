//! Purpose: the IPC entry point for a window's answer to a quit request.
//!
//! Pipeline: `useQuitGuard` (frontend) -> `quit_guard_reply` -> the managed
//! `QuitGuard` -> the coordinator.
//!
//! Key decisions:
//! - **The window label comes from the caller, never from the payload**
//!   (ADR-0025 §2). A webview therefore cannot *resolve another window's
//!   decision* — it cannot turn a sibling's `dirty` into `clean` and rob it of
//!   its prompt.
//! - **That is not draft ownership, and this file does not claim it.**
//!   `document_ids` still arrives in the payload, and
//!   `reply::validate_discard_ids` checks each id's *shape* and caps the count
//!   — never which window the draft belongs to. A compromised renderer can name
//!   a sibling's document ids in its own `discard` and those drafts are deleted
//!   when the quit commits. Closing that would need a label→id binding the
//!   backend can check, which does not exist today.
//! - **`drafted` may carry `document_ids` too** (ADR-0035 review M-1): the ids
//!   this window discarded and then redrafted after an edit, whose drafts the
//!   commit must keep. These ARE bound to the caller: the coordinator keeps only
//!   ids this same label discarded, so a window cannot cancel a sibling's
//!   discard. They pass `reply::validate_undiscard_ids` (the discard rules).
//! - Validation of `document_ids` and of `drafted_count` / `failed_count`
//!   lives in `services::quit_guard::reply`, so the rule is the same whether
//!   the answer arrives here or from the native fallback. The counts are
//!   accepted only with `drafted`, both are required, and each is capped at
//!   `MAX_BACKSTOP_COUNT` (ADR-0035 §4); a refusal is an `Err`, never a panic.
//! - `round` is the round the window answers (ADR-0035 A5). A reply tagged
//!   with any other round is a reordered one and changes nothing; `None` keeps
//!   the pre-ADR-0035 behaviour of answering the current round.
//! - Wire arguments (camelCase): `requestId`, `answer`, `documentIds`,
//!   `draftedCount`, `failedCount`, `round`.
//!
//! @coordinates-with src-tauri/src/services/quit_guard/driver.rs
//! @coordinates-with src-tauri/src/services/quit_guard/driver_wire.rs

use tauri::{State, WebviewWindow};

use crate::services::quit_guard::effects::{now_ms, AppQuitGuard};
use crate::services::quit_guard::QuitAnswer;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn quit_guard_reply(
    window: WebviewWindow,
    guard: State<'_, AppQuitGuard>,
    request_id: u64,
    answer: QuitAnswer,
    document_ids: Option<Vec<String>>,
    drafted_count: Option<u32>,
    failed_count: Option<u32>,
    round: Option<u32>,
) -> Result<(), String> {
    guard.handle_wire_reply(
        window.label(),
        request_id,
        answer,
        document_ids,
        drafted_count,
        failed_count,
        round,
        now_ms(),
    )
}
