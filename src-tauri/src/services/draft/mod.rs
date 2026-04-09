use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{Draft, DraftMetadata};

mod listing;
mod migration;
mod recovery;

pub use listing::{cleanup_old_drafts, list_drafts};
pub use migration::migrate_legacy_drafts;
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

/// Bundle file: `{document_id}.draft.json`
pub(super) fn bundle_path(document_id: &str) -> Result<PathBuf, DraftError> {
    validate_id(document_id)?;
    Ok(drafts_dir()?.join(format!("{document_id}.draft.json")))
}

/// Legacy content file (pre-bundle format): `{document_id}.draft.md`
pub(super) fn legacy_draft_path(document_id: &str) -> Result<PathBuf, DraftError> {
    validate_id(document_id)?;
    Ok(drafts_dir()?.join(format!("{document_id}.draft.md")))
}

/// Legacy metadata file (pre-bundle format): `{document_id}.meta.json`
pub(super) fn legacy_meta_path(document_id: &str) -> Result<PathBuf, DraftError> {
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

// ── Atomic write helper ───────────────────────────────────────────────────────

/// Serialize `bundle` and commit it to `dest` via a uniquely-named tmp + rename.
/// `tmp_prefix` names the tmp file — typically the document_id.
/// The nanosecond nonce ensures concurrent callers for the same document each
/// get their own distinct tmp path.
pub(super) fn write_bundle_atomic(
    dest: &Path,
    bundle: &DraftBundle,
    tmp_prefix: &str,
) -> Result<(), DraftError> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let dir = dest.parent().ok_or_else(|| DraftError::IoError {
        message: "bundle path has no parent directory".to_string(),
    })?;
    let tmp = dir.join(format!("{tmp_prefix}.{nonce}.tmp"));

    let payload = serde_json::to_string_pretty(bundle).map_err(|err| DraftError::ParseError {
        message: err.to_string(),
    })?;

    fs::write(&tmp, &payload).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    fs::rename(&tmp, dest).map_err(|err| {
        let _ = fs::remove_file(&tmp);
        DraftError::IoError {
            message: err.to_string(),
        }
    })
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
    let dest = bundle_path(document_id)?;

    let bundle = DraftBundle {
        content: content.to_string(),
        original_path,
        last_modified: now.to_rfc3339(),
        recovered: false,
        title: title.to_string(),
    };

    // Single atomic rename: content + metadata committed together.
    // On APFS (macOS) rename() is atomic — no partial-state window on disk.
    write_bundle_atomic(&dest, &bundle, document_id)?;

    Ok(DraftSaveResult {
        success: true,
        draft_path: dest.to_string_lossy().to_string(),
        saved_at: now.timestamp_millis(),
    })
}

pub fn load_draft(document_id: &str) -> Result<Option<Draft>, DraftError> {
    let path = bundle_path(document_id)?;

    if path.exists() {
        return load_bundle(document_id, &path);
    }

    // Backward-compat: read pre-bundle two-file format and migrate atomically.
    let legacy_draft = legacy_draft_path(document_id)?;
    if !legacy_draft.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&legacy_draft).map_err(|err| DraftError::IoError {
        message: err.to_string(),
    })?;

    let legacy_meta = legacy_meta_path(document_id)?;
    let (original_path, last_modified, recovered, title) = if legacy_meta.exists() {
        let raw = fs::read_to_string(&legacy_meta).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        let meta: DraftMetadata = serde_json::from_str(&raw).map_err(|err| {
            DraftError::ParseError {
                message: err.to_string(),
            }
        })?;
        (meta.original_path, meta.last_modified, meta.recovered, meta.title)
    } else {
        let mtime = fs::metadata(&legacy_draft)
            .and_then(|m| m.modified())
            .map(|t| DateTime::<Utc>::from(t).to_rfc3339())
            .unwrap_or_else(|_| Utc::now().to_rfc3339());
        (None, mtime, false, String::new())
    };

    // Migrate to bundle format — best-effort; read succeeds even if migration fails.
    let bundle = DraftBundle {
        content: content.clone(),
        original_path: original_path.clone(),
        last_modified: last_modified.clone(),
        recovered,
        title: title.clone(),
    };
    if write_bundle_atomic(&path, &bundle, document_id).is_ok() {
        let _ = fs::remove_file(&legacy_draft);
        let _ = fs::remove_file(&legacy_meta);
    }

    let last_modified_ms = DateTime::parse_from_rfc3339(&last_modified)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0);

    Ok(Some(Draft {
        id: document_id.to_string(),
        original_path: original_path.map(PathBuf::from),
        content,
        last_modified: last_modified_ms,
        recovered,
    }))
}

