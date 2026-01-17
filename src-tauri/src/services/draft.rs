use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{Draft, DraftMetadata};

#[derive(Debug, Serialize, Deserialize)]
pub enum DraftError {
    IoError { message: String },
    NotFound { document_id: String },
    ParseError { message: String },
}

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

fn drafts_dir() -> Result<PathBuf, DraftError> {
    let home = std::env::var("HOME").map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;
    Ok(Path::new(&home).join(".mdpro").join("drafts"))
}

fn draft_path(document_id: &str) -> Result<PathBuf, DraftError> {
    Ok(drafts_dir()?.join(format!("{document_id}.draft.md")))
}

fn meta_path(document_id: &str) -> Result<PathBuf, DraftError> {
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

    if !draft_path.exists() || !meta_path.exists() {
        return Ok(None);
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

pub fn list_drafts() -> Result<Vec<DraftMetadataEntry>, DraftError> {
    let dir = drafts_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();

    for item in fs::read_dir(dir).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })? {
        let item = item.map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        let path = item.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        if !file_name.ends_with(".meta.json") {
            continue;
        }
        let id = file_name.replace(".meta.json", "");

        let contents = fs::read_to_string(&path).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        let metadata: DraftMetadata = serde_json::from_str(&contents).map_err(|err| {
            DraftError::ParseError {
                message: err.to_string(),
            }
        })?;

        if metadata.recovered {
            continue;
        }

        entries.push(DraftMetadataEntry {
            id,
            original_path: metadata.original_path,
            last_modified: metadata.last_modified,
            recovered: metadata.recovered,
            title: metadata.title,
        });
    }

    Ok(entries)
}

pub fn recover_draft(document_id: &str) -> Result<RecoverResult, DraftError> {
    let draft_path = draft_path(document_id)?;
    let meta_path = meta_path(document_id)?;

    if !draft_path.exists() || !meta_path.exists() {
        return Err(DraftError::NotFound {
            document_id: document_id.to_string(),
        });
    }

    let content = fs::read_to_string(&draft_path).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let meta_contents = fs::read_to_string(&meta_path).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let mut metadata: DraftMetadata = serde_json::from_str(&meta_contents).map_err(|err| {
        DraftError::ParseError {
            message: err.to_string(),
        }
    })?;

    metadata.recovered = true;
    let payload = serde_json::to_string_pretty(&metadata).map_err(|err| DraftError::ParseError {
        message: err.to_string(),
    })?;
    fs::write(&meta_path, payload).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    Ok(RecoverResult {
        content,
        original_path: metadata.original_path,
        title: metadata.title,
    })
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

pub fn cleanup_old_drafts() -> Result<usize, DraftError> {
    let dir = drafts_dir()?;
    if !dir.exists() {
        return Ok(0);
    }

    let mut deleted = 0;
    let threshold = Utc::now() - Duration::days(7);

    for item in fs::read_dir(dir).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })? {
        let item = item.map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        let path = item.path();
        let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        if !file_name.ends_with(".meta.json") {
            continue;
        }
        let id = file_name.replace(".meta.json", "");

        let contents = fs::read_to_string(&path).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        let metadata: DraftMetadata = serde_json::from_str(&contents).map_err(|err| {
            DraftError::ParseError {
                message: err.to_string(),
            }
        })?;

        if !metadata.recovered {
            continue;
        }

        if let Ok(last_modified) = DateTime::parse_from_rfc3339(&metadata.last_modified) {
            if last_modified < threshold {
                let _ = delete_draft(&id)?;
                deleted += 1;
            }
        }
    }

    Ok(deleted)
}
