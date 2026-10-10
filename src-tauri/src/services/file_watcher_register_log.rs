//! Register/unregister and error log lines for the file watcher (D32 step 1,
//! WI-3, follow-up L1).
//!
//! Purpose: describe one `FileWatcher::watch` / `watch_seeded` / `unwatch`
//! call as a single `file.watch.register` / `file.watch.unregister` log entry
//! carrying notify's real `Result` (and, for a register, what the baseline
//! store did: `context.baseline`, D86 WI-3), keep the watch-list bookkeeping
//! pure, and describe each `Err` the notify callback receives as one
//! `file.watch.error` line.
//!
//! @coordinates-with services/file_watcher_log.rs (parent; mounts this file
//! with `#[path]` and re-exports its items), services/file_watcher.rs
//! (`apply_watch` calls notify, then these; the `RecommendedWatcher::new`
//! callback logs its `Err` arm), services/file_watcher_seed.rs
//! (`baseline_log` picks the `BaselineLog` for a register), models/log_entry.rs
//!
//! Key decisions:
//! - **The level is a total function of `(op, ok)`**: register failure is
//!   `Error` (the file is silently unwatched), unregister failure is `Warn`
//!   (routine for a never-watched or deleted file), success is `Info`.
//! - The full path is logged (D32-scoped diagnostic decision); no file
//!   content ever is. `error` appears in the context only on failure.
//! - The list is updated whatever notify returns, as before this change.
//! - **`errorKind` is closed**: one snake_case name per `notify::ErrorKind`
//!   variant, matched with no `_` arm. `Io` carries only an OS error from a
//!   syscall (metadata, walk, watch setup) and `InvalidConfig` only the
//!   watcher `Config`; neither can carry file content.
//! - **`baseline` is closed too**: four strings, one per `BaselineLog`
//!   variant, matched with no `_` arm. It names the entry actually stored
//!   (`failopen` for one with no hash, whichever path stored it), never the
//!   path that was asked for.

use super::FileStat;
use crate::models::log_entry::{LogEntryPayload, LogLevel, LogStatus};
use notify::ErrorKind;
use serde_json::json;
use std::path::Path;

/// Event name: one line per `FileWatcher::watch` call.
pub(crate) const WATCH_REGISTER_EVENT: &str = "file.watch.register";
/// Event name: one line per `FileWatcher::unwatch` call.
pub(crate) const WATCH_UNREGISTER_EVENT: &str = "file.watch.unregister";
/// Event name: one line per `Err` the notify callback receives.
pub(crate) const WATCH_ERROR_EVENT: &str = "file.watch.error";

/// Which side of the watch list a register log line describes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WatchOp {
    Register,
    Unregister,
}

/// The `file.watch.register` / `file.watch.unregister` line for one notify
/// `watch` / `unwatch` Result. Failure is `Error` for register (the file is
/// silently unwatched) and `Warn` for unregister (routine for a never-watched
/// or deleted file); success is `Info`. `error` is present only on failure.
pub(crate) fn build_watch_register_log(
    op: WatchOp,
    path: &Path,
    result: Result<(), String>,
    already_watched: bool,
    stat: Option<FileStat>,
    watched_count: usize,
) -> LogEntryPayload {
    let (event, fail_level) = match op {
        WatchOp::Register => (WATCH_REGISTER_EVENT, LogLevel::Error),
        WatchOp::Unregister => (WATCH_UNREGISTER_EVENT, LogLevel::Warn),
    };
    let mut context = json!({
        "path": path.to_string_lossy(),
        "ok": result.is_ok(),
        "alreadyWatched": already_watched,
        "mtimeMs": stat.map(|s| s.mtime_ms),
        "size": stat.map(|s| s.size),
        "watchedCount": watched_count,
    });
    let (level, status, error) = match result {
        Ok(()) => (LogLevel::Info, LogStatus::Success, None),
        Err(message) => {
            context["error"] = json!(message);
            (fail_level, LogStatus::Fail, Some(message))
        }
    };
    LogEntryPayload {
        level,
        event: event.to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error,
    }
}

/// What the baseline store did after a `file.watch.register` line's notify
/// call (D86 WI-3): the value of the line's `context.baseline` field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BaselineLog {
    /// `watch_seeded` stored an entry with a hash.
    Seeded,
    /// Plain `watch` stored an entry with a hash.
    Snapshot,
    /// Either path stored an entry with no hash.
    FailOpen,
    /// The ticket rule skipped the store.
    StaleSkipped,
}

/// `line` with `context.baseline` set to `outcome`'s closed string.
/// A line without a JSON-object context is returned unchanged.
pub(crate) fn with_baseline(mut line: LogEntryPayload, outcome: BaselineLog) -> LogEntryPayload {
    let value = match outcome {
        BaselineLog::Seeded => "seeded",
        BaselineLog::Snapshot => "snapshot",
        BaselineLog::FailOpen => "failopen",
        BaselineLog::StaleSkipped => "stale_skipped",
    };
    if let Some(context) = line.context.as_mut().and_then(|c| c.as_object_mut()) {
        context.insert("baseline".to_string(), json!(value));
    }
    line
}

/// Watch-list bookkeeping: push on register (once), retain on unregister.
/// Returns `(already_watched, watched_count)`, with `already_watched`
/// measured before the list changes.
pub(crate) fn apply_watch_list(list: &mut Vec<String>, path: &str, op: WatchOp) -> (bool, usize) {
    let already_watched = list.iter().any(|item| item == path);
    match op {
        WatchOp::Register if !already_watched => list.push(path.to_string()),
        WatchOp::Register => {}
        WatchOp::Unregister => list.retain(|item| item != path),
    }
    (already_watched, list.len())
}

/// The closed `errorKind` string for one notify `ErrorKind`. No catch-all
/// arm: notify 6.1.1's `ErrorKind` is not `#[non_exhaustive]`, so a variant
/// added by an upgrade fails to compile here. Only the variant name is
/// logged, never its payload.
fn error_kind_str(kind: &ErrorKind) -> &'static str {
    match kind {
        ErrorKind::Generic(_) => "generic",
        ErrorKind::Io(_) => "io",
        ErrorKind::PathNotFound => "path_not_found",
        ErrorKind::WatchNotFound => "watch_not_found",
        ErrorKind::InvalidConfig(_) => "invalid_config",
        ErrorKind::MaxFilesWatch => "max_files_watch",
    }
}

/// The `file.watch.error` line for one `Err` notify hands the watcher
/// callback: `Warn`/`Fail`, the closed `errorKind` plus the error's paths in
/// the context, and notify's `Display` text as `error`.
pub(crate) fn build_watch_error_log(err: &notify::Error) -> LogEntryPayload {
    let paths: Vec<String> = err
        .paths
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    LogEntryPayload {
        level: LogLevel::Warn,
        event: WATCH_ERROR_EVENT.to_string(),
        status: LogStatus::Fail,
        action_id: None,
        context: Some(json!({
            "errorKind": error_kind_str(&err.kind),
            "paths": paths,
        })),
        duration_ms: None,
        error: Some(err.to_string()),
    }
}
