//! `release_watch_hold`: a window gives up its hold on a watched path (D173,
//! ADR-0086 decision 3).
//!
//! Purpose: the frontend's half of the close rule. Once no document in a
//! window holds a path, the window's `watchHolds` subscription calls this
//! with the latest `holdGen` it saw; the hold goes only if that gen is still
//! current, and the watch goes only when no window holds any spelling of the
//! file. `close_document` no longer touches the watcher.
//!
//! Key decisions:
//! - **The window label comes from Tauri, never from JS**, so a window can
//!   release only its own holds.
//! - **Validate before releasing** (rule 60): the path must be non-empty,
//!   absolute and pass `validate_file_path` (no `..`, a document
//!   extension), and gen 0 is refused because it is never issued. A refused
//!   request is an `Err` and touches nothing.
//! - The reply is the `ReleaseOutcome` (camelCase); `stale` and `notHeld`
//!   are answers, not errors.
//!
//! @coordinates-with services/file_watcher_holders.rs (`release_hold`),
//! commands/file.rs (`validate_file_path`; the acquisitions and their
//! `holdGen`), src/services/fileService.ts (`releaseWatchHold`),
//! src/utils/watchHolds.ts (the caller)
use super::file::validate_file_path;
use crate::services::file_watcher::holders::ReleaseOutcome;
use crate::services::file_watcher::FileWatcher;
use std::path::Path;
use tauri::{State, Window};

/// Release the calling window's hold on `path` at `gen`.
#[tauri::command]
pub async fn release_watch_hold(
    window: Window,
    path: String,
    gen: u64,
    watcher: State<'_, FileWatcher>,
) -> Result<ReleaseOutcome, String> {
    release_watch_hold_with(window.label(), &path, gen, &watcher)
}

/// The testable body of [`release_watch_hold`]: validate, then release.
pub(crate) fn release_watch_hold_with(
    label: &str,
    path: &str,
    gen: u64,
    watcher: &FileWatcher,
) -> Result<ReleaseOutcome, String> {
    if gen == 0 {
        return Err("gen 0 is never issued".to_string());
    }
    if path.is_empty() || !Path::new(path).is_absolute() {
        return Err("path must be absolute".to_string());
    }
    validate_file_path(path).map_err(|e| format!("invalid path: {e:?}"))?;
    Ok(watcher.release_hold(label, Path::new(path), gen))
}

#[cfg(test)]
#[path = "watch_hold_tests.rs"]
// D173-WI-1-rust: recorded red spec, bytes are the receipt's evidence
#[rustfmt::skip]
mod tests;
