//! Draft path helpers: the drafts directory, id validation, and the bundle
//! and legacy file names. Split out of `mod.rs` (D27 WI-1), behaviour unchanged.
use std::fs;
use std::path::{Path, PathBuf};

use super::DraftError;

pub(crate) fn drafts_dir() -> Result<PathBuf, DraftError> {
    let data = dirs::data_dir().ok_or_else(|| DraftError::IoError {
        message: "could not determine data directory".to_string(),
    })?;
    Ok(data.join("mdpro").join("drafts"))
}

fn validate_id(id: &str) -> Result<(), DraftError> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(DraftError::IoError {
            message: format!("invalid document id: {id:?}"),
        });
    }
    Ok(())
}

/// Whether `document_id` is one this module will build a path for.
///
/// The quit guard needs the same answer *before* it starts deleting, so one bad
/// id in a discard list refuses the whole list instead of half-applying it.
pub(crate) fn is_valid_draft_id(document_id: &str) -> bool {
    validate_id(document_id).is_ok()
}

/// Bundle file: `{document_id}.draft.json`
pub(crate) fn bundle_path(document_id: &str) -> Result<PathBuf, DraftError> {
    validate_id(document_id)?;
    Ok(drafts_dir()?.join(format!("{document_id}.draft.json")))
}

/// Legacy content file (pre-bundle format): `{document_id}.draft.md`
pub(crate) fn legacy_draft_path(document_id: &str) -> Result<PathBuf, DraftError> {
    validate_id(document_id)?;
    Ok(drafts_dir()?.join(format!("{document_id}.draft.md")))
}

/// Legacy metadata file (pre-bundle format): `{document_id}.meta.json`
pub(crate) fn legacy_meta_path(document_id: &str) -> Result<PathBuf, DraftError> {
    validate_id(document_id)?;
    Ok(drafts_dir()?.join(format!("{document_id}.meta.json")))
}

pub(crate) fn ensure_dir(path: &Path) -> Result<(), DraftError> {
    if !path.exists() {
        fs::create_dir_all(path).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
    }
    Ok(())
}
