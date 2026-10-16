//! Emission gates for the file watcher: the save self-write set and the
//! per-(path, kind) debounce check.
//!
//! Purpose: hold the two pieces of state `process_event` consults before a
//! notify event becomes a `file:changed` emission, apart from the routing.
//!
//! @coordinates-with services/file_watcher.rs (parent; mounts this file with
//! `#[path]` and re-exports `mark_write_start` / `mark_write_end`),
//! file_watcher_route.rs (`process_event` consults both gates),
//! commands/file.rs (`save_file` brackets its write with the marks),
//! file_watcher_gate_key_tests.rs (D190-WI-2)
//!
//! Key decisions:
//! - The self-write marks are process-global, so a save from any window
//!   suppresses the watcher event for that path, for every window. That is
//!   only the watcher route: since D173-WI-2 (ADR-0086) the other windows
//!   holding the file learn of the save from the save notice
//!   (file_watcher_save_notice.rs, `file:changed` with `origin`), not from
//!   this event.
//! - **One normalised key, counted** (D190-WI-2, ADR-0093). A mark and an
//!   event match by `gate_key` (canonical path, verbatim prefix stripped),
//!   computed outside the mutex, so the Windows save's `\\?\C:\…` mark meets
//!   the watched `C:\…` event. Marks are counted per key, so overlapping
//!   saves of one path stay marked until the last ends. The mark is still
//!   only the synchronous bracket around the write: no timed window
//!   (ADR-0068 decision 7).
//! - The debounce map is owned by the watcher and keyed by the event's first
//!   path (raw, ADR-0068 decision 5) **and the change type it would emit**
//!   (`modified` / `deleted` / `renamed`; D116). Same kind on the same path
//!   inside 500 ms is debounced; another kind is never swallowed by it, so a
//!   replace then a delete reports the delete, and a delete then a
//!   replacement (a safe save, D107) reports the new file. Exempting `Remove`
//!   alone was rejected: it fixes only the first order and lets a burst of
//!   `Remove`s through. A debounced event does not refresh its entry.
//! - **An emission clears its path's other kinds** (ADR-0111, D246 H-1).
//!   A change of state restarts the window: after `modified`, `deleted`,
//!   then a recreate inside 500 ms, the stale (path, `modified`) entry used
//!   to swallow the recreate and leave the deleted prompt over a file that
//!   exists. A repeat of the same state is still absorbed, and other paths'
//!   entries are untouched.
//! - Gate order in `process_event` (ADR-0068): self-write, then the D32
//!   unchanged-file drop (`file_watcher_baseline.rs`), then debounce. So
//!   neither a save nor a dropped event records a debounce entry, and a
//!   debounced event never advances the baseline.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Minimum interval between emitting events for the same file path.
const DEBOUNCE_INTERVAL: Duration = Duration::from_millis(500);

/// Global count of in-flight `save_file` writes per normalised path
/// (`gate_key`). Events for these paths are suppressed to avoid false
/// "externally modified" prompts. A count, not a set (D190-WI-2): the first
/// of two overlapping saves of one path must not unmark the second.
fn write_in_progress() -> &'static Mutex<HashMap<PathBuf, usize>> {
    static MARKS: OnceLock<Mutex<HashMap<PathBuf, usize>>> = OnceLock::new();
    MARKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Mark a path as being written to (call before the write). Counts: each
/// mark needs its own `mark_write_end`. The key is computed before the lock.
pub fn mark_write_start(path: &Path) {
    let key = gate_key(path);
    if let Ok(mut marks) = write_in_progress().lock() {
        *marks.entry(key).or_insert(0) += 1;
    }
}

/// End one write-in-progress mark (call after the write completes). The
/// path stays marked while another save of it is still in flight; an end
/// with no mark to end does nothing.
pub fn mark_write_end(path: &Path) {
    let key = gate_key(path);
    if let Ok(mut marks) = write_in_progress().lock() {
        if let Some(n) = marks.get_mut(&key) {
            *n -= 1;
            if *n == 0 {
                marks.remove(&key);
            }
        }
    }
}

