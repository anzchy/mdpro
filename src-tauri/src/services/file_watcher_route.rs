//! Routing for one notify event: which `file:changed` payload it becomes, if
//! any, and the `WatchOutcome` that says why (D32, D68, D101, D152).
//!
//! Purpose: hold `process_event_checked`, the Tauri-free decision between the
//! notify callback and the emit. It consults the self-write set and the
//! debounce map (file_watcher_gate.rs) and the D32 baselines
//! (file_watcher_baseline.rs), and returns the event to emit, the outcome and
//! why the unchanged check answered as it did (`UnchangedCheck`, `NotChecked`
//! where the route never asked; D112-WI-2); the caller logs and emits.
//! `process_event` (test-only) drops the reason for the routing tests.
//!
//! @coordinates-with services/file_watcher.rs (parent; mounts this file with
//! `#[path]`, imports `process_event_checked`, and `observe_event` calls it),
//! file_watcher_gate.rs (`is_self_write`, `is_debounced`),
//! file_watcher_baseline.rs (`is_filtered_kind`, `is_unchanged_why`, `UnchangedCheck`,
//! `refresh_if_present`), file_watcher_outcome.rs (`WatchOutcome`),
//! file_watcher_tests.rs (o14 reads this file's `process_event` source),
//! file_watcher_route_replace_tests.rs (D68), file_watcher_route_own_save_tests.rs
//! (D101), file_watcher_route_debounce_kind_tests.rs (D116),
//! file_watcher_route_remove_present_tests.rs (D152),
//! docs/adr/0072-a-replaced-watched-file-is-checked-like-a-content-change.md
//!
//! Key decisions:
//! - **Check order is the contract** (ADR-0068): kind, path count, self-write,
//!   the D32 unchanged drop, debounce. See `process_event_checked`'s doc.
//! - **The debounce is per (path, change type)** (D116): a replace then a
//!   delete, or a delete then a replacement, both reach the frontend.
//! - **A replaced file routes as `modified`** (ADR-0072). On macOS an atomic
//!   save (temp + rename over the file), ours or an external editor's, is a
//!   single-path `Modify(Name(_))`, a `Create(_)` or a `Remove(_)` (D152) on a
//!   path that still exists; notify never pairs the rename or marks our own
//!   events. It goes
//!   through the self-write gate and the unchanged drop like `Data(Content)`,
//!   so our ⌘S is `SelfWrite` or `IgnoredUnchanged` (the save refresh stored
//!   its bytes) and an external replace with other bytes or a new mtime emits.
//!   No new outcome and no IPC change. A renamed or created path that is
//!   gone stays ignored (moved away, D107); a `Remove` on a gone path is the
//!   real delete and stays `deleted`. Before D152 every `Remove` was
//!   `deleted`: with D116's per-kind keys the `Remove` of an external atomic
//!   save emitted "deleted" for a file that exists.
//! - **No wildcard arm** on the kind match, so a new `EventKind` is a compile
//!   error here rather than a silent drop; o14 pins it on the source text.
//! - Split out of `file_watcher.rs` (D68 WI-1) so the parent keeps headroom
//!   under the 300-line limit and the routing has one file to edit.

use notify::event::ModifyKind;
use notify::{Event, EventKind};

use super::baseline::{is_filtered_kind, BaselineStore, UnchangedCheck};
use super::gate::{is_debounced, is_self_write, DebounceMap};
use super::{FileChangedEvent, WatchOutcome};

