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
//!   An optional claim token uses the same gate and log pair; `delete_draft`
//!   also accepts it for conditional source removal after a durable placement.
//! - `save_draft_gated` keeps its unowned signature for its existing callers.
//! - The save logs as `draft.write` (D56), not `file.write`: it writes the
//!   draft bundle under the data dir and never the document file. Its start
//!   line still carries the document's path as `filePath`, naming which
//!   document the draft belongs to (path-bearing, deferred by the D27 plan).
//!
//! @coordinates-with src-tauri/src/commands/draft_recovery.rs
//! @coordinates-with src-tauri/src/services/draft/owner.rs
use serde_json::json;

use tauri::WebviewWindow;

use crate::models::{Draft, LogEntryPayload, LogLevel, LogStatus};
use crate::services::draft::{
    delete_draft_owned, delete_draft_with_token as delete_draft_service, load_draft,
    save_draft_as_with_token, session_id, DraftClaimToken, DraftError, DraftOwner, DraftSaveResult,
    OwnedDeleteOutcome,
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
    save_draft_gated_as_with_token(
        committed,
        owner,
        document_id,
        content,
        original_path,
        title,
        None,
    )
}

fn save_draft_gated_as_with_token(
    committed: &DraftGate,
    owner: Option<DraftOwner>,
    document_id: &str,
    content: &str,
    original_path: Option<String>,
    title: &str,
    token: Option<&DraftClaimToken>,
) -> Result<DraftSaveResult, DraftError> {
    committed
        .if_open(|| {
            save_draft_as_with_token(owner, document_id, content, original_path, title, token)
        })
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
    claim_token: Option<DraftClaimToken>,
) -> Result<DraftSaveResult, DraftError> {
    let owner = DraftOwner {
        session_id: session_id().to_string(),
        window_label: window.label().to_string(),
    };
    save_draft_logged_with_token(
        Some(owner),
        &document_id,
        &content,
        original_path,
        &title,
        claim_token.as_ref(),
    )
}

/// The `save_draft` command body: a gated save through `QUIT_COMMITTED` that
/// writes `owner`, with its `draft.write` start / success / fail log lines.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn save_draft_logged(
    owner: Option<DraftOwner>,
    document_id: &str,
    content: &str,
    original_path: Option<String>,
    title: &str,
) -> Result<DraftSaveResult, DraftError> {
    save_draft_logged_with_token(owner, document_id, content, original_path, title, None)
}

fn save_draft_logged_with_token(
    owner: Option<DraftOwner>,
    document_id: &str,
    content: &str,
    original_path: Option<String>,
    title: &str,
    token: Option<&DraftClaimToken>,
) -> Result<DraftSaveResult, DraftError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "draft.write".to_string(),
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
    let result = save_draft_gated_as_with_token(
        &QUIT_COMMITTED,
        owner,
        document_id,
        content,
        original_path,
        title,
        token,
    )
    .inspect_err(|err| {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "draft.write".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "documentId": document_id })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: Some(err.to_string()),
        });
    })?;
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "draft.write".to_string(),
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
pub async fn delete_draft(
    document_id: String,
    claim_token: Option<DraftClaimToken>,
) -> Result<bool, DraftError> {
    delete_draft_service(&document_id, claim_token.as_ref())
}

/// Explicit window Discard: the trusted caller label comes from Tauri.
#[tauri::command]
pub async fn delete_discarded_draft(
    window: WebviewWindow,
    document_id: String,
    expected_revision: String,
) -> Result<OwnedDeleteOutcome, DraftError> {
    delete_discarded_draft_logged(&document_id, window.label(), &expected_revision)
}

fn delete_discarded_draft_logged(
    document_id: &str,
    window_label: &str,
    expected_revision: &str,
) -> Result<OwnedDeleteOutcome, DraftError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "draft.discard".into(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: None,
        duration_ms: None,
        error: None,
    });
    let result = delete_draft_owned(document_id, window_label, expected_revision);
    logger::log_event(LogEntryPayload {
        level: if result.is_err() {
            LogLevel::Error
        } else {
            LogLevel::Info
        },
        event: "draft.discard".into(),
        status: if result.is_err() {
            LogStatus::Fail
        } else {
            LogStatus::Success
        },
        action_id: Some(action_id),
        context: result
            .as_ref()
            .ok()
            .map(|outcome| json!({ "outcome": outcome })),
        duration_ms: Some(start.elapsed().as_millis() as u64),
        error: result.as_ref().err().map(|error| error.kind().to_string()),
    });
    result
}

#[cfg(test)]
#[path = "draft_get_tests.rs"]
mod tests;
