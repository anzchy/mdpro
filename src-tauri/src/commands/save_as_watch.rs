//! Purpose: register a Save As target with the file watcher (D69). Before
//! this, only `open_file` / `open_file_dialog` registered, so a file first
//! saved through the Save As dialog (an untitled document's first ⌘S) was
//! never watched: an external edit raised no prompt and the next ⌘S
//! silently overwrote it.
//!
//! Pipeline: `save_file_dialog` (dialog only) → [`save_as_watched_with`] →
//! `save_file_written` (the whole `save_file` body; returns the encoded bytes
//! it wrote) → on `Ok`: `seed_for_written(path, written)` →
//! `FileWatcher::watch_seeded(path, seed)`, which logs `file.watch.register`.
//!
//! Key decisions:
//! - **Save first, register only on `Ok`.** A failed save returns its error
//!   unchanged and leaves the watcher untouched; a cancelled dialog never
//!   reaches this seam.
//! - **Seeded, never a snapshot** (D86 ②, D112: baseline = the bytes the
//!   editor holds). Plain `watch` re-reads the disk, so a write landing
//!   between our rename and that read would be baselined and its event
//!   dropped as unchanged. The seed is the stat now plus the hash of the
//!   written bytes, uncapped; a stat whose size is not the written length
//!   is stored as `None` (fail open, D129).
//! - **The registered string is `SaveResult.path`**, the dialog's path as
//!   given, with no canonicalisation: it is what the frontend stores as the
//!   document path and later hands to `close_document`'s `unwatch`, like the
//!   string `open_file` registers. (The baseline key is canonicalised inside
//!   the store either way.)
//! - **The old path is not unwatched.** Another tab may hold it.
//! - No new log line: `watch_seeded` already writes the register line,
//!   after the `file.save` success line.
//!
//! @coordinates-with commands/file.rs — `save_file_dialog` calls this seam;
//!   `save_file_written` is the save body it runs
//! @coordinates-with services/file_watcher_seed.rs — `watch_seeded`
//! @coordinates-with services/file_watcher_baseline_seed.rs — `seed_for_written`
//! @coordinates-with commands/draft_recover_watch.rs — the D59 sibling seam

use crate::services::file_watcher::seed::seed_for_written;
use crate::services::file_watcher::FileWatcher;
use std::path::Path;

use super::file::{save_file_written, FileError, SaveResult};

/// Save `content` to `path` (the path the Save As dialog returned) exactly
/// as `save_file` would, then, only if the save succeeded, watch `path`
/// seeded from the bytes written. Returns the save result unchanged.
pub(crate) async fn save_as_watched_with(
    document_id: String,
    content: String,
    path: String,
    encoding: Option<String>,
    line_ending: Option<String>,
    action_id: Option<String>,
    watcher: &FileWatcher,
) -> Result<SaveResult, FileError> {
    let (result, written) = save_file_written(
        document_id,
        content,
        Some(path),
        encoding,
        line_ending,
        action_id,
        watcher.baselines(),
    )
    .await?;
    between_save_and_register();
    let target = Path::new(&result.path);
    watcher.watch_seeded(target, seed_for_written(target, &written));
    Ok(result)
}

/// Production no-op; the test build runs the installed hook here.
#[cfg(not(test))]
fn between_save_and_register() {}

#[cfg(test)]
use hook::between_save_and_register;

/// Test-only seam: run code after the save returned and before the watch
/// is registered, the window a re-snapshot would baseline.
#[cfg(test)]
pub(crate) mod hook {
    use std::cell::RefCell;

    type Hook = Box<dyn FnOnce()>;

    thread_local! {
        static HOOK: RefCell<Option<Hook>> = RefCell::new(None);
    }

    /// Clears this thread's hook on drop, fired or not.
    pub(crate) struct HookGuard;
    impl Drop for HookGuard {
        fn drop(&mut self) {
            HOOK.with(|h| h.borrow_mut().take());
        }
    }

    /// Install `hook` for the next Save As on this thread.
    pub(crate) fn install(hook: impl FnOnce() + 'static) -> HookGuard {
        HOOK.with(|h| *h.borrow_mut() = Some(Box::new(hook)));
        HookGuard
    }

    pub(super) fn between_save_and_register() {
        if let Some(hook) = HOOK.with(|h| h.borrow_mut().take()) {
            hook();
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_watch_tests.rs"]
mod tests;
