//! Purpose: listing and cleanup against a `LiveContext` (ADR-0038 §3, §5).
//!
//! Key decisions:
//! - **Listing hides drafts in use** and relists a recovered draft whose owner
//!   is dead (`visibility::visible`). Corrupt bundles are always listed, so
//!   the user can delete them. Every id is counted exactly once.
//! - **Listing fails open** on an unreadable shadow store (`in_use` sees
//!   nothing open): recover and discard re-check and fail closed.
//! - **Cleanup holds the draft lock over the whole scan and every delete.**
//!   It deletes stale (> 7 days) recovered bundles that are not in use, and
//!   on an unreadable store deletes nothing: any candidate could be open.
//!   Legacy two-file and corrupt drafts are never cleaned up (as before).
//! - The `*_with` variants take a context provider and call it once, under
//!   the draft lock (ADR-0038 §4), so the check cannot see a stale snapshot.
//!   Only cleanup has one: listing takes no lock. Cleanup's `&LiveContext`
//!   form is a `#[cfg(test)]` wrapper that clones the context.
//! - This is the only listing and cleanup: the context-free `list_drafts` /
//!   `cleanup_old_drafts` were removed (D27 review) as they had no callers.
//!
//! @coordinates-with src-tauri/src/services/draft/lock.rs
//! @coordinates-with src-tauri/src/services/draft/visibility.rs
use chrono::{DateTime, Duration, Utc};
use std::collections::HashSet;
use std::fs;

use crate::models::DraftMetadata;

use super::lock::draft_lock;
use super::{
    delete_draft_locked, drafts_dir, in_use, visible, CleanupCounts, DraftBundle, DraftError,
    DraftListCounts, DraftListing, DraftMetadataEntry, InUseReason, LiveContext,
};

const STALE_AFTER_DAYS: i64 = 7;

/// One draft id found on disk.
enum Found {
    Bundle {
        id: String,
        bundle: DraftBundle,
    },
    /// An unreadable or unparseable bundle, as a degraded entry.
    Corrupt(DraftMetadataEntry),
    /// A pre-bundle two-file draft with no bundle of the same id.
    Legacy(DraftMetadataEntry),
}

fn io_error(err: std::io::Error) -> DraftError {
    DraftError::IoError {
        message: err.to_string(),
    }
}

/// `path`'s modification time as RFC 3339, or `""` when unreadable.
fn file_mtime(path: &std::path::Path) -> String {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| DateTime::<Utc>::from(t).to_rfc3339())
        .unwrap_or_default()
}

fn degraded(id: String, path: &std::path::Path, title: &str) -> DraftMetadataEntry {
    DraftMetadataEntry {
        id,
        original_path: None,
        last_modified: file_mtime(path),
        recovered: false,
        title: title.to_string(),
    }
}

/// Every draft id in the drafts directory: bundles first, then legacy pairs.
fn scan() -> Result<Vec<Found>, DraftError> {
    let dir = drafts_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let items: Vec<_> = fs::read_dir(&dir)
        .map_err(io_error)?
        .collect::<Result<_, _>>()
        .map_err(io_error)?;
    let names: Vec<(String, std::path::PathBuf)> = items
        .iter()
        .filter_map(|i| Some((i.file_name().to_str()?.to_string(), i.path())))
        .collect();

    let mut found = Vec::new();
    let mut bundle_ids = HashSet::new();
    for (name, path) in &names {
        let Some(id) = name.strip_suffix(".draft.json").filter(|id| !id.is_empty()) else {
            continue;
        };
        bundle_ids.insert(id.to_string());
        let parsed = fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str::<DraftBundle>(&raw).ok());
        found.push(match parsed {
            Some(bundle) => Found::Bundle {
                id: id.to_string(),
                bundle,
            },
            None => Found::Corrupt(degraded(id.to_string(), path, "(corrupted)")),
        });
    }
    for (name, path) in &names {
        let Some(id) = name.strip_suffix(".draft.md").filter(|id| !id.is_empty()) else {
            continue;
        };
        if bundle_ids.contains(id) {
            continue;
        }
        let meta_path = dir.join(format!("{id}.meta.json"));
        let entry = if meta_path.exists() {
            match fs::read_to_string(&meta_path)
                .ok()
                .and_then(|s| serde_json::from_str::<DraftMetadata>(&s).ok())
            {
                Some(meta) => DraftMetadataEntry {
                    id: id.to_string(),
                    original_path: meta.original_path,
                    last_modified: meta.last_modified,
                    recovered: meta.recovered,
                    title: meta.title,
                },
                None => degraded(id.to_string(), path, "(metadata corrupt)"),
            }
        } else {
            degraded(id.to_string(), path, "(metadata missing)")
        };
        found.push(Found::Legacy(entry));
    }
    Ok(found)
}

