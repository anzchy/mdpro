use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{Draft, DraftMetadata};

mod listing;
mod recovery;

pub use listing::{cleanup_old_drafts, list_drafts};
pub use recovery::recover_draft;

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub enum DraftError {
    IoError { message: String },
    NotFound { document_id: String },
    ParseError { message: String },
}

impl std::fmt::Display for DraftError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DraftError::IoError { message } => write!(f, "io error: {message}"),
            DraftError::NotFound { document_id } => {
                write!(f, "draft not found: {document_id}")
            }
            DraftError::ParseError { message } => write!(f, "parse error: {message}"),
        }
    }
}

impl std::error::Error for DraftError {}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSaveResult {
    pub success: bool,
    pub draft_path: String,
    pub saved_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftMetadataEntry {
    pub id: String,
    pub original_path: Option<String>,
    pub last_modified: String,
    pub recovered: bool,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverResult {
    pub content: String,
    pub original_path: Option<String>,
    pub title: String,
}

// ── Path helpers ──────────────────────────────────────────────────────────────

pub(super) fn drafts_dir() -> Result<PathBuf, DraftError> {
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

pub(super) fn draft_path(document_id: &str) -> Result<PathBuf, DraftError> {
    validate_id(document_id)?;
    Ok(drafts_dir()?.join(format!("{document_id}.draft.md")))
}

pub(super) fn meta_path(document_id: &str) -> Result<PathBuf, DraftError> {
    validate_id(document_id)?;
    Ok(drafts_dir()?.join(format!("{document_id}.meta.json")))
}

fn ensure_dir(path: &Path) -> Result<(), DraftError> {
    if !path.exists() {
        fs::create_dir_all(path).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
    }
    Ok(())
}

// ── Core storage operations ───────────────────────────────────────────────────

pub fn save_draft(
    document_id: &str,
    content: &str,
    original_path: Option<String>,
    title: &str,
) -> Result<DraftSaveResult, DraftError> {
    let dir = drafts_dir()?;
    ensure_dir(&dir)?;

    let draft_path = draft_path(document_id)?;
    let meta_path = meta_path(document_id)?;

    fs::write(&draft_path, content).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let metadata = DraftMetadata {
        original_path,
        last_modified: Utc::now().to_rfc3339(),
        recovered: false,
        title: title.to_string(),
    };

    let payload = serde_json::to_string_pretty(&metadata).map_err(|err| DraftError::ParseError {
        message: err.to_string(),
    })?;

    fs::write(&meta_path, payload).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    Ok(DraftSaveResult {
        success: true,
        draft_path: draft_path.to_string_lossy().to_string(),
        saved_at: Utc::now().timestamp_millis(),
    })
}

pub fn load_draft(document_id: &str) -> Result<Option<Draft>, DraftError> {
    let draft_path = draft_path(document_id)?;
    let meta_path = meta_path(document_id)?;

    match (draft_path.exists(), meta_path.exists()) {
        (false, false) => return Ok(None),
        (true, false) => {
            return Err(DraftError::IoError {
                message: format!(
                    "partial draft state for '{document_id}': content file exists but metadata is missing"
                ),
            })
        }
        (false, true) => {
            return Err(DraftError::IoError {
                message: format!(
                    "partial draft state for '{document_id}': metadata exists but content file is missing"
                ),
            })
        }
        (true, true) => {}
    }

    let content = fs::read_to_string(&draft_path).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let meta_contents = fs::read_to_string(&meta_path).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let metadata: DraftMetadata = serde_json::from_str(&meta_contents).map_err(|err| {
        DraftError::ParseError {
            message: err.to_string(),
        }
    })?;

    let last_modified = DateTime::parse_from_rfc3339(&metadata.last_modified)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0);

    Ok(Some(Draft {
        id: document_id.to_string(),
        original_path: metadata.original_path.map(PathBuf::from),
        content,
        last_modified,
        recovered: metadata.recovered,
    }))
}

pub fn delete_draft(document_id: &str) -> Result<bool, DraftError> {
    let draft_path = draft_path(document_id)?;
    let meta_path = meta_path(document_id)?;

    let mut deleted = false;
    if draft_path.exists() {
        fs::remove_file(draft_path).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        deleted = true;
    }
    if meta_path.exists() {
        fs::remove_file(meta_path).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        deleted = true;
    }

    Ok(deleted)
}
