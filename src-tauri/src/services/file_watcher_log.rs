//! Log vocabulary and log lines for the file watcher (D32 step 1, WI-1/WI-3).
//!
//! Purpose: name every notify `EventKind` the watcher can receive as a closed
//! `(kind, detail)` pair of snake_case strings, so a diagnostic log line can
//! tell `Metadata(Extended)` apart from `Metadata(Any)` or `Data(Content)`;
//! build the `file.watch.event` line for each notify event; and take the
//! read-only `stat_snapshot` both lines carry. The register/unregister and
//! `file.watch.error` lines live in `file_watcher_register_log.rs` and are
//! re-exported here.
//!
//! @coordinates-with services/file_watcher.rs (parent; mounts this file with
//! `#[path]`; `observe_event` and `apply_watch` call these builders),
//! file_watcher_register_log.rs (child), models/log_entry.rs,
//! file_watcher_kinds_fixture.rs (test-only kind enumeration)
//!
//! Key decisions:
//! - **Exhaustive, with no catch-all arm.** notify 6.1.1's `EventKind` and
//!   every sub-enum under it are not `#[non_exhaustive]`, so every one of the
//!   41 leaves is matched by name. A notify upgrade that adds a variant fails
//!   to compile here, which is the intended tripwire; a `_` arm would hide it.
//! - **Injective.** Every leaf gets its own `(kind, detail)` pair, and
//!   `AccessMode` is folded into the detail (`open_read`, `close_write`) so
//!   `Access(Read)` and `Access(Open(Read))` stay distinguishable.
//! - Kinds and sub-kinds with no payload log `detail: "none"`.
//! - **One fixed key set.** `file.watch.event` always carries the same 12
//!   context keys, absent values as `null`, so `jq` comparisons never miss.
//! - **Paths, never content.** The full path is logged (a D32-scoped
//!   diagnostic decision, to be reduced when D32 closes); file content,
//!   xattr values and messages never are. The stat reads metadata only.

use notify::event::{
    AccessKind, AccessMode, CreateKind, DataChange, MetadataKind, ModifyKind, RemoveKind,
    RenameMode,
};
use notify::{Event, EventKind};
use serde_json::json;
use std::path::Path;
use std::time::UNIX_EPOCH;

use super::{FileChangedEvent, WatchOutcome};
use crate::models::log_entry::{LogEntryPayload, LogLevel, LogStatus};

/// Size and mtime of a watched file at one instant (read-only `stat`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct FileStat {
    pub mtime_ms: i64,
    pub size: u64,
}

/// Every `kind` string [`classify_event_kind`] can produce. Test-only: the
/// closed vocabulary the classification tests check against.
#[cfg(test)]
pub(crate) const ALL_KINDS: &[&str] = &[
    "any",
    "access",
    "create",
    "modify_any",
    "modify_data",
    "modify_metadata",
    "modify_name",
    "modify_other",
    "remove",
    "other",
];

/// Every `detail` string [`classify_event_kind`] can produce. Test-only.
#[cfg(test)]
pub(crate) const ALL_DETAILS: &[&str] = &[
    "none",
    "any",
    "read",
    "other",
    "open_any",
    "open_execute",
    "open_read",
    "open_write",
    "open_other",
    "close_any",
    "close_execute",
    "close_read",
    "close_write",
    "close_other",
    "file",
    "folder",
    "size",
    "content",
    "access_time",
    "write_time",
    "permissions",
    "ownership",
    "extended",
    "to",
    "from",
    "both",
];

/// A notify event kind, named for the log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct WatchKindClass {
    pub kind: &'static str,
    pub detail: &'static str,
}

const fn class(kind: &'static str, detail: &'static str) -> WatchKindClass {
    WatchKindClass { kind, detail }
}

/// Classify one notify event kind as a closed `(kind, detail)` pair drawn
/// from [`ALL_KINDS`] and [`ALL_DETAILS`]. Pure; one pair per leaf.
pub(crate) fn classify_event_kind(kind: &EventKind) -> WatchKindClass {
    match kind {
        EventKind::Any => class("any", "none"),
        EventKind::Access(access) => class("access", access_detail(access)),
        EventKind::Create(create) => class("create", create_detail(create)),
        EventKind::Modify(ModifyKind::Any) => class("modify_any", "none"),
        EventKind::Modify(ModifyKind::Data(data)) => class("modify_data", data_detail(data)),
        EventKind::Modify(ModifyKind::Metadata(meta)) => {
            class("modify_metadata", metadata_detail(meta))
        }
        EventKind::Modify(ModifyKind::Name(mode)) => class("modify_name", rename_detail(mode)),
        EventKind::Modify(ModifyKind::Other) => class("modify_other", "none"),
        EventKind::Remove(remove) => class("remove", remove_detail(remove)),
        EventKind::Other => class("other", "none"),
    }
}

