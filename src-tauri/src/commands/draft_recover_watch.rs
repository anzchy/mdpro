//! Purpose: register a recovered draft's file with the file watcher (D59).
//! A draft recovered into a tab with an `original_path` must be watched
//! like the files `open_file` opens, or an external edit to that file goes
//! unnoticed for the rest of the session. Unlike `open_file` (which seeds the
//! baseline from its own read, `watch_seeded`, D86 WI-3), recovery keeps the
//! plain `watch`: the editor holds the draft, not the disk bytes, so the
//! baseline is a fresh snapshot of the disk (ADR-0068 decision 4).
//!
//! Pipeline: `recover_draft` (command) → [`recover_draft_watched_with`] →
//! `recover_draft_logged_with` (gate → `DRAFT_LOCK` → recovery) → on `Ok`
//! with a path: `validate_file_path` + absolute check → `reserve_hold` for
//! the caller's window → `FileWatcher::watch` → `confirm_hold`, whose gen
//! goes back as `RecoverResult.hold_gen` (D173).
//!
//! Key decisions:
//! - The watch is registered only after `recover_draft_logged_with` has
//!   returned, so the quit gate and `DRAFT_LOCK` are already released and
//!   the watcher mutex is never taken under either.
//! - The path registered is the exact stored string — no canonicalisation —
//!   and the hold is keyed by it and the caller's window label (D173), so
//!   that window's `release_watch_hold` of the same string, or its
//!   destruction, releases it and another window's does not. A fenced
//!   (destroyed) caller registers nothing; `hold_gen` 0 means no hold.
//! - A stored path that `open_file` would refuse (traversal, wrong extension)
//!   or a relative path is not watched. It logs one warn `cancel` line for
//!   `file.watch.register` with context `{source, reason}` only: the path is
//!   untrusted on-disk data and never appears in the log.
//! - A refusal (`Err`) or a draft without a path leaves the watcher alone,
//!   and the recover result is returned unchanged in every case.
//!
//! @coordinates-with commands/draft_recovery.rs — `recover_draft` calls this seam
//! @coordinates-with services/file_watcher_holders.rs — `reserve_hold` /
//!   `confirm_hold` around the register (D173)
//! @coordinates-with services/file_watcher.rs — `watch` (never `watch_seeded`),
//!   its register log, and the D32 snapshot baseline it records for the
//!   recovered path (ADR-0068 decision 4)
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
/// `open_file` would accept and is absolute, held for `caller`'s window.
/// Returns the recover result with `hold_gen` set (0 when no hold was
/// taken); the watch never turns a successful recover into an error.
pub(crate) fn recover_draft_watched_with(
    gate: &DraftGate,
    document_id: &str,
    caller: &DraftOwner,
    make_ctx: impl FnOnce() -> LiveContext,
    watcher: &FileWatcher,
) -> Result<RecoverResult, DraftError> {
    let mut result = recover_draft_logged_with(gate, document_id, caller, make_ctx)?;
    if let Some(path) = result.original_path.as_deref() {
        result.hold_gen = watch_recovered(path, &caller.window_label, watcher);
    }
    Ok(result)
}

/// Reserve, register and confirm `path` for window `label`; the confirmed
/// gen, or 0 when the path is refused, the window is fenced, or the hold
/// was lost during the register.
fn watch_recovered(path: &str, label: &str, watcher: &FileWatcher) -> u64 {
    let p = Path::new(path);
    if validate_file_path(path).is_ok() && p.is_absolute() {
        let Some(hold) = watcher.reserve_hold(label, p) else {
            return 0;
        };
        watcher.watch(p);
        return if watcher.confirm_hold(&hold) {
            hold.gen
        } else {
            0
        };
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
    0
}