/// Returns `true` if the path, under any spelling `gate_key` folds
/// together, is currently being written by `save_file`.
pub(super) fn is_self_write(path: &Path) -> bool {
    let key = gate_key(path);
    if let Ok(marks) = write_in_progress().lock() {
        marks.contains_key(&key)
    } else {
        false
    }
}

/// The key a save's mark and a watcher event share (D190-WI-2, ADR-0093):
/// the canonical path; for a file that does not exist yet (a save to a new
/// path), its canonical parent joined with its name; failing both, the
/// absolute lexical path, then the raw path. Any Windows verbatim prefix is
/// then stripped (`strip_verbatim`), so `canonicalize`'s `\\?\C:\…` and the
/// watched `C:\…` meet. Does file-system I/O: callers run it before the lock.
pub(super) fn gate_key(path: &Path) -> PathBuf {
    let resolved = std::fs::canonicalize(path)
        .ok()
        .or_else(|| {
            let parent = std::fs::canonicalize(path.parent()?).ok()?;
            Some(parent.join(path.file_name()?))
        })
        .or_else(|| std::path::absolute(path).ok())
        .unwrap_or_else(|| path.to_path_buf());
    strip_verbatim(&resolved)
}

/// `path` without a Windows verbatim prefix: `\\?\X:\…` becomes `X:\…` and
/// `\\?\UNC\server\share\…` becomes `\\server\share\…`. Every other path
/// (plain, device `\\.\`, volume GUID, any Unix path, non-UTF-8) is
/// returned unchanged. Pure string work, so it runs and is tested on every
/// host; a Unix path from `gate_key` is absolute and never starts with
/// `\\?\`. Duplicates the verbatim rule D190-WI-5's `path_plain` will own;
/// fold it in when that lands.
pub(super) fn strip_verbatim(path: &Path) -> PathBuf {
    const VERBATIM: &str = r"\\?\";
    let Some(rest) = path.to_str().and_then(|s| s.strip_prefix(VERBATIM)) else {
        return path.to_path_buf();
    };
    if rest.len() >= 4 && rest.as_bytes()[..4].eq_ignore_ascii_case(br"UNC\") {
        return PathBuf::from(format!(r"\\{}", &rest[4..]));
    }
    let b = rest.as_bytes();
    let is_disk = b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':';
    if is_disk && (b.len() == 2 || b[2] == b'\\') {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

/// A debounce entry's key: the event's first path and the change type it
/// would emit (`modified` / `deleted` / `renamed`).
pub(crate) type DebounceKey = (PathBuf, &'static str);

/// The watcher's debounce map: when each key last emitted.
pub(crate) type DebounceMap = Mutex<HashMap<DebounceKey, Instant>>;

/// Returns `true` if an event for `path` that would emit `kind` should be
/// suppressed: the same (path, kind) emitted less than `DEBOUNCE_INTERVAL`
/// ago (D116). Another kind's entry on the same path never suppresses it.
/// A suppressed event does not refresh the entry; a passing one records it
/// and drops the same path's entries of every other kind (ADR-0111), so the
/// next change of state is not swallowed by an older one.
pub(super) fn is_debounced(path: &Path, kind: &'static str, debounce_map: &DebounceMap) -> bool {
    let now = Instant::now();
    let key = (path.to_path_buf(), kind);
    if let Ok(mut map) = debounce_map.lock() {
        if let Some(last) = map.get(&key) {
            if now.duration_since(*last) < DEBOUNCE_INTERVAL {
                return true;
            }
        }
        map.retain(|(p, k), _| p != path || *k == kind);
        map.insert(key, now);
    }
    false
}

#[cfg(test)]
#[path = "file_watcher_gate_key_tests.rs"]
mod key_tests;
