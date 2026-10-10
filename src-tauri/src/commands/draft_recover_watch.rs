//! Purpose: register a recovered draft's file with the file watcher (D59).
//! A draft recovered into a tab with an `original_path` must be watched
//! exactly as `open_file` watches the files it opens, or an external edit
//! to that file goes unnoticed for the rest of the session.
//!
//! Pipeline: `recover_draft` (command) → [`recover_draft_watched_with`] →
//! `recover_draft_logged_with` (gate → `DRAFT_LOCK` → recovery) → on `Ok`
//! with a path: `validate_file_path` + absolute check → `FileWatcher::watch`.
//!
//! Key decisions:
//! - The watch is registered only after `recover_draft_logged_with` has
//!   returned, so the quit gate and `DRAFT_LOCK` are already released and
//!   the watcher mutex is never taken under either.
//! - The path registered is the exact stored string — no canonicalisation —
//!   so the later `close_document` unwatch of the same string removes it.
//! - A stored path that `open_file` would refuse (traversal, wrong extension)
//!   or a relative path is not watched. It logs one warn `cancel` line for
//!   `file.watch.register` with context `{source, reason}` only: the path is
//!   untrusted on-disk data and never appears in the log.
//! - A refusal (`Err`) or a draft without a path leaves the watcher alone,
//!   and the recover result is returned unchanged in every case.
//!
//! @coordinates-with commands/draft_recovery.rs — `recover_draft` calls this seam
//! @coordinates-with services/file_watcher.rs — `watch` and its register log
//! @coordinates-with commands/file.rs — `validate_file_path`, shared with `open_file`

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::draft::{DraftError, DraftOwner, LiveContext, RecoverResult};
use crate::services::file_watcher::FileWatcher;
use crate::services::logger;
use crate::services::quit_guard::DraftGate;
use serde_json::json;
use std::path::Path;

use super::draft_recovery::recover_draft_logged_with;
use super::file::validate_file_path;

/// The log event shared with `FileWatcher::watch`.
const WATCH_REGISTER_EVENT: &str = "file.watch.register";

/// Recover `document_id`, then watch its stored `original_path` if it is one
/// `open_file` would accept and is absolute. Returns the recover result
/// unchanged; the watch never turns a successful recover into an error.
pub(crate) fn recover_draft_watched_with(
    gate: &DraftGate,
    document_id: &str,
    caller: &DraftOwner,
    make_ctx: impl FnOnce() -> LiveContext,
    watcher: &FileWatcher,
) -> Result<RecoverResult, DraftError> {
    let result = recover_draft_logged_with(gate, document_id, caller, make_ctx)?;
    if let Some(path) = result.original_path.as_deref() {
        watch_recovered(path, watcher);
    }
    Ok(result)
}

fn watch_recovered(path: &str, watcher: &FileWatcher) {
    let p = Path::new(path);
    if validate_file_path(path).is_ok() && p.is_absolute() {
        watcher.watch(p);
        return;
    }
    logger::log_event(LogEntryPayload {
        level: LogLevel::Warn,
        event: WATCH_REGISTER_EVENT.to_string(),
        status: LogStatus::Cancel,
        action_id: None,
        context: Some(json!({ "source": "recover", "reason": "invalid_path" })),
        duration_ms: None,
        error: None,
    });
}
