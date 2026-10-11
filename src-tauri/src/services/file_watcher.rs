//! The file watcher: notify registration, the D32 baselines, and the
//! `file:changed` / `theme:changed` emits.
//!
//! Purpose: own the notify watcher and its watch list, route each notify
//! event through `process_event_checked` (file_watcher_route.rs), log one
//! `file.watch.event` line per event, and emit what the route returns.
//!
//! @coordinates-with file_watcher_route.rs (`process_event_checked`; the
//! test-only `process_event` drops its `UnchangedCheck`),
//! file_watcher_gate.rs, file_watcher_outcome.rs, file_watcher_baseline.rs,
//! file_watcher_seed.rs, file_watcher_log.rs (all mounted here with `#[path]`),
//! commands/file.rs (`watch_seeded`, `mark_write_*`, the baseline refresh),
//! commands/save_as_watch.rs (`watch_seeded` for a Save As target, D69)

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};
use tauri::{AppHandle, Emitter, Theme};

use crate::models::log_entry::LogEntryPayload;
use crate::services::logger;
use baseline::next_ticket;
#[cfg(test)]
pub(crate) use baseline::snapshot;
/// `save_file` refreshes through it (ADR-0068 decision 4).
pub(crate) use baseline::BaselineStore;
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

#[path = "file_watcher_route.rs"]
mod route;
#[cfg(test)]
use route::process_event;
use route::process_event_checked;

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

/// Route one notify event and describe it: `process_event_checked` (which
/// consults `baselines` for the D32 drop and says why, D112-WI-2), then one
/// `stat_of(paths[0])` when there is a path, then the `file.watch.event`
/// line, which carries the check's reason as `unchangedCheck`. Every event yields exactly one
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
    let (emitted, outcome, check) =
        process_event_checked(event, debounce_map, baselines, timestamp);
    let stat = event.paths.first().and_then(|path| stat_of(path));
    let line = build_watch_event_log(event, outcome, check, emitted.as_ref(), stat, timestamp);
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

#[cfg(test)]
#[path = "file_watcher_observe_check_tests.rs"]
mod observe_check_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_register_live_tests.rs"]
mod register_live_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_test_support_tests.rs"]
mod test_support_tests;
