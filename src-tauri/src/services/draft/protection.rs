//! ADR-0127 Own/Protected preservation and conditional claim deletion.
//! Caller order: DraftGate, then DRAFT_LOCK; held-lock callers use delete_draft_locked.
use super::*;
use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use std::sync::MutexGuard;

/// Preserve a previous-session, foreign-window, or unconsumed-claim bundle
/// before an ordinary write/delete.
/// Caller holds DRAFT_LOCK. The source remains intact if writing the moved copy fails.
pub(super) fn preserve_if_protected_locked(
    document_id: &str,
    token: Option<&DraftClaimToken>,
    incoming_owner: Option<&DraftOwner>,
) -> Result<bool, DraftError> {
    let path = bundle_path(document_id)?;
    if !path.exists() {
        return Ok(false);
    }
    let raw = fs::read_to_string(&path).map_err(|e| DraftError::IoError {
        message: e.to_string(),
    })?;
    let bundle: DraftBundle = serde_json::from_str(&raw).map_err(|e| DraftError::ParseError {
        message: e.to_string(),
    })?;
    if token.is_some_and(|t| t.source_id == document_id && bundle.claim.as_ref() == Some(t)) {
        return Ok(false);
    }
    // A late same-id placement must preserve a newer Own bundle before writing.
    let stale_same_id = token.is_some_and(|t| t.source_id == document_id);
    let own = bundle.owner.as_ref().is_some_and(|o| {
        o.session_id == session_id() && incoming_owner.is_none_or(|incoming| incoming == o)
    }) && bundle.claim.is_none()
        && !stale_same_id;
    if own {
        return Ok(false);
    }
    let moved_id = uuid::Uuid::new_v4().to_string();
    let moved_path = bundle_path(&moved_id)?;
    let mut moved = bundle;
    moved.owner = None;
    moved.claim = None;
    moved.claim_consumed = false;
    moved.recovered = false;
    write_bundle_atomic(&moved_path, &moved, &moved_id)?;
    fs::remove_file(&path).map_err(|e| DraftError::IoError {
        message: e.to_string(),
    })?;
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.draft.protected_move".into(),
        status: LogStatus::Success,
        action_id: Some(uuid::Uuid::new_v4().to_string()),
        context: Some(serde_json::json!({ "sourceId": document_id, "movedId": moved_id })),
        duration_ms: None,
        error: None,
    });
    Ok(true)
}

/// Convert a legacy pair to a fresh listable bundle before any ordinary mutation.
/// Guarded Discard intentionally bypasses this helper.
pub(super) fn preserve_legacy_if_present_locked(document_id: &str) -> Result<bool, DraftError> {
    let md = legacy_draft_path(document_id)?;
    if !md.exists() {
        return Ok(false);
    }
    let meta_path = legacy_meta_path(document_id)?;
    let content = fs::read_to_string(&md).map_err(|e| DraftError::IoError {
        message: e.to_string(),
    })?;
    let metadata = if meta_path.exists() {
        let raw = fs::read_to_string(&meta_path).map_err(|e| DraftError::IoError {
            message: e.to_string(),
        })?;
        serde_json::from_str::<DraftMetadata>(&raw).map_err(|e| DraftError::ParseError {
            message: e.to_string(),
        })?
    } else {
        let last_modified = fs::metadata(&md)
            .and_then(|m| m.modified())
            .map(|time| DateTime::<Utc>::from(time).to_rfc3339())
            .unwrap_or_else(|_| Utc::now().to_rfc3339());
        DraftMetadata {
            original_path: None,
            last_modified,
            recovered: false,
            title: String::new(),
        }
    };
    let moved_id = uuid::Uuid::new_v4().to_string();
    let moved = DraftBundle {
        owner: None,
        claim: None,
        claim_consumed: false,
        content,
        original_path: metadata.original_path,
        last_modified: metadata.last_modified,
        recovered: false,
        title: metadata.title,
    };
    write_bundle_atomic(&bundle_path(&moved_id)?, &moved, &moved_id)?;
    fs::remove_file(&md).map_err(|e| DraftError::IoError {
        message: e.to_string(),
    })?;
    if meta_path.exists() {
        fs::remove_file(&meta_path).map_err(|e| DraftError::IoError {
            message: e.to_string(),
        })?;
    }
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.draft.protected_move".into(),
        status: LogStatus::Success,
        action_id: Some(uuid::Uuid::new_v4().to_string()),
        context: Some(serde_json::json!({ "sourceId": document_id, "movedId": moved_id })),
        duration_ms: None,
        error: None,
    });
    Ok(true)
}

