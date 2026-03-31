use chrono::Utc;
use std::fs;

use super::{draft_path, meta_path, DraftError, DraftMetadata, RecoverResult};

pub fn recover_draft(document_id: &str) -> Result<RecoverResult, DraftError> {
    let draft_path = draft_path(document_id)?;
    let meta_path = meta_path(document_id)?;

    if !draft_path.exists() {
        return Err(DraftError::NotFound {
            document_id: document_id.to_string(),
        });
    }

    let content = fs::read_to_string(&draft_path).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let (original_path, title) = if meta_path.exists() {
        // Normal path: metadata present — read, mark recovered, write back.
        let meta_contents = fs::read_to_string(&meta_path).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        let mut metadata: DraftMetadata = serde_json::from_str(&meta_contents).map_err(|err| {
            DraftError::ParseError {
                message: err.to_string(),
            }
        })?;
        metadata.recovered = true;
        let payload = serde_json::to_string_pretty(&metadata).map_err(|err| {
            DraftError::ParseError {
                message: err.to_string(),
            }
        })?;
        fs::write(&meta_path, payload).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        (metadata.original_path, metadata.title)
    } else {
        // Orphan path: metadata missing — synthesise a recovered marker so the
        // draft no longer appears in future list_drafts() calls.
        let fallback = DraftMetadata {
            original_path: None,
            last_modified: Utc::now().to_rfc3339(),
            recovered: true,
            title: String::new(),
        };
        let payload = serde_json::to_string_pretty(&fallback).map_err(|err| {
            DraftError::ParseError {
                message: err.to_string(),
            }
        })?;
        fs::write(&meta_path, payload).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        (None, String::new())
    };

    Ok(RecoverResult {
        content,
        original_path,
        title,
    })
}
