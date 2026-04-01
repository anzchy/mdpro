use chrono::DateTime;
use std::fs;

use super::{drafts_dir, DraftBundle, DraftError, DraftMetadataEntry};

pub fn list_drafts() -> Result<Vec<DraftMetadataEntry>, DraftError> {
    let dir = drafts_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let items: Vec<_> = fs::read_dir(&dir)
        .map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?
        .collect::<Result<_, _>>()
        .map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;

    let mut entries = Vec::new();

    for item in &items {
        let path = item.path();
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        // Each draft is a single bundle file: {id}.draft.json
        let id = match file_name.strip_suffix(".draft.json") {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => continue,
        };

        // Skip unreadable or corrupt bundles silently.
        let contents = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let bundle: DraftBundle = match serde_json::from_str(&contents) {
            Ok(b) => b,
            Err(_) => continue,
        };

        if bundle.recovered {
            continue;
        }

        entries.push(DraftMetadataEntry {
            id,
            original_path: bundle.original_path,
            last_modified: bundle.last_modified,
            recovered: bundle.recovered,
            title: bundle.title,
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
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        let id = match file_name.strip_suffix(".draft.json") {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => continue,
        };

        let contents = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let bundle: DraftBundle = match serde_json::from_str(&contents) {
            Ok(b) => b,
            Err(_) => continue,
        };

        if !bundle.recovered {
            continue;
        }

        if let Ok(last_modified) = DateTime::parse_from_rfc3339(&bundle.last_modified) {
            if last_modified < threshold {
                // Best-effort: skip this draft on failure and continue with the rest.
                if super::delete_draft(&id).is_ok() {
                    deleted += 1;
                }
            }
        }
    }

    Ok(deleted)
}
