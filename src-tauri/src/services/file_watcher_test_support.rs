//! Purpose: test-only constructor and readers for `FileWatcher` (D59 WI-1,
//! D32 WI-5). `FileWatcher::new` needs an `AppHandle`, which no test can build
//! (the crate has no `tauri::test` feature), so a test can neither build a
//! watcher, read the paths it watches, nor see the baselines it records.
//!
//! Key decisions:
//! - **A fixture around the real notify watcher, not a double.** `for_tests`
//!   builds a real `RecommendedWatcher` (FSEvents on macOS) with a no-op
//!   event handler, as `file_watcher_register_live_tests.rs` does; `watch` /
//!   `unwatch` run the production `apply_watch` unchanged.
//! - **Each instance owns its list and its baseline store**, so parallel
//!   tests never share state. `baseline_of` reads the store by the path's
//!   current key; `route_for_tests` runs the real `process_event` against
//!   that same store (fresh debounce map, fixed timestamp `T`), which is how
//!   a test proves the store `watch` writes is the store routing reads. The
//!   production sharing in `new` is pinned by L9 (source tripwire) instead.
//! - `route_burst_for_tests` shares one debounce map across a burst and
//!   reports what it left, for the save-then-residual-burst case (WI-6 S10).
//! - Wired `#[cfg(test)] #[path] mod` from `file_watcher.rs`: no production
//!   surface, and a child module so it may read the private fields.
//!
//! @coordinates-with src-tauri/src/services/file_watcher.rs (parent)
//! @coordinates-with src-tauri/src/commands/draft_recover_watch_tests.rs
//! @coordinates-with src-tauri/src/services/file_watcher_baseline_live_tests.rs
//! @coordinates-with src-tauri/src/services/file_watcher_baseline_live_race_tests.rs
//! @coordinates-with src-tauri/src/commands/file_save_baseline_tests.rs
use super::baseline::{BaselineStore, Entry};
use super::kinds_fixture::T;
use super::{process_event, FileChangedEvent, FileWatcher, WatchOutcome};
use notify::{Config, Event, RecommendedWatcher, Watcher};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

impl FileWatcher {
    /// A `FileWatcher` over a real notify watcher whose events go nowhere.
    pub(crate) fn for_tests() -> Self {
        let watcher = RecommendedWatcher::new(|_: notify::Result<Event>| {}, Config::default())
            .expect("create a real notify watcher");
        Self {
            watcher: Mutex::new(watcher),
            watched_paths: Arc::new(Mutex::new(Vec::new())),
            baselines: Arc::new(BaselineStore::default()),
            holders: Default::default(),
        }
    }

    /// `for_tests`, but the real notify watcher sends every event it
    /// delivers to the returned receiver (D173 live tests: the callback is
    /// observed, not just the list and the baseline).
    pub(crate) fn for_tests_recording() -> (Self, std::sync::mpsc::Receiver<Event>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let watcher = RecommendedWatcher::new(
            move |res: notify::Result<Event>| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            },
            Config::default(),
        )
        .expect("create a real notify watcher");
        let fw = Self {
            watcher: Mutex::new(watcher),
            watched_paths: Arc::new(Mutex::new(Vec::new())),
            baselines: Arc::new(BaselineStore::default()),
            holders: Default::default(),
        };
        (fw, rx)
    }

    /// A copy of the watch list, in registration order.
    pub(crate) fn watched(&self) -> Vec<String> {
        self.watched_paths
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// The baseline `watch` recorded for `path`, read by its current key.
    pub(crate) fn baseline_of(&self, path: &Path) -> Option<Entry> {
        self.baselines.get(path)
    }

    /// Route `event` through the real `process_event` with this watcher's
    /// store, a fresh debounce map and the fixed timestamp `T`.
    pub(crate) fn route_for_tests(
        &self,
        event: &Event,
    ) -> (Option<FileChangedEvent>, WatchOutcome) {
        let map = Mutex::new(HashMap::new());
        process_event(event, &map, &self.baselines, T)
    }

    /// Route `events` in order through the real `process_event` with this
    /// watcher's store, ONE shared fresh debounce map and `T` (D32 WI-6, S10).
    /// Also returns how many debounce entries the burst left behind.
    pub(crate) fn route_burst_for_tests(
        &self,
        events: &[Event],
    ) -> (Vec<(Option<FileChangedEvent>, WatchOutcome)>, usize) {
        let map = Mutex::new(HashMap::new());
        let routed = events
            .iter()
            .map(|e| process_event(e, &map, &self.baselines, T))
            .collect();
        let left = map.lock().unwrap_or_else(|e| e.into_inner()).len();
        (routed, left)
    }
}
