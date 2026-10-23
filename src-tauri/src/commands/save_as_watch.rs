//! Purpose: register a Save As target with the file watcher (D69).
//! An untitled document's first save must register its new path.
//!
//! D111 also refuses the original path while its external change is unresolved.
//!
//! Pipeline: `save_file_dialog` (dialog only) → [`refused_save_as`] for
//! pending external change on the original path → [`refuse_open_target`]
//! for an already-open other target or an original-path disk conflict →
//! [`save_as_watched_with`] → `save_file_written` (the whole
//! `save_file` body; returns the encoded bytes it wrote) → on `Ok`:
//! `seed_for_written(path, written)` → `FileWatcher::watch_seeded(path,
//! seed)`, which logs `file.watch.register` and returns the seed check →
//! `SaveResult.changed_since_read` (D111-WI-2).
//!
//! Key decisions:
//! - **Save first, register only on `Ok`.** A failed save returns its error
//!   unchanged and leaves the watcher untouched; a cancelled dialog never
//!   reaches this seam.
//! - **Seeded, never a snapshot** (D86 ②, D112: baseline = the bytes the
//!   editor holds). Plain `watch` re-reads the disk, so a write landing
//!   between our rename and that read would be baselined and its event
//!   dropped as unchanged. The seed is the stat now plus the hash of the
//!   written bytes, uncapped; a stat whose size is not the written length
//!   is stored as `None` (fail open, D129).
//! - **The registered string is `SaveResult.path`**, the dialog's path as
//!   given, with no canonicalisation: it is what the frontend stores as the
//!   document path and the string `save_file_dialog` holds for the window
//!   (D173), like the string `open_file` registers. (The baseline key is
//!   canonicalised inside the store either way.)
//! - **The old path is not unwatched here.** Another tab may hold it; the
//!   frontend releases the window's hold on it once no document in the
//!   window holds it (`release_watch_hold`, D173).
//! - **An already-open other target is refused** (D255). A watcher hold in
//!   any window, including an alias spelling, gives a typed `AlreadyOpen`
//!   error before reservation or write. The original path uses the existing
//!   pending-change refusal and a disk-baseline check; an unopened target
//!   follows the native picker decision. No watcher dedupe baseline is used
//!   to decide whether another open document may be overwritten.
//! - **The reply reports the target's seed check** (D111-WI-2):
//!   `changed_since_read` is true when a write landed between ours and the
//!   register, or the check failed open. A refused reply never ran it, so
//!   it is `false` there.
//! - `file.save_as` logs Start and Success/Fail, with enum-only refusal reasons.
//!
//! @coordinates-with commands/file.rs — `save_file_dialog` calls
//!   `refused_save_as`, then this seam; `save_file_written` is the save body
//!   it runs
//! @coordinates-with services/file_watcher_seed.rs — `watch_seeded` and its
//!   `SeedCheck`
//! @coordinates-with services/file_watcher_baseline_seed.rs — `seed_for_written`
//! @coordinates-with commands/draft_recover_watch.rs — the D59 sibling seam
//! @coordinates-with services/file_watcher_holders.rs — `save_file_dialog`
//!   reserves the hold (`without_reconcile`: a Save As sends no origin-less
//!   reconcile notice, D173-WI-4b) before this seam and confirms it after, or on a
//!   failed save restores the window's earlier hold (audit M1) or releases it;
//!   a fenced window saves nothing (audit M2, [`log_fenced_save_as`]). The
//!   test-only `save_as_held_with` mirrors those steps, and the save notice
//!   (`notice_saved`, D173-WI-2) after the confirm
//! @coordinates-with services/file_watcher_save_notice.rs — the notice

use crate::services::file_watcher::seed::seed_for_written;
use crate::services::file_watcher::FileWatcher;
use std::path::PathBuf;

use super::file::{log_file_event, save_file_written, FileError, SaveResult};
use crate::models::{LogLevel, LogStatus};
use serde_json::json;

#[path = "save_as_target.rs"]
mod target;
pub(crate) use target::{
    original_bytes_before_dialog, refuse_open_target, refuse_original_changed_during_dialog,
};

/// Save `content` to `path` (the path the Save As dialog returned) exactly
/// as `save_file` would, then, only if the save succeeded, watch `path`
/// seeded from the bytes written. Returns the save result with
/// `changed_since_read` set from the seed check (D111-WI-2).
pub(crate) async fn save_as_watched_with(
    document_id: String,
    content: String,
    path: String,
    encoding: Option<String>,
    line_ending: Option<String>,
    action_id: Option<String>,
    watcher: &FileWatcher,
) -> Result<SaveResult, FileError> {
    let action_id = action_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let (result, written) = save_file_written(
        document_id,
        content,
        Some(path),
        encoding,
        line_ending,
        Some(action_id.clone()),
        watcher.baselines(),
    )
    .await
    .map_err(|error| {
        log_file_event(
            "file.save_as",
            LogStatus::Fail,
            LogLevel::Error,
            Some(&action_id),
            json!({ "source": "dialog", "reason": "write_failed" }),
            None,
            Some("save as write failed".to_string()),
        );
        error
    })?;
    between_save_and_register();
    let target = PathBuf::from(&result.path);
    let check = watcher.watch_seeded(&target, seed_for_written(&target, &written));
    log_file_event(
        "file.save_as",
        LogStatus::Success,
        LogLevel::Info,
        Some(&action_id),
        json!({ "source": "dialog" }),
        None,
        None,
    );
    Ok(SaveResult {
        changed_since_read: check.changed(),
        ..result
    })
}

