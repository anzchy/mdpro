use chrono::DateTime;
use std::collections::HashSet;
use std::fs;

use crate::models::DraftMetadata;

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
    let mut bundle_ids: HashSet<String> = HashSet::new();

    // Pass 1: bundle-format drafts ({id}.draft.json).
    for item in &items {
        let path = item.path();
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        let id = match file_name.strip_suffix(".draft.json") {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => continue,
        };

        bundle_ids.insert(id.clone());

        let contents = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => {
                // Unreadable bundle — surface as a degraded entry so the user can delete it.
                let last_modified = file_mtime(&path);
                entries.push(DraftMetadataEntry {
                    id,
                    original_path: None,
                    last_modified,
                    recovered: false,
                    title: "(corrupted)".to_string(),
                });
                continue;
            }
        };

        let bundle: DraftBundle = match serde_json::from_str(&contents) {
            Ok(b) => b,
            Err(_) => {
                // Corrupt JSON — surface as degraded rather than silently drop.
                let last_modified = file_mtime(&path);
                entries.push(DraftMetadataEntry {
                    id,
                    original_path: None,
                    last_modified,
                    recovered: false,
                    title: "(corrupted)".to_string(),
                });
                continue;
            }
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

    // Pass 2: legacy two-file drafts without a corresponding bundle.
    // These exist on installs that haven't yet loaded (and thus migrated) each draft.
    for item in &items {
        let path = item.path();
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        let id = match file_name.strip_suffix(".draft.md") {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => continue,
        };

        if bundle_ids.contains(&id) {
            continue; // already covered by Pass 1
        }

        // Read metadata from the accompanying .meta.json if present.
        let meta_path = dir.join(format!("{id}.meta.json"));
        let (original_path, last_modified, recovered, title) = if meta_path.exists() {
            match fs::read_to_string(&meta_path)
                .ok()
                .and_then(|s| serde_json::from_str::<DraftMetadata>(&s).ok())
            {
                Some(meta) => (
                    meta.original_path,
                    meta.last_modified,
                    meta.recovered,
                    meta.title,
                ),
                None => (None, file_mtime(&path), false, "(metadata corrupt)".to_string()),
            }
        } else {
            (None, file_mtime(&path), false, "(metadata missing)".to_string())
        };

        if recovered {
            continue;
        }

        entries.push(DraftMetadataEntry {
            id,
            original_path,
            last_modified,
            recovered,
            title,
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
                // Best-effort: skip on failure and continue with the rest.
                if super::delete_draft(&id).is_ok() {
                    deleted += 1;
                }
            }
        }
    }

    Ok(deleted)
}

fn file_mtime(path: &std::path::Path) -> String {
    use chrono::Utc;
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| DateTime::<Utc>::from(t).to_rfc3339())
        .unwrap_or_default()
}