/// Tauri-free routing for one notify event: the `file:changed` payload to
/// emit (if any) and the reason. Order matters: the kind is matched first (so
/// ignored kinds never touch the debounce map), then the path count, then the
/// self-write check (`Modify` and replaced files only, and before the
/// debounce check so a save never records a debounce entry), then the D32
/// drop: a `Modify(Metadata(Extended))`, `Modify(Metadata(Any))` or
/// `Modify(Data(Content))`, or a replaced file, whose first path is
/// unchanged since its baseline, read coherently (ADR-0068), is
/// `IgnoredUnchanged`, again before the debounce check. Then the debounce
/// check keyed by the first path and the change type it would emit (D116),
/// so one kind's entry never debounces another kind. Only an emitted
/// `modified` advances the baseline, and only for an already-registered path.
/// The third value is the check's answer (`Unchanged` only on
/// `IgnoredUnchanged`; a fail-open reason on a later debounce or emit) or
/// `NotChecked` for an event that returned before it or is not checked.
///
/// A **replaced file** (ADR-0072, D68/D101, D152) is a single-path
/// `Modify(Name(_))` (any mode), a `Create(_)` or a `Remove(_)` whose first
/// path still exists: another inode was renamed onto the watched name, by an
/// external editor's atomic save or by our own `atomic_write`, and FSEvents
/// reports that save as a `Create`, a `Remove` and a rename for the one path.
/// It routes as a `modified` candidate. The same rename whose path is gone
/// (moved away) is `IgnoredRenameSinglePath`; a `Create` on a missing path is
/// `IgnoredKind`; a `Remove` on a missing path is a real delete, `deleted`
/// and not checked. A `Remove` on a missing path and two-path renames are
/// not self-write-gated. The existence check is a stat under no lock; each
/// lock (self-write, baseline, debounce) is taken alone, and the baseline's
/// file I/O runs under none of them.
pub(super) fn process_event_checked(
    event: &Event,
    debounce_map: &DebounceMap,
    baselines: &BaselineStore,
    timestamp: i64,
) -> (Option<FileChangedEvent>, WatchOutcome, UnchangedCheck) {
    let not_checked = UnchangedCheck::NotChecked;
    let first_exists = || event.paths.first().is_some_and(|p| p.exists());
    let (change_type, outcome, replaced) = match event.kind {
        EventKind::Modify(ModifyKind::Name(_)) => ("renamed", WatchOutcome::EmittedRenamed, false),
        EventKind::Modify(_) => ("modified", WatchOutcome::EmittedModified, false),
        EventKind::Create(_) | EventKind::Remove(_) if first_exists() => {
            ("modified", WatchOutcome::EmittedModified, true)
        }
        EventKind::Remove(_) => ("deleted", WatchOutcome::EmittedDeleted, false),
        EventKind::Any | EventKind::Access(_) | EventKind::Create(_) | EventKind::Other => {
            return (None, WatchOutcome::IgnoredKind, not_checked);
        }
    };
    let Some(path) = event.paths.first() else {
        return (None, WatchOutcome::IgnoredNoPath, not_checked);
    };
    let (change_type, outcome, replaced, new_path) = if outcome == WatchOutcome::EmittedRenamed {
        match event.paths.get(1) {
            Some(to) => (
                change_type,
                outcome,
                false,
                Some(to.to_string_lossy().to_string()),
            ),
            None if path.exists() => ("modified", WatchOutcome::EmittedModified, true, None),
            None => return (None, WatchOutcome::IgnoredRenameSinglePath, not_checked),
        }
    } else {
        (change_type, outcome, replaced, None)
    };
    if outcome == WatchOutcome::EmittedModified && is_self_write(path) {
        return (None, WatchOutcome::SelfWrite, not_checked);
    }
    let check = if replaced || is_filtered_kind(&event.kind) {
        baselines.is_unchanged_why(path)
    } else {
        not_checked
    };
    if check == UnchangedCheck::Unchanged {
        return (None, WatchOutcome::IgnoredUnchanged, check);
    }
    if is_debounced(path, change_type, debounce_map) {
        return (None, WatchOutcome::Debounced, check);
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
    (Some(emitted), outcome, check)
}

/// `process_event_checked` without the check's reason, for the routing
/// tests that predate it (D112-WI-2).
#[cfg(test)]
pub(super) fn process_event(
    event: &Event,
    debounce_map: &DebounceMap,
    baselines: &BaselineStore,
    timestamp: i64,
) -> (Option<FileChangedEvent>, WatchOutcome) {
    let (emitted, outcome, _) = process_event_checked(event, debounce_map, baselines, timestamp);
    (emitted, outcome)
}

#[cfg(test)]
#[path = "file_watcher_route_replace_tests.rs"]
mod replace_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_route_own_save_tests.rs"]
mod own_save_tests;

#[cfg(test)]
#[path = "file_watcher_route_debounce_kind_tests.rs"]
mod debounce_kind_tests;

#[cfg(test)]
#[path = "file_watcher_route_remove_present_tests.rs"]
mod remove_present_tests;
