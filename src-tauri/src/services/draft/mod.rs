use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::Draft;

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

// ── Internal bundle ───────────────────────────────────────────────────────────

/// On-disk representation: content + metadata in a single JSON file.
/// One atomic rename commits both, eliminating the two-file inconsistency window.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DraftBundle {
    pub content: String,
    pub original_path: Option<String>,
    pub last_modified: String,
    pub recovered: bool,
    pub title: String,
}

// ── Path helpers ──────────────────────────────────────────────────────────────

pub(super) fn drafts_dir() -> Result<PathBuf, DraftError> {
    let home = dirs::home_dir().ok_or_else(|| DraftError::IoError {
        message: "could not determine home directory".to_string(),
    })?;
    Ok(home.join(".mdpro").join("drafts"))
}

fn validate_id(id: &str) -> Result<(), DraftError> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(DraftError::IoError {
            message: format!("invalid document id: {id:?}"),
        });
    }
    Ok(())
}

/// Single bundle file: `{document_id}.draft.json`.
/// Replaces the old two-file layout (`.draft.md` + `.meta.json`).
pub(super) fn bundle_path(document_id: &str) -> Result<PathBuf, DraftError> {
    validate_id(document_id)?;
    Ok(drafts_dir()?.join(format!("{document_id}.draft.json")))
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

    let now = Utc::now();
    // Per-invocation nonce: concurrent saves for the same document write to
    // distinct tmp paths, preventing one call from corrupting another's temp file.
    let nonce = now.timestamp_millis();
    let tmp_path = dir.join(format!("{document_id}.{nonce}.tmp"));
    let bundle_path = bundle_path(document_id)?;

    let bundle = DraftBundle {
        content: content.to_string(),
        original_path,
        last_modified: now.to_rfc3339(),
        recovered: false,
        title: title.to_string(),
    };

    let payload = serde_json::to_string_pretty(&bundle).map_err(|err| DraftError::ParseError {
        message: err.to_string(),
    })?;

    // Write content + metadata into one tmp file, then a single atomic rename.
    // On APFS (macOS) rename() is atomic — there is no window where content
    // and metadata can be inconsistent on disk.
    fs::write(&tmp_path, &payload).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    fs::rename(&tmp_path, &bundle_path).map_err(|err| {
        let _ = fs::remove_file(&tmp_path);
        DraftError::IoError {
            message: err.to_string(),
        }
    })?;

    Ok(DraftSaveResult {
        success: true,
        draft_path: bundle_path.to_string_lossy().to_string(),
        saved_at: now.timestamp_millis(),
    })
}

pub fn load_draft(document_id: &str) -> Result<Option<Draft>, DraftError> {
    let bundle_path = bundle_path(document_id)?;

    if !bundle_path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&bundle_path).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let bundle: DraftBundle = serde_json::from_str(&contents).map_err(|err| {
        DraftError::ParseError {
            message: err.to_string(),
        }
    })?;

    let last_modified = DateTime::parse_from_rfc3339(&bundle.last_modified)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0);

    Ok(Some(Draft {
        id: document_id.to_string(),
        original_path: bundle.original_path.map(PathBuf::from),
        content: bundle.content,
        last_modified,
        recovered: bundle.recovered,
    }))
}

pub fn delete_draft(document_id: &str) -> Result<bool, DraftError> {
    let bundle_path = bundle_path(document_id)?;

    if bundle_path.exists() {
        fs::remove_file(&bundle_path).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        Ok(true)
    } else {
        Ok(false)
    }
}
