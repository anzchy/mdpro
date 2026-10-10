//! `FileWatcher::watch_seeded`: watch a file `open_file` just read, with the
//! baseline entry from that same read (D86 WI-3, finding ②).
//!
//! Purpose: the open path's register. `watch` snapshots the file again after
//! the open decoded it, so a write landing between the open's read and that
//! snapshot is baselined as unchanged and its event dropped. `watch_seeded`
//! stores the entry `read_for_open` built from the bytes the editor holds.
//!
//! @coordinates-with services/file_watcher.rs (parent; `watch` keeps the
//! plain snapshot and is the shape this mirrors), file_watcher_baseline_seed.rs
//! (`read_for_open`, `register_seeded`), file_watcher_register_log.rs
//! (`BaselineLog`, `with_baseline`), commands/file.rs (`open_file` /
//! `open_file_dialog` call `watch_seeded`), commands/file_open_seed.rs
//!
//! Key decisions:
//! - **The same shape as `watch`** (W14, g8): notify through
//!   `apply_watch(…, WatchOp::Register)`, the ticket drawn inside the block
//!   holding both watcher locks, and the store after they drop. The two are
//!   not folded into one helper (plan).
//! - **The log line follows the store**, so its `context.baseline` reports
//!   what was actually stored (`seeded`, `failopen`, or `stale_skipped` when a
//!   newer op on the path won), never an assumed `seeded`.
//! - `watch_seeded` never reads the file: the seed is the open's read.
use super::apply_watch;
use super::baseline::{next_ticket, StoreOutcome};
use super::watch_log::{with_baseline, BaselineLog, WatchOp};
use super::FileWatcher;
use crate::services::logger;
use std::path::Path;

pub(crate) use super::baseline::seed::read_for_open;
pub(crate) use super::baseline::Entry;

impl FileWatcher {
    /// `watch`, storing `seed` (the entry `read_for_open` built from the
    /// bytes the editor holds) instead of a fresh snapshot, so a write that
    /// landed after the open's read is not baselined as unchanged. The seed
    /// overwrites any entry, subject only to the ticket rule (ADR-0068
    /// decision 4, D86 WI-2).
    pub(crate) fn watch_seeded(&self, path: &Path, seed: Entry) {
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
        let stored = self.baselines.register_seeded(path, seed, ticket);
        logger::log_event(with_baseline(line, baseline_log(stored, true)));
    }
}

/// The `context.baseline` value for what a register's store step did.
/// Defined by the entry stored: no hash is `FailOpen` on either path (checked
/// before `seeded`); a skipped store is `StaleSkipped`. A removal, which a
/// register never returns, trips a debug assertion and is `StaleSkipped`.
pub(crate) fn baseline_log(stored: StoreOutcome, seeded: bool) -> BaselineLog {
    match stored {
        StoreOutcome::Stored(entry) if entry.hash.is_none() => BaselineLog::FailOpen,
        StoreOutcome::Stored(_) if seeded => BaselineLog::Seeded,
        StoreOutcome::Stored(_) => BaselineLog::Snapshot,
        StoreOutcome::StaleSkipped => BaselineLog::StaleSkipped,
        // Only the remove step (`unwatch`) yields `Removed`; a register never does.
        StoreOutcome::Removed => {
            debug_assert!(false, "a register store returned StoreOutcome::Removed");
            BaselineLog::StaleSkipped
        }
    }
}

// Test-only items stay last: the W14 scan stops at the first test cfg.
#[cfg(test)]
pub(crate) use super::baseline::seed::kit;

#[cfg(test)]
#[path = "file_watcher_seed_tests.rs"]
mod tests;