pub(super) fn validate_claim_token(token: &DraftClaimToken) -> Result<(), DraftError> {
    if token.session_id != session_id()
        || !is_valid_draft_id(&token.source_id)
        || token.nonce.is_empty()
    {
        return Err(DraftError::IoError {
            message: "invalid recovery claim".into(),
        });
    }
    Ok(())
}

pub fn delete_draft(document_id: &str) -> Result<bool, DraftError> {
    delete_draft_with_token(document_id, None)
}

/// Delete only an unclaimed draft currently owned by this session and window.
/// Foreign-window and old-session bundles, including unmerged Recovery drafts,
/// remain byte-for-byte intact.
/// The ownership read and removal share DRAFT_LOCK, including while another
/// window writes the same ID.
pub fn delete_draft_owned(document_id: &str, window_label: &str) -> Result<bool, DraftError> {
    delete_draft_owned_inner(document_id, window_label, lock::draft_lock, || {})
}

#[cfg(test)]
pub(super) fn delete_draft_owned_with_read_hook(
    document_id: &str,
    window_label: &str,
    acquire_lock: impl FnOnce() -> MutexGuard<'static, ()>,
    before_read: impl FnOnce(),
) -> Result<bool, DraftError> {
    delete_draft_owned_inner(document_id, window_label, acquire_lock, before_read)
}

fn delete_draft_owned_inner(
    document_id: &str,
    window_label: &str,
    acquire_lock: impl FnOnce() -> MutexGuard<'static, ()>,
    before_read: impl FnOnce(),
) -> Result<bool, DraftError> {
    let held = acquire_lock();
    let path = bundle_path(document_id)?;
    if !path.exists() {
        return Ok(false);
    }
    before_read();
    let raw = read_owned_bundle_locked(&path, &held)?;
    let bundle: DraftBundle = serde_json::from_str(&raw).map_err(|e| DraftError::ParseError {
        message: e.to_string(),
    })?;
    let owned = bundle.owner.as_ref().is_some_and(|owner| {
        owner.session_id == session_id() && owner.window_label == window_label
    });
    if !owned || bundle.claim.is_some() {
        return Ok(false);
    }
    fs::remove_file(path).map_err(|e| DraftError::IoError {
        message: e.to_string(),
    })?;
    Ok(true)
}

fn read_owned_bundle_locked(
    path: &std::path::Path,
    _held: &MutexGuard<'static, ()>,
) -> Result<String, DraftError> {
    let raw = fs::read_to_string(&path).map_err(|e| DraftError::IoError {
        message: e.to_string(),
    })?;
    Ok(raw)
}

pub fn delete_draft_with_token(
    document_id: &str,
    token: Option<&DraftClaimToken>,
) -> Result<bool, DraftError> {
    if let Some(token) = token {
        validate_claim_token(token)?;
    }
    let _held = lock::draft_lock();
    delete_draft_locked(document_id, token, false)
}

/// Internal delete for guarded Discard and age cleanup, which already hold DRAFT_LOCK.
pub(super) fn delete_draft_locked(
    document_id: &str,
    token: Option<&DraftClaimToken>,
    explicit_discard: bool,
) -> Result<bool, DraftError> {
    let mut deleted = false;

    let path = bundle_path(document_id)?;
    if let Some(token) = token {
        if !path.exists() {
            return Ok(false);
        }
        let raw = fs::read_to_string(&path).map_err(|e| DraftError::IoError {
            message: e.to_string(),
        })?;
        let bundle: DraftBundle =
            serde_json::from_str(&raw).map_err(|e| DraftError::ParseError {
                message: e.to_string(),
            })?;
        if bundle.claim.as_ref() != Some(token)
            || token.source_id != document_id
            || !bundle.claim_consumed
        {
            return Ok(false);
        }
    } else if !explicit_discard {
        deleted = preserve_if_protected_locked(document_id, None, None)?;
        deleted |= preserve_legacy_if_present_locked(document_id)?;
    }
    if path.exists() {
        fs::remove_file(&path).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        deleted = true;
    }

    // Also remove any legacy two-file drafts from pre-bundle builds.
    let legacy_draft = legacy_draft_path(document_id)?;
    let legacy_meta = legacy_meta_path(document_id)?;
    if legacy_draft.exists() {
        let _ = fs::remove_file(&legacy_draft);
        deleted = true;
    }
    if legacy_meta.exists() {
        let _ = fs::remove_file(&legacy_meta);
        deleted = true;
    }

    Ok(deleted)
}
