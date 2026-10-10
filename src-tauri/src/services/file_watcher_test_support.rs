//! Purpose: test-only constructor and list reader for `FileWatcher` (D59 WI-1).
//! `FileWatcher::new` needs an `AppHandle`, which no test can build (the crate
//! has no `tauri::test` feature), so a test can neither build a watcher nor
//! read the paths it watches.
//!
//! Key decisions:
//! - **A fixture around the real notify watcher, not a double.** `for_tests`
//!   builds a real `RecommendedWatcher` (FSEvents on macOS) with a no-op
//!   event handler, as `file_watcher_register_live_tests.rs` does; `watch` /
//!   `unwatch` run the production `apply_watch` unchanged.
//! - **Each instance owns its list**, so parallel tests never share state.
//! - Wired `#[cfg(test)] #[path] mod` from `file_watcher.rs`: no production
//!   surface, and a child module so it may read the private fields.
//!
//! @coordinates-with src-tauri/src/services/file_watcher.rs (parent)
//! @coordinates-with src-tauri/src/commands/draft_recover_watch_tests.rs
use super::FileWatcher;
use notify::{Config, Event, RecommendedWatcher, Watcher};
use std::sync::{Arc, Mutex};

impl FileWatcher {
    /// A `FileWatcher` over a real notify watcher whose events go nowhere.
    pub(crate) fn for_tests() -> Self {
        let watcher = RecommendedWatcher::new(|_: notify::Result<Event>| {}, Config::default())
            .expect("create a real notify watcher");
        Self {
            watcher: Mutex::new(watcher),
            watched_paths: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// A copy of the watch list, in registration order.
    pub(crate) fn watched(&self) -> Vec<String> {
        self.watched_paths
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}