/// Count `entry` and list it, or count why it is hidden.
fn place(
    out: &mut DraftListing,
    entry: DraftMetadataEntry,
    has_owner: bool,
    reason: Option<InUseReason>,
) {
    if visible(entry.recovered, has_owner, reason) {
        out.counts.listed += 1;
        if entry.recovered {
            out.counts.relisted += 1;
        }
        out.entries.push(entry);
    } else if reason.is_some() {
        out.counts.hidden_in_use += 1;
    } else {
        out.counts.hidden_recovered += 1;
    }
}

/// The drafts to offer for recovery in a window of `ctx`. Read-only.
pub fn list_drafts_for(ctx: &LiveContext) -> Result<DraftListing, DraftError> {
    let mut out = DraftListing {
        entries: Vec::new(),
        counts: DraftListCounts::default(),
    };
    for found in scan()? {
        match found {
            Found::Bundle { id, bundle } => {
                let reason = in_use(
                    &id,
                    bundle.original_path.as_deref(),
                    bundle.owner.as_ref(),
                    ctx,
                );
                let has_owner = bundle.owner.is_some();
                let entry = DraftMetadataEntry {
                    id,
                    original_path: bundle.original_path,
                    last_modified: bundle.last_modified,
                    recovered: bundle.recovered,
                    title: bundle.title,
                };
                place(&mut out, entry, has_owner, reason);
            }
            Found::Corrupt(entry) => {
                out.counts.listed += 1;
                out.entries.push(entry);
            }
            Found::Legacy(entry) => {
                let reason = in_use(&entry.id, entry.original_path.as_deref(), None, ctx);
                place(&mut out, entry, false, reason);
            }
        }
    }
    Ok(out)
}

/// Delete stale recovered bundles that no live window is using. Checks
/// against a copy of `ctx`; see [`cleanup_old_drafts_for_with`]. Test-only:
/// a caller-built `ctx` is the snapshot-before-lock pattern.
#[cfg(test)]
pub(crate) fn cleanup_old_drafts_for(ctx: &LiveContext) -> Result<CleanupCounts, DraftError> {
    cleanup_old_drafts_for_with(|| ctx.clone())
}

/// [`cleanup_old_drafts_for`], building the context with `make_ctx` once,
/// under the draft lock that covers the whole scan and every delete.
pub fn cleanup_old_drafts_for_with(
    make_ctx: impl FnOnce() -> LiveContext,
) -> Result<CleanupCounts, DraftError> {
    let _held = draft_lock();
    let ctx = make_ctx();
    let threshold = Utc::now() - Duration::days(STALE_AFTER_DAYS);
    let mut counts = CleanupCounts::default();
    for found in scan()? {
        let (id, bundle) = match found {
            Found::Bundle { id, bundle } => (id, bundle),
            Found::Corrupt(_) | Found::Legacy(_) => continue,
        };
        let stale =
            DateTime::parse_from_rfc3339(&bundle.last_modified).is_ok_and(|lm| lm < threshold);
        if !bundle.recovered || !stale {
            continue;
        }
        let used = ctx.open.is_err()
            || in_use(
                &id,
                bundle.original_path.as_deref(),
                bundle.owner.as_ref(),
                &ctx,
            )
            .is_some();
        if used {
            counts.skipped_live += 1;
            continue;
        }
        // Best-effort, as before: a failed delete is skipped, not fatal.
        if matches!(delete_draft_locked(&id, None, true), Ok(true)) {
            counts.deleted += 1;
        }
    }
    Ok(counts)
}

#[cfg(all(test, unix))]
#[path = "cleanup_owner_tests.rs"]
mod cleanup_owner_tests;
#[cfg(all(test, unix))]
#[path = "listing_owner_tests.rs"]
mod listing_owner_tests;
