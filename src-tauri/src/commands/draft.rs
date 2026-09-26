//! Purpose: the draft autosave command and `get_draft` / `delete_draft`
//! (ADR-0025 §4, ADR-0038 §1). The recovery-dialog commands live in
//! `draft_recovery.rs`.
//!
//! Key decisions:
//! - Every save goes through `DraftGate::if_open`, so a committed quit cannot
//!   have a draft written back behind it.
//! - The `save_draft` command stamps the draft's owner as (this process's
//!   session id, the calling window's label). `save_draft_logged` is the
//!   command body without the injected `WebviewWindow`, so tests can call it.
//! - `save_draft_gated` keeps its unowned signature for its existing callers.
//! - The path-bearing `file.write` log is deliberately unchanged here
//!   (deferred by the D27 plan).
//!
//! @coordinates-with src-tauri/src/commands/draft_recovery.rs
//! @coordinates-with src-tauri/src/services/draft/owner.rs
use serde_json::json;

use tauri::WebviewWindow;

use crate::models::{Draft, LogEntryPayload, LogLevel, LogStatus};
use crate::services::draft::{
    delete_draft as delete_draft_service, load_draft, save_draft_as, session_id, DraftError,
    DraftOwner, DraftSaveResult,
};
use crate::services::logger;
use crate::services::quit_guard::{DraftGate, QUIT_COMMITTED};

/// Save a draft unless a quit has already committed.
///
/// Once the quit path has deleted the discarded drafts, an auto-save tick that
/// is still holding the old content must not write them back (ADR-0025 §4).
/// `DraftGate::if_open` keeps the gate's read guard for the whole write, so the
/// check and the write are indivisible: a commit cannot close the gate between
/// them and then delete a draft this call is about to recreate.
///
/// The gate is a parameter rather than a global read so a test can close it
/// without closing it for the rest of the process. It is a synchronous
/// function, and the guard lives entirely inside `if_open`, so no caller can
/// hold it across an `.await`.
///
/// Writes an unowned bundle; see `save_draft_gated_as` for the owned form.
/// Kept, with its signature, for the gate and backstop tests that call it;
/// the `save_draft` command now saves owned, so no production caller remains.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn save_draft_gated(
    committed: &DraftGate,
    document_id: &str,
    content: &str,
    original_path: Option<String>,
    title: &str,
) -> Result<DraftSaveResult, DraftError> {
    save_draft_gated_as(committed, None, document_id, content, original_path, title)
}

/// `save_draft_gated`, recording `owner` in the bundle (ADR-0038 §1).
///
/// Lock order: the gate's read guard (outer) is held across
/// `save_draft_as`, which takes the draft lock (inner) around its write.
pub(crate) fn save_draft_gated_as(
    committed: &DraftGate,
    owner: Option<DraftOwner>,
    document_id: &str,
    content: &str,
    original_path: Option<String>,
    title: &str,
) -> Result<DraftSaveResult, DraftError> {
    committed
        .if_open(|| save_draft_as(owner, document_id, content, original_path, title))
        .unwrap_or_else(|| {
            Err(DraftError::IoError {
                message: "a quit has committed: draft saving is closed".to_string(),
            })
        })
}

#[tauri::command]
pub async fn save_draft(
    window: WebviewWindow,
    document_id: String,
    content: String,
    original_path: Option<String>,
    title: String,
) -> Result<DraftSaveResult, DraftError> {
    let owner = DraftOwner {
        session_id: session_id().to_string(),
        window_label: window.label().to_string(),
    };
    save_draft_logged(Some(owner), &document_id, &content, original_path, &title)
}

/// The `save_draft` command body: a gated save through `QUIT_COMMITTED` that
/// writes `owner`, with its `file.write` log lines.
pub(crate) fn save_draft_logged(
    owner: Option<DraftOwner>,
    document_id: &str,
    content: &str,
    original_path: Option<String>,
    title: &str,
) -> Result<DraftSaveResult, DraftError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.write".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({
            "documentId": document_id,
            "filePath": original_path.as_deref(),
            "title": title
        })),
        duration_ms: None,
        error: None,
    });
    let result = save_draft_gated_as(
        &QUIT_COMMITTED,
        owner,
        document_id,
        content,
        original_path,
        title,
    )
    .inspect_err(|err| {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "file.write".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "documentId": document_id })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: Some(err.to_string()),
        });
    })?;
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.write".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({
            "documentId": document_id,
            "bytes": content.len()
        })),
        duration_ms: Some(start.elapsed().as_millis() as u64),
        error: None,
    });
    Ok(result)
}

#[tauri::command]
pub async fn get_draft(document_id: String) -> Result<Option<Draft>, DraftError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.read".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "documentId": document_id.as_str() })),
        duration_ms: None,
        error: None,
    });
    let result = load_draft(&document_id).inspect_err(|err| {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "file.read".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "documentId": document_id.as_str() })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: Some(err.to_string()),
        });
    })?;
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.read".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({
            "documentId": document_id.as_str(),
            "found": result.is_some()
        })),
        duration_ms: Some(start.elapsed().as_millis() as u64),
        error: None,
    });
    Ok(result)
}

#[tauri::command]
pub async fn delete_draft(document_id: String) -> Result<bool, DraftError> {
    delete_draft_service(&document_id)
}

#[cfg(test)]
#[path = "draft_get_tests.rs"]
mod tests;
