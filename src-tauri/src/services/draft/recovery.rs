use chrono::Utc;
use std::fs;

use crate::models::DraftMetadata;

use super::{
    bundle_path, legacy_draft_path, legacy_meta_path, DraftClaimToken, DraftError, RecoverResult,
    RecoverTarget,
};

/// Mark a legacy two-file draft recovered and return it, with no in-use
/// check. Only `guarded.rs` calls this, under the draft lock, after it found
/// no bundle and ran its own open-set check on the legacy pair.
///
/// A bundle present here can only have been written in between by
/// `load_draft`'s unlocked migrate-on-read. It is not recovered: stamping it
/// `recovered` with no owner and its old `lastModified` would make it eligible
/// for 7-day cleanup (ADR-0038 §5), and it never passed the bundle owner
/// check. The answer is `NotFound`, which drops the dialog row; a retry takes
/// the guarded bundle path.
pub(super) fn recover_draft(
    document_id: &str,
    target: Option<RecoverTarget>,
    claim_token: DraftClaimToken,
) -> Result<RecoverResult, DraftError> {
    if bundle_path(document_id)?.exists() {
        return Err(DraftError::NotFound {
            document_id: document_id.to_string(),
        });
    }

    // Backward-compat: recover from pre-bundle two-file format.
    let legacy_draft = legacy_draft_path(document_id)?;
    if !legacy_draft.exists() {
        return Err(DraftError::NotFound {
            document_id: document_id.to_string(),
        });
    }

    let content = fs::read_to_string(&legacy_draft).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let legacy_meta = legacy_meta_path(document_id)?;
    let (original_path, title) = if legacy_meta.exists() {
        let raw = fs::read_to_string(&legacy_meta).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        let mut meta: DraftMetadata =
            serde_json::from_str(&raw).map_err(|err| DraftError::ParseError {
                message: err.to_string(),
            })?;
        meta.recovered = true;
        let updated =
            serde_json::to_string_pretty(&meta).map_err(|err| DraftError::ParseError {
                message: err.to_string(),
            })?;
        fs::write(&legacy_meta, updated).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        (meta.original_path, meta.title)
    } else {
        // No metadata — synthesize a recovered marker so the draft no longer appears.
        let fallback = DraftMetadata {
            original_path: None,
            last_modified: Utc::now().to_rfc3339(),
            recovered: true,
            title: String::new(),
        };
        let payload =
            serde_json::to_string_pretty(&fallback).map_err(|err| DraftError::ParseError {
                message: err.to_string(),
            })?;
        fs::write(&legacy_meta, payload).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        (None, String::new())
    };

    Ok(RecoverResult {
        content,
        original_path,
        title,
        hold_gen: 0,
        target,
        claim_token,
    })
}

#[cfg(test)]
#[path = "recovery_race_tests.rs"]
mod recovery_race_tests;
