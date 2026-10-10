//! Routing for one notify event: which `file:changed` payload it becomes, if
//! any, and the `WatchOutcome` that says why (D32, D68).
//!
//! Purpose: hold `process_event`, the Tauri-free decision between the notify
//! callback and the emit. It consults the self-write set and the debounce map
//! (file_watcher_gate.rs) and the D32 baselines (file_watcher_baseline.rs),
//! and returns the outcome plus the event to emit; the caller logs and emits.
//!
//! @coordinates-with services/file_watcher.rs (parent; mounts this file with
//! `#[path]`, imports `process_event`, and `observe_event` calls it),
//! file_watcher_gate.rs (`is_self_write`, `is_debounced`),
//! file_watcher_baseline.rs (`is_filtered_kind`, `is_unchanged`,
//! `refresh_if_present`), file_watcher_outcome.rs (`WatchOutcome`),
//! file_watcher_tests.rs (o14 reads this file's `process_event` source)
//!
//! Key decisions:
//! - **Check order is the contract** (ADR-0068): kind, path count, self-write,
//!   the D32 unchanged drop, debounce. See `process_event`'s doc.
//! - **No wildcard arm** on the kind match, so a new `EventKind` is a compile
//!   error here rather than a silent drop; o14 pins it on the source text.
//! - Split out of `file_watcher.rs` (D68 WI-1) so the parent keeps headroom
//!   under the 300-line limit and the single-path rename / `Create` routing
//!   change has one file to edit; behaviour is unchanged by the move.

use notify::event::ModifyKind;
use notify::{Event, EventKind};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use super::baseline::{is_filtered_kind, BaselineStore};
use super::gate::{is_debounced, is_self_write};
use super::{FileChangedEvent, WatchOutcome};

/// Tauri-free routing for one notify event: the `file:changed` payload to
/// emit (if any) and the reason. Order matters: the kind is matched first (so
/// ignored kinds never touch the debounce map), then the path count, then the
/// self-write check (`Modify` only, and before the debounce check so a save
/// never records a debounce entry), then the D32 drop: a
/// `Modify(Metadata(Extended))`, `Modify(Metadata(Any))` or
/// `Modify(Data(Content))` whose first path is unchanged since its baseline,
/// read coherently (ADR-0068), is `IgnoredUnchanged`, again before the
/// debounce check. Then the debounce check keyed by the first path, shared
/// across kinds. Only an emitted `modified` advances the baseline, and only
/// for an already-registered path. `Remove` and renames are not
/// self-write-gated. Each lock (self-write, baseline, debounce) is taken
/// alone, and the baseline's file I/O runs under none of them.
pub(super) fn process_event(
    event: &Event,
    debounce_map: &Mutex<HashMap<PathBuf, Instant>>,
    baselines: &BaselineStore,
    timestamp: i64,
) -> (Option<FileChangedEvent>, WatchOutcome) {
    let (change_type, outcome) = match event.kind {
        EventKind::Modify(ModifyKind::Name(_)) => ("renamed", WatchOutcome::EmittedRenamed),
        EventKind::Modify(_) => ("modified", WatchOutcome::EmittedModified),
        EventKind::Remove(_) => ("deleted", WatchOutcome::EmittedDeleted),
        EventKind::Any | EventKind::Access(_) | EventKind::Create(_) | EventKind::Other => {
            return (None, WatchOutcome::IgnoredKind);
        }
    };
    let Some(path) = event.paths.first() else {
        return (None, WatchOutcome::IgnoredNoPath);
    };
    let new_path = if outcome == WatchOutcome::EmittedRenamed {
        match event.paths.get(1) {
            Some(to) => Some(to.to_string_lossy().to_string()),
            None => return (None, WatchOutcome::IgnoredRenameSinglePath),
        }
    } else {
        None
    };
    if outcome == WatchOutcome::EmittedModified && is_self_write(path) {
        return (None, WatchOutcome::SelfWrite);
    }
    if is_filtered_kind(&event.kind) && baselines.is_unchanged(path) {
        return (None, WatchOutcome::IgnoredUnchanged);
    }
    if is_debounced(path, debounce_map) {
        return (None, WatchOutcome::Debounced);
    }
    if outcome == WatchOutcome::EmittedModified {
        baselines.refresh_if_present(path);
    }
    let emitted = FileChangedEvent {
        path: path.to_string_lossy().to_string(),
        change_type: change_type.to_string(),
        new_path,
        timestamp,
    };
    (Some(emitted), outcome)
}