#[cfg(test)]
#[path = "save_as_checked_seam.rs"]
mod checked_seam;
#[cfg(test)]
pub(crate) use checked_seam::save_as_checked_with;

/// D173: `save_file_dialog`'s steps after the dialog and the refusal, for
/// window `label`: reserve the hold on `picked` (a fenced window returns
/// `None` before saving, audit M2), save through [`save_as_watched_with`],
/// then confirm and notice on `Ok`, or on `Err` put back the hold the window
/// had (audit M1) else release the reservation. `save_file_dialog` runs the
/// same steps inline (the D69 and D173-WI-1 wiring pin them there), so this
/// composition is test-only; save_as_hold_wiring_tests.rs keeps them in step.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn save_as_held_with(
    label: &str,
    document_id: String,
    content: String,
    picked: String,
    encoding: Option<String>,
    line_ending: Option<String>,
    action_id: Option<String>,
    watcher: &FileWatcher,
) -> Result<Option<SaveResult>, FileError> {
    let raw = PathBuf::from(&picked);
    let Some(hold) = watcher
        .reserve_hold(label, &raw)
        .map(|r| r.without_reconcile())
    else {
        log_fenced_save_as(action_id.as_deref());
        return Ok(None);
    };
    let origin = crate::services::file_watcher::save_notice::SaveOrigin::new(label, &document_id);
    let saved = save_as_watched_with(
        document_id,
        content,
        picked,
        encoding,
        line_ending,
        action_id.clone(),
        watcher,
    )
    .await;
    match saved {
        Ok(mut result) => {
            if watcher.confirm_hold(&hold) {
                result.hold_gen = hold.gen;
            }
            if let Some(written_to) = &result.written_to {
                watcher.notice_saved(&origin, &result.path, written_to, action_id.as_deref());
            }
            Ok(Some(result))
        }
        Err(err) => {
            if !watcher.restore_hold(&hold) {
                watcher.release_hold(label, &raw, hold.gen);
            }
            Err(err)
        }
    }
}

/// Audit M2: a Save As from a fenced (destroyed) window writes and watches
/// nothing; log the `file.save` cancel (reason `window_fenced`, no path).
pub(crate) fn log_fenced_save_as(action_id: Option<&str>) {
    log_file_event(
        "file.save",
        LogStatus::Cancel,
        LogLevel::Warn,
        action_id,
        json!({ "source": "dialog", "reason": "window_fenced" }),
        None,
        None,
    );
}

/// The refused Save As reply when `refuse` names the same file as `picked`
/// (the same string, or both canonicalise to one path), after logging a
/// `file.save` cancel with reason `external_change_pending` (no path). `None`
/// when the save may go ahead, which is always the case without `refuse`.
pub(crate) fn refused_save_as(
    picked: &str,
    refuse: Option<&str>,
    action_id: Option<&str>,
) -> Option<SaveResult> {
    let own = refuse?;
    if !same_file(picked, own) {
        return None;
    }
    log_file_event(
        "file.save",
        LogStatus::Cancel,
        LogLevel::Warn,
        action_id,
        json!({ "source": "dialog", "reason": "external_change_pending" }),
        None,
        None,
    );
    Some(SaveResult {
        success: false,
        path: picked.to_string(),
        saved_at: 0,
        changed_since_read: false,
        blocked_by_pending_change: true,
        hold_gen: 0,
        written_to: None,
    })
}

/// Whether two path strings name one file: equal as given, or equal once
/// both canonicalise (a missing file falls back to the string compare).
fn same_file(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// Production no-op; the test build runs the installed hook here.
#[cfg(not(test))]
fn between_save_and_register() {}

#[cfg(test)]
use hook::between_save_and_register;

/// Test-only seam: run code after the save returned and before the watch
/// is registered (save_as_watch_hook.rs).
#[cfg(test)]
#[path = "save_as_watch_hook.rs"]
pub(crate) mod hook;

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_watch_tests.rs"]
mod tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_refuse_tests.rs"]
mod refuse_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_hold_tests.rs"]
mod hold_tests;

#[cfg(test)]
#[path = "save_as_reconcile_wiring_tests.rs"]
mod reconcile_wiring_tests;

#[cfg(test)]
#[path = "save_as_hold_wiring_tests.rs"]
// The recorded spec's module docs end in a lazy list continuation; its bytes are
// the D173-WI-2-rust receipt's evidence, so the lint is allowed here.
#[allow(clippy::doc_lazy_continuation)]
mod hold_wiring_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_seed_check_tests.rs"]
mod seed_check_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_reconcile_tests.rs"]
mod reconcile_tests;
