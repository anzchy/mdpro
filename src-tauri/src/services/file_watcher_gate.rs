//! Emission gates for the file watcher: the save self-write set and the
//! per-path debounce check.
//!
//! Purpose: hold the two pieces of state `process_event` consults before a
//! notify event becomes a `file:changed` emission, apart from the routing.
//!
//! @coordinates-with services/file_watcher.rs (parent; mounts this file with
//! `#[path]` and re-exports `mark_write_start` / `mark_write_end`),
//! commands/file.rs (`save_file` brackets its write with the marks)
//!
//! Key decisions:
//! - The self-write set is process-global, so a save from any window
//!   suppresses the watcher event for that path.
//! - The debounce map is owned by the watcher and keyed by the event's first
//!   path; a debounced event does not refresh its entry.
//! - Gate order in `process_event` (ADR-0068): self-write, then the D32
//!   unchanged-file drop (`file_watcher_baseline.rs`), then debounce. So
//!   neither a save nor a dropped event records a debounce entry, and a
//!   debounced event never advances the baseline.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Minimum interval between emitting events for the same file path.
const DEBOUNCE_INTERVAL: Duration = Duration::from_millis(500);

/// Global set of paths currently being written by `save_file`.
/// Events for these paths are suppressed to avoid false "externally modified" prompts.
fn write_in_progress() -> &'static Mutex<HashSet<PathBuf>> {
    static SET: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Mark a path as being written to (call before `fs::write`).
pub fn mark_write_start(path: &Path) {
    if let Ok(mut set) = write_in_progress().lock() {
        set.insert(path.to_path_buf());
    }
}

/// Clear the write-in-progress mark (call after `fs::write` completes).
pub fn mark_write_end(path: &Path) {
    if let Ok(mut set) = write_in_progress().lock() {
        set.remove(path);
    }
}

/// Returns `true` if the path is currently being written by `save_file`.
pub(super) fn is_self_write(path: &Path) -> bool {
    if let Ok(set) = write_in_progress().lock() {
        set.contains(path)
    } else {
        false
    }
}

/// Returns `true` if the event for `path` should be suppressed (fired too recently).
pub(super) fn is_debounced(path: &Path, debounce_map: &Mutex<HashMap<PathBuf, Instant>>) -> bool {
    let now = Instant::now();
    if let Ok(mut map) = debounce_map.lock() {
        if let Some(last) = map.get(path) {
            if now.duration_since(*last) < DEBOUNCE_INTERVAL {
                return true;
            }
        }
        map.insert(path.to_path_buf(), now);
    }
    false
}