fn access_detail(access: &AccessKind) -> &'static str {
    match access {
        AccessKind::Any => "any",
        AccessKind::Read => "read",
        AccessKind::Other => "other",
        AccessKind::Open(AccessMode::Any) => "open_any",
        AccessKind::Open(AccessMode::Execute) => "open_execute",
        AccessKind::Open(AccessMode::Read) => "open_read",
        AccessKind::Open(AccessMode::Write) => "open_write",
        AccessKind::Open(AccessMode::Other) => "open_other",
        AccessKind::Close(AccessMode::Any) => "close_any",
        AccessKind::Close(AccessMode::Execute) => "close_execute",
        AccessKind::Close(AccessMode::Read) => "close_read",
        AccessKind::Close(AccessMode::Write) => "close_write",
        AccessKind::Close(AccessMode::Other) => "close_other",
    }
}

fn create_detail(create: &CreateKind) -> &'static str {
    match create {
        CreateKind::Any => "any",
        CreateKind::File => "file",
        CreateKind::Folder => "folder",
        CreateKind::Other => "other",
    }
}

fn data_detail(data: &DataChange) -> &'static str {
    match data {
        DataChange::Any => "any",
        DataChange::Size => "size",
        DataChange::Content => "content",
        DataChange::Other => "other",
    }
}

fn metadata_detail(meta: &MetadataKind) -> &'static str {
    match meta {
        MetadataKind::Any => "any",
        MetadataKind::AccessTime => "access_time",
        MetadataKind::WriteTime => "write_time",
        MetadataKind::Permissions => "permissions",
        MetadataKind::Ownership => "ownership",
        MetadataKind::Extended => "extended",
        MetadataKind::Other => "other",
    }
}

fn rename_detail(mode: &RenameMode) -> &'static str {
    match mode {
        RenameMode::Any => "any",
        RenameMode::To => "to",
        RenameMode::From => "from",
        RenameMode::Both => "both",
        RenameMode::Other => "other",
    }
}

fn remove_detail(remove: &RemoveKind) -> &'static str {
    match remove {
        RemoveKind::Any => "any",
        RemoveKind::File => "file",
        RemoveKind::Folder => "folder",
        RemoveKind::Other => "other",
    }
}

/// Event name: one line per notify event reaching the watcher callback.
pub(crate) const WATCH_EVENT: &str = "file.watch.event";

/// Read-only `stat` of `path`: mtime in ms since the epoch and size in bytes.
/// `None` when the path is missing or its mtime is unreadable; never panics,
/// because it runs on notify's callback thread.
pub(crate) fn stat_snapshot(path: &Path) -> Option<FileStat> {
    let meta = std::fs::metadata(path).ok()?;
    let since_epoch = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(FileStat {
        mtime_ms: i64::try_from(since_epoch.as_millis()).ok()?,
        size: meta.len(),
    })
}

/// The `file.watch.event` line for one notify event and its routing result.
/// Context keys are the fixed 12-key allowlist, absent values as `null`;
/// status is `Success` iff the event was emitted, else `Cancel`.
pub(crate) fn build_watch_event_log(
    event: &Event,
    outcome: WatchOutcome,
    emitted: Option<&FileChangedEvent>,
    stat: Option<FileStat>,
    timestamp: i64,
) -> LogEntryPayload {
    let class = classify_event_kind(&event.kind);
    let status = match outcome {
        WatchOutcome::EmittedModified
        | WatchOutcome::EmittedDeleted
        | WatchOutcome::EmittedRenamed => LogStatus::Success,
        WatchOutcome::Debounced
        | WatchOutcome::SelfWrite
        | WatchOutcome::IgnoredKind
        | WatchOutcome::IgnoredNoPath
        | WatchOutcome::IgnoredRenameSinglePath => LogStatus::Cancel,
    };
    LogEntryPayload {
        level: LogLevel::Info,
        event: WATCH_EVENT.to_string(),
        status,
        action_id: None,
        context: Some(json!({
            "kind": class.kind,
            "detail": class.detail,
            "outcome": outcome.as_str(),
            "changeType": emitted.map(|e| e.change_type.as_str()),
            "path": event.paths.first().map(|p| p.to_string_lossy()),
            "pathCount": event.paths.len(),
            "info": event.info(),
            "rescan": event.need_rescan(),
            "ownEvent": event.attrs.process_id().is_some(),
            "mtimeMs": stat.map(|s| s.mtime_ms),
            "size": stat.map(|s| s.size),
            "timestamp": timestamp,
        })),
        duration_ms: None,
        error: None,
    }
}

#[path = "file_watcher_register_log.rs"]
mod register_log;
pub(crate) use register_log::{
    apply_watch_list, build_watch_error_log, build_watch_register_log, WatchOp,
};

#[cfg(test)]
#[path = "file_watcher_log_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "file_watcher_log_event_tests.rs"]
mod event_tests;

#[cfg(test)]
#[path = "file_watcher_log_register_tests.rs"]
mod register_tests;

#[cfg(test)]
#[path = "file_watcher_log_error_tests.rs"]
mod error_tests;
