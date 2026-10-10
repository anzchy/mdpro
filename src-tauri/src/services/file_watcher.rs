use notify::event::ModifyKind;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};
use tauri::{AppHandle, Emitter, Theme};

use crate::models::log_entry::LogEntryPayload;
use crate::services::logger;
#[cfg(test)]
pub(crate) use baseline::snapshot;
/// `save_file` refreshes through it (ADR-0068 decision 4).
pub(crate) use baseline::BaselineStore;
use baseline::{is_filtered_kind, next_ticket};
use gate::{is_debounced, is_self_write};
pub use gate::{mark_write_end, mark_write_start};
use watch_log::{
    apply_watch_list, build_watch_error_log, build_watch_event_log, build_watch_register_log,
    stat_snapshot, with_baseline, FileStat, WatchOp,
};

#[path = "file_watcher_gate.rs"]
mod gate;

#[path = "file_watcher_outcome.rs"]
mod outcome;
pub(crate) use outcome::WatchOutcome;

#[path = "file_watcher_baseline.rs"]
mod baseline;
#[path = "file_watcher_seed.rs"]
pub(crate) mod seed;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangedEvent {
    pub path: String,
    pub change_type: String,
    pub new_path: Option<String>,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeChangedEvent {
    pub theme: String,
}

pub struct FileWatcher {
    watcher: Mutex<RecommendedWatcher>,
    watched_paths: Arc<Mutex<Vec<String>>>,
    /// D32 baselines (ADR-0068), the same `Arc` the notify callback holds.
    baselines: Arc<BaselineStore>,
}

impl FileWatcher {
    pub fn new(app_handle: AppHandle) -> Result<Self, String> {
        let watched_paths = Arc::new(Mutex::new(Vec::new()));
        let last_events: Arc<Mutex<HashMap<PathBuf, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let debounce_map = Arc::clone(&last_events);
        let baselines = Arc::new(BaselineStore::default());
        let callback_baselines = Arc::clone(&baselines);
        let watcher = RecommendedWatcher::new(
            move |res| match res {
                Ok(event) => handle_event(&app_handle, event, &debounce_map, &callback_baselines),
                Err(e) => logger::log_event(build_watch_error_log(&e)),
            },
            Config::default(),
        )
        .map_err(|e| format!("failed to create watcher: {e}"))?;

        let watcher = Mutex::new(watcher);
        Ok(Self {
            watcher,
            watched_paths,
            baselines,
        })
    }

    /// Watch `path`, record a fresh snapshot as its baseline, overwriting any
    /// (ADR-0068 decision 4), then log one `file.watch.register` line with
    /// notify's Result and what the store did (`context.baseline`). The line
    /// and the store ticket are taken under both locks, so ticket order is
    /// list order; the baseline's read and the log write run after they drop,
    /// and a newer unwatch landing during that read wins (D86 WI-2). The open
    /// path uses `watch_seeded` instead (file_watcher_seed.rs, D86 WI-3).
    pub fn watch(&self, path: &Path) {
        let (line, ticket) = {
            let (Ok(mut watcher), Ok(mut list), ticket) = (
                self.watcher.lock(),
                self.watched_paths.lock(),
                next_ticket(),
            ) else {
                return;
            };
            let line = apply_watch(&mut watcher, &mut list, path, WatchOp::Register);
            (line, ticket)
        };
        let stored = self.baselines.register_at(path, ticket);
        logger::log_event(with_baseline(line, seed::baseline_log(stored, false)));
    }

    /// Unwatch `path`, log one `file.watch.unregister` line with notify's
    /// Result, then drop the baseline `watch` recorded. The line
    /// and the store ticket are taken under both locks; the log write and the
    /// removal run after they drop, and a newer watch wins (D86 WI-2).
    pub fn unwatch(&self, path: &Path) {
        let (line, ticket) = {
            let (Ok(mut watcher), Ok(mut list), ticket) = (
                self.watcher.lock(),
                self.watched_paths.lock(),
                next_ticket(),
            ) else {
                return;
            };
            let line = apply_watch(&mut watcher, &mut list, path, WatchOp::Unregister);
            (line, ticket)
        };
        logger::log_event(line);
        self.baselines.remove_at(path, ticket);
    }

