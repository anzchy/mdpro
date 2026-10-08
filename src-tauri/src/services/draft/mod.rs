//! Purpose: crash-recovery drafts, one JSON bundle per document id under
//! `<data_dir>/mdpro/drafts/`.
//!
//! Key decisions:
//! - A bundle is written by tmp + rename, so content and metadata commit
//!   together. Pre-bundle two-file drafts are still read and migrated.
//! - A bundle may record its `owner` (session id + window label, ADR-0038).
//!   The key is omitted when absent, and bundles without it still load.
//! - `owner.rs` holds the pure "in use" rule, `types.rs` the public types,
//!   `paths.rs` the directory and file-name helpers.
//! - `lock::draft_lock()` (ADR-0038 §4) is held by `save_draft_as`, guarded
//!   recover/discard and cleanup; their `*_with` forms build the `LiveContext`
//!   under it. Lock-free writers: `delete_draft` (deliberate), `load_draft`'s
//!   legacy migrate-on-read, and startup `migrate_legacy_drafts` (no windows),
//!   which `main` reaches through `startup_migration.rs`'s logged wrapper.
//! - `live_listing.rs` is the only listing/cleanup; it hides or keeps drafts in use.
//!
//! @coordinates-with docs/adr/0038-a-draft-in-use-by-a-live-window-is-not-offered-for-recovery.md
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{Draft, DraftMetadata};

mod guarded;
mod live_listing;
mod lock;
mod migration;
pub mod owner;
mod paths;
mod recovery;
mod startup_migration;
mod types;
mod visibility;

pub use guarded::{discard_draft_guarded_with, recover_draft_guarded_with};
pub use live_listing::{cleanup_old_drafts_for_with, list_drafts_for};
// The `&LiveContext` forms are test-only: a caller-built context is the
// snapshot-before-lock pattern the `*_with` forms exist to close.
#[cfg(test)]
pub(crate) use guarded::{discard_draft_guarded, recover_draft_guarded};
#[cfg(test)]
pub(crate) use live_listing::cleanup_old_drafts_for;
pub use migration::migrate_legacy_drafts;
pub use startup_migration::migrate_legacy_drafts_logged;
pub use visibility::visible;

#[cfg(test)]
pub(crate) use lock::{draft_lock, draft_lock_is_held};
pub use owner::{
    in_use, owner_is_live, session_id, InUseReason, LiveContext, OpenSet, ShadowUnavailable,
};
pub(crate) use paths::is_valid_draft_id;
// `drafts_dir` and (tests only) `legacy_drafts_dir` are crate-visible so the
// run-isolation test (ADR-0047 WI-002 WI-8) resolves them under a temp HOME.
#[cfg(test)]
pub(crate) use migration::legacy_drafts_dir;
pub(crate) use paths::drafts_dir;
use paths::{bundle_path, ensure_dir, legacy_draft_path, legacy_meta_path};
pub use types::{
    CleanupCounts, DraftError, DraftListCounts, DraftListing, DraftMetadataEntry, DraftOwner,
    DraftSaveResult, RecoverResult,
};

// ── Internal bundle ───────────────────────────────────────────────────────────

/// On-disk representation: content + metadata in a single JSON file.
/// One atomic rename commits both, eliminating the two-file inconsistency window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DraftBundle {
    /// Absent in bundles written before ADR-0038, and never written as null.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<DraftOwner>,
    pub content: String,
    pub original_path: Option<String>,
    pub last_modified: String,
    pub recovered: bool,
    pub title: String,
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

/// Write the bundle with no owner. Kept with its original signature for the
/// callers that predate ADR-0038; see [`save_draft_as`].
pub fn save_draft(
    document_id: &str,
    content: &str,
    original_path: Option<String>,
    title: &str,
) -> Result<DraftSaveResult, DraftError> {
    save_draft_as(None, document_id, content, original_path, title)
}

/// Write the bundle, stamping `owner` (ADR-0038 §1), under the draft lock.
/// A full overwrite: `owner: None` leaves no owner, whatever the previous
/// bundle held, and `recovered` is reset to false.
pub fn save_draft_as(
    owner: Option<DraftOwner>,
    document_id: &str,
    content: &str,
    original_path: Option<String>,
    title: &str,
) -> Result<DraftSaveResult, DraftError> {
    let dir = drafts_dir()?;
    ensure_dir(&dir)?;

    // Serialises with guarded recover/discard/cleanup (ADR-0038 §4).
    let _draft_lock = lock::draft_lock();
    let now = Utc::now();
    let dest = bundle_path(document_id)?;

    let bundle = DraftBundle {
        owner,
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
        let meta: DraftMetadata =
            serde_json::from_str(&raw).map_err(|err| DraftError::ParseError {
                message: err.to_string(),
            })?;
        (
            meta.original_path,
            meta.last_modified,
            meta.recovered,
            meta.title,
        )
    } else {
        let mtime = fs::metadata(&legacy_draft)
            .and_then(|m| m.modified())
            .map(|t| DateTime::<Utc>::from(t).to_rfc3339())
            .unwrap_or_else(|_| Utc::now().to_rfc3339());
        (None, mtime, false, String::new())
    };

    // Migrate to bundle format — best-effort; read succeeds even if migration fails.
    let bundle = DraftBundle {
        owner: None,
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

    let bundle: DraftBundle =
        serde_json::from_str(&contents).map_err(|err| DraftError::ParseError {
            message: err.to_string(),
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

#[cfg(test)]
#[path = "bundle_compat_tests.rs"]
mod bundle_compat_tests;
#[cfg(test)]
#[path = "draft_store_tests.rs"]
mod draft_store_tests;
#[cfg(test)]
#[path = "draft_test_home.rs"]
mod draft_test_home;
// The open_route symlink fixture and store builders, shared by the WI-2 tests.
#[cfg(all(test, unix))]
#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../open_route/lookup_fixture.rs"]
mod draft_fixture;
