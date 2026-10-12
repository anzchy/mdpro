//! Purpose: register a Save As target with the file watcher (D69). Before
//! this, only `open_file` / `open_file_dialog` registered, so a file first
//! saved through the Save As dialog (an untitled document's first ⌘S) was
//! never watched: an external edit raised no prompt and the next ⌘S
//! silently overwrote it.
//!
//! It also holds the D111-WI-1 refusal: a Save As onto the document's own
//! file while that document has an unresolved external change writes
//! nothing, as ⌘S refuses.
//!
//! Pipeline: `save_file_dialog` (dialog only) → [`refused_save_as`] (picked
//! path vs `refuse_path`; a match returns `blocked_by_pending_change` and
//! stops) → [`save_as_watched_with`] → `save_file_written` (the whole
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
//!   document path and later hands to `close_document`'s `unwatch`, like the
//!   string `open_file` registers. (The baseline key is canonicalised inside
//!   the store either way.)
//! - **The old path is not unwatched.** Another tab may hold it.
//! - **Refuse only the own file** (D111-WI-1). The frontend sends
//!   `refuse_path` (the document's path) only while the document has a
//!   pending external change; the picked path is refused when it is the
//!   same string or canonicalises to the same file. A missing file compares
//!   by string. The refusal logs a `file.save` cancel with reason
//!   `external_change_pending` and no path; any other target saves as before.
//! - **The reply reports the target's seed check** (D111-WI-2):
//!   `changed_since_read` is true when a write landed between ours and the
//!   register, or the check failed open. A refused reply never ran it, so
//!   it is `false` there.
//! - No new log line: `watch_seeded` already writes the register line,
//!   after the `file.save` success line.
//!
//! @coordinates-with commands/file.rs — `save_file_dialog` calls
//!   `refused_save_as`, then this seam; `save_file_written` is the save body
//!   it runs
//! @coordinates-with services/file_watcher_seed.rs — `watch_seeded` and its
//!   `SeedCheck`
//! @coordinates-with services/file_watcher_baseline_seed.rs — `seed_for_written`
//! @coordinates-with commands/draft_recover_watch.rs — the D59 sibling seam

use crate::services::file_watcher::seed::seed_for_written;
use crate::services::file_watcher::FileWatcher;
use std::path::PathBuf;

use super::file::{log_file_event, save_file_written, FileError, SaveResult};
use crate::models::{LogLevel, LogStatus};
use serde_json::json;

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
    let (result, written) = save_file_written(
        document_id,
        content,
        Some(path),
        encoding,
        line_ending,
        action_id,
        watcher.baselines(),
    )
    .await?;
    between_save_and_register();
    let target = PathBuf::from(&result.path);
    let check = watcher.watch_seeded(&target, seed_for_written(&target, &written));
    Ok(SaveResult {
        changed_since_read: check.changed(),
        ..result
    })
}

/// D111-WI-1: Save As with the refusal `save_file_dialog` applies first. When
/// `refuse_path` (the document's own path, sent only while it has an
/// unresolved external change) names the same file as `path`, nothing is
/// written or registered and the reply is `blocked_by_pending_change`; any
/// other target saves through [`save_as_watched_with`]. `save_file_dialog`
/// runs the same two steps inline (its D69 wiring pins the
/// `save_as_watched_with` call there), so this composition is test-only.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn save_as_checked_with(
    document_id: String,
    content: String,
    path: String,
    encoding: Option<String>,
    line_ending: Option<String>,
    action_id: Option<String>,
    refuse_path: Option<String>,
    watcher: &FileWatcher,
) -> Result<SaveResult, FileError> {
    if let Some(blocked) = refused_save_as(&path, refuse_path.as_deref(), action_id.as_deref()) {
        return Ok(blocked);
    }
    save_as_watched_with(
        document_id,
        content,
        path,
        encoding,
        line_ending,
        action_id,
        watcher,
    )
    .await
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
/// is registered, the window a re-snapshot would baseline.
#[cfg(test)]
pub(crate) mod hook {
    use std::cell::RefCell;

    type Hook = Box<dyn FnOnce()>;

    thread_local! {
        static HOOK: RefCell<Option<Hook>> = RefCell::new(None);
    }

    /// Clears this thread's hook on drop, fired or not.
    pub(crate) struct HookGuard;
    impl Drop for HookGuard {
        fn drop(&mut self) {
            HOOK.with(|h| h.borrow_mut().take());
        }
    }

    /// Install `hook` for the next Save As on this thread.
    pub(crate) fn install(hook: impl FnOnce() + 'static) -> HookGuard {
        HOOK.with(|h| *h.borrow_mut() = Some(Box::new(hook)));
        HookGuard
    }

    pub(super) fn between_save_and_register() {
        if let Some(hook) = HOOK.with(|h| h.borrow_mut().take()) {
            hook();
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_watch_tests.rs"]
mod tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_refuse_tests.rs"]
mod refuse_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_seed_check_tests.rs"]
mod seed_check_tests;