    /// The store the notify callback consults, for `save_file`'s refresh
    /// (ADR-0068 decision 4, D32 WI-6).
    pub(crate) fn baselines(&self) -> &BaselineStore {
        &self.baselines
    }
}

fn emit_file_changed(app_handle: &AppHandle, event: FileChangedEvent) {
    let _ = app_handle.emit("file:changed", event);
}

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
fn process_event(
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

/// Route one notify event and describe it: `process_event` (which consults
/// `baselines` for the D32 drop), then one `stat_of(paths[0])` when there is
/// a path, then the `file.watch.event` line. Every event yields exactly one
/// line, emitted or not, and the line shares `timestamp` with the emitted
/// event (the Rust/frontend join key). The baseline does its own
/// full-precision stat; `stat_of` is still called at most once.
fn observe_event(
    event: &Event,
    debounce_map: &Mutex<HashMap<PathBuf, Instant>>,
    baselines: &BaselineStore,
    timestamp: i64,
    stat_of: impl Fn(&Path) -> Option<FileStat>,
) -> (Option<FileChangedEvent>, LogEntryPayload) {
    let (emitted, outcome) = process_event(event, debounce_map, baselines, timestamp);
    let stat = event.paths.first().and_then(|path| stat_of(path));
    let line = build_watch_event_log(event, outcome, emitted.as_ref(), stat, timestamp);
    (emitted, line)
}

/// Call notify's `watch` / `unwatch` every time (no dedupe), update the
/// list whatever the Result, and return the register line carrying the
/// real Result. `FileWatcher::watch` / `unwatch` delegate here.
fn apply_watch(
    watcher: &mut RecommendedWatcher,
    list: &mut Vec<String>,
    path: &Path,
    op: WatchOp,
) -> LogEntryPayload {
    let result = match op {
        WatchOp::Register => watcher.watch(path, RecursiveMode::NonRecursive),
        WatchOp::Unregister => watcher.unwatch(path),
    };
    let (already_watched, watched_count) = apply_watch_list(list, &path.to_string_lossy(), op);
    let result = result.map_err(|e| e.to_string());
    let stat = stat_snapshot(path);
    build_watch_register_log(op, path, result, already_watched, stat, watched_count)
}

fn handle_event(
    app_handle: &AppHandle,
    event: Event,
    debounce_map: &Arc<Mutex<HashMap<PathBuf, Instant>>>,
    baselines: &BaselineStore,
) {
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let (emitted, line) = observe_event(&event, debounce_map, baselines, timestamp, stat_snapshot);
    logger::log_event(line);
    if let Some(changed) = emitted {
        emit_file_changed(app_handle, changed);
    }
}

pub fn emit_theme_changed(app_handle: &AppHandle, theme: &Theme) {
    let value = match theme {
        Theme::Dark => "dark",
        _ => "light",
    };
    let _ = app_handle.emit(
        "theme:changed",
        ThemeChangedEvent {
            theme: value.to_string(),
        },
    );
}

#[path = "file_watcher_log.rs"]
mod watch_log;

#[cfg(test)]
#[path = "file_watcher_kinds_fixture.rs"]
pub(crate) mod kinds_fixture;

#[cfg(test)]
#[path = "file_watcher_test_support.rs"]
mod test_support;

#[cfg(test)]
#[path = "file_watcher_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "file_watcher_gate_tests.rs"]
mod gate_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_fsevents_tests.rs"]
mod fsevents_tests;

#[cfg(test)]
#[path = "file_watcher_observe_tests.rs"]
mod observe_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_register_live_tests.rs"]
mod register_live_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_test_support_tests.rs"]
mod test_support_tests;
