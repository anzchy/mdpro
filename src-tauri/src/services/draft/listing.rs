use chrono::{DateTime, Utc};
use std::fs;

use super::{drafts_dir, DraftError, DraftMetadata, DraftMetadataEntry};

pub fn list_drafts() -> Result<Vec<DraftMetadataEntry>, DraftError> {
    let dir = drafts_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    // First pass: drafts with full metadata (the normal case).
    let items: Vec<_> = fs::read_dir(&dir)
        .map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?
        .collect::<Result<_, _>>()
        .map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;

    for item in &items {
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

        // Always record the id so the second pass skips drafts that have metadata,
        // even if those drafts have already been recovered.
        seen_ids.insert(id.clone());

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

    // Second pass: surface orphan content files (partial write left .draft.md without .meta.json).
    for item in &items {
        let path = item.path();
        let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        if !file_name.ends_with(".draft.md") {
            continue;
        }
        let id = file_name.replace(".draft.md", "");
        if seen_ids.contains(&id) {
            continue;
        }
        let last_modified = fs::metadata(&path)
            .and_then(|m| m.modified())
            .map(|t| DateTime::<Utc>::from(t).to_rfc3339())
            .unwrap_or_default();
        entries.push(DraftMetadataEntry {
            id,
            original_path: None,
            last_modified,
            recovered: false,
            title: "(metadata missing)".to_string(),
        });
    }

    Ok(entries)
}

/// Scan the drafts directory and delete all drafts marked as recovered that are
/// older than 7 days. Returns the number of drafts deleted.
pub fn cleanup_old_drafts() -> Result<usize, DraftError> {
    use chrono::{Duration, Utc};

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
                let _ = super::delete_draft(&id)?;
                deleted += 1;
            }
        }
    }

    Ok(deleted)
}
