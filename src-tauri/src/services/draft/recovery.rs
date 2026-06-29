use chrono::Utc;
use std::fs;

use crate::models::DraftMetadata;

use super::{
    bundle_path, legacy_draft_path, legacy_meta_path, write_bundle_atomic, DraftBundle, DraftError,
    RecoverResult,
};

pub fn recover_draft(document_id: &str) -> Result<RecoverResult, DraftError> {
    let path = bundle_path(document_id)?;

    if path.exists() {
        return recover_from_bundle(document_id, &path);
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
    })
}

fn recover_from_bundle(
    document_id: &str,
    path: &std::path::Path,
) -> Result<RecoverResult, DraftError> {
    let raw = fs::read_to_string(path).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let mut bundle: DraftBundle =
        serde_json::from_str(&raw).map_err(|err| DraftError::ParseError {
            message: err.to_string(),
        })?;

    let content = bundle.content.clone();
    let original_path = bundle.original_path.clone();
    let title = bundle.title.clone();

    // Mark as recovered and write back atomically — same guarantee as save_draft.
    bundle.recovered = true;
    write_bundle_atomic(path, &bundle, document_id)?;

    Ok(RecoverResult {
        content,
        original_path,
        title,
    })
}
