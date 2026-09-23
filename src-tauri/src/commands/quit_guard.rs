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
//! - Validation of `document_ids` lives in `services::quit_guard::reply`, so
//!   the rule is the same whether the answer arrives here or from the native
//!   fallback.
//!
//! @coordinates-with src/services/quit_guard/driver.rs

use tauri::{State, WebviewWindow};

use crate::services::quit_guard::effects::{now_ms, AppQuitGuard};
use crate::services::quit_guard::QuitAnswer;

#[tauri::command]
pub async fn quit_guard_reply(
    window: WebviewWindow,
    guard: State<'_, AppQuitGuard>,
    request_id: u64,
    answer: QuitAnswer,
    document_ids: Option<Vec<String>>,
) -> Result<(), String> {
    guard.handle_reply(window.label(), request_id, answer, document_ids, now_ms())
}