fn load_bundle(document_id: &str, path: &Path) -> Result<Option<Draft>, DraftError> {
    let contents = fs::read_to_string(path).map_err(|err| DraftError::IoError {
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
    let mut deleted = false;

    let path = bundle_path(document_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|err| DraftError::IoError {
            message: err.to_string(),
        })?;
        deleted = true;
    }

    // Also remove any legacy two-file drafts from pre-bundle builds.
    let legacy_draft = legacy_draft_path(document_id)?;
    let legacy_meta = legacy_meta_path(document_id)?;
    if legacy_draft.exists() {
        let _ = fs::remove_file(&legacy_draft);
        deleted = true;
    }
    if legacy_meta.exists() {
        let _ = fs::remove_file(&legacy_meta);
        deleted = true;
    }

    Ok(deleted)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // Use the crate-level HOME_LOCK so these tests cannot race on the
    // process-wide $HOME with commands::draft or services::draft::migration
    // tests that also redirect $HOME to a temp directory.
    use crate::HOME_LOCK;

    fn make_temp_home(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("mdpro_test").join(label);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    struct HomeRestorer(Option<String>);
    impl Drop for HomeRestorer {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => unsafe { std::env::set_var("HOME", v) },
                None => unsafe { std::env::remove_var("HOME") },
            }
        }
    }

    fn set_home(path: &Path) -> HomeRestorer {
        let prev = std::env::var("HOME").ok();
        unsafe { std::env::set_var("HOME", path.to_str().unwrap()) };
        HomeRestorer(prev)
    }

    // Regression test for issue #75:
    // close_document with discard_changes=true relies on delete_draft returning
    // Ok(true) and removing the bundle file. Before the fix, close_document
    // always returned draft_deleted: false and never called delete_draft, so
    // stale drafts were offered for recovery on next launch.
    //
    // Note: close_document cannot be tested at the command level here because
    // it requires tauri::State<'_, FileWatcher>, which needs a full AppHandle
    // to construct. The service-level test below pins the exact behaviour that
    // the fixed command path depends on.
    #[test]
    fn test_delete_draft_removes_file_and_returns_true() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("dd_exists");
        let _home_guard = set_home(&home);

        // dirs::data_dir() now resolves inside the temp home.
        let drafts = dirs::data_dir()
            .unwrap_or_else(|| home.clone())
            .join("mdpro")
            .join("drafts");
        fs::create_dir_all(&drafts).unwrap();

        let id = "test75_doc_exists";

        save_draft(id, "# hello", None, "Test Doc").expect("save_draft must succeed");

        let bundle = bundle_path(id).expect("bundle_path must resolve");
        assert!(bundle.exists(), "draft file must exist after save_draft");

        // This is the call that close_document with discard_changes=true makes.
        let result = delete_draft(id).expect("delete_draft must not error");
        assert!(result, "delete_draft must return true when draft existed");
        assert!(!bundle.exists(), "draft file must be gone after delete_draft");

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn test_delete_draft_returns_false_when_no_draft() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("dd_absent");
        let _home_guard = set_home(&home);

        let result = delete_draft("test75_no_such_doc")
            .expect("delete_draft must not error on missing draft");
        assert!(!result, "delete_draft must return false when draft was absent");

        let _ = fs::remove_dir_all(&home);
    }
}
