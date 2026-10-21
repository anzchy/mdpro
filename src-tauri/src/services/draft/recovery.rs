use std::fs;

use crate::models::DraftMetadata;

use super::{
    bundle_path, legacy_draft_path, legacy_meta_path, DraftClaimToken, DraftError, RecoverResult,
    RecoverTarget,
};

/// Read a legacy two-file draft without changing it. Only `guarded.rs` calls
/// this under the draft lock after its in-use check; that caller installs the
/// claimed bundle before removing the legacy pair (D299 fix round 1).
///
/// A bundle present here can only have been written in between by
/// `load_draft`'s unlocked migrate-on-read. It has not passed the bundle owner
/// check, so return `NotFound` without touching either representation.
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
        let meta: DraftMetadata =
            serde_json::from_str(&raw).map_err(|err| DraftError::ParseError {
                message: err.to_string(),
            })?;
        (meta.original_path, meta.title)
    } else {
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
