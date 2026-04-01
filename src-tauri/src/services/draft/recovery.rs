use std::fs;

use super::{bundle_path, DraftBundle, DraftError, RecoverResult};

pub fn recover_draft(document_id: &str) -> Result<RecoverResult, DraftError> {
    let path = bundle_path(document_id)?;

    if !path.exists() {
        return Err(DraftError::NotFound {
            document_id: document_id.to_string(),
        });
    }

    let raw = fs::read_to_string(&path).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let mut bundle: DraftBundle = serde_json::from_str(&raw).map_err(|err| {
        DraftError::ParseError {
            message: err.to_string(),
        }
    })?;

    // Mark as recovered and write back so the draft no longer appears in
    // future list_drafts() calls.
    bundle.recovered = true;
    let updated = serde_json::to_string_pretty(&bundle).map_err(|err| {
        DraftError::ParseError {
            message: err.to_string(),
        }
    })?;
    fs::write(&path, updated).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    Ok(RecoverResult {
        content: bundle.content,
        original_path: bundle.original_path,
        title: bundle.title,
    })
}
