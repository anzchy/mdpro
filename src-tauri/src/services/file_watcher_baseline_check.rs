//! Why the D32 unchanged-file check answered as it did (D112-WI-2).
//!
//! Purpose: hold `BaselineStore::is_unchanged_why`, which answers the
//! watcher's "is this file what it was at the last advance?" with a reason,
//! and `is_unchanged`, its boolean. The reason is one closed `UnchangedCheck`
//! variant whose snake_case `as_str()` the `file.watch.event` line carries in
//! `unchangedCheck`, so a device report can tell an own save whose
//! event-time read was torn (`unstable`) from a real external change
//! (`stat_differs`, `hash_differs`).
//!
//! Pipeline (`is_unchanged_why`): copy the slot out under the lock (none:
//! `no_entry`; no stat or no hash: `no_baseline`); outside it, one
//! `read_once_upto` (file_watcher_baseline_read.rs; cap: the larger of
//! `HASH_CAP_BYTES` and the stored size): an io error is `read_failed`, a
//! torn read `unstable`, a read past the cap `over_cap`; then the read's
//! `(mtime, size)` (`stat_differs`) and hash (`hash_differs`) against the
//! slot; then a second copy-out must show the same generation (`gen_moved`,
//! D109). Only then `unchanged`.
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; mounts this
//! file with `#[path]` and re-exports `UnchangedCheck`; `copy_out`,
//! `baseline_key`, `HASH_CAP_BYTES`), file_watcher_baseline_read.rs
//! (`read_once_upto`, `hash_bytes`), file_watcher_route.rs
//! (`process_event_checked` calls `is_unchanged_why` and records
//! `NotChecked` where it does not), file_watcher_log.rs
//! (`build_watch_event_log` writes `as_str()`), file_watcher_baseline_seam.rs
//! (`is_unchanged_with` wraps `is_unchanged`),
//! file_watcher_baseline_lock_tests.rs (B18′ scans this file),
//! file_watcher_baseline_check_tests.rs
//!
//! Key decisions:
//! - **Same answer as the bool it replaced.** `is_unchanged` is
//!   `is_unchanged_why(..) == Unchanged`; the copy-out, the cap, the one read
//!   (one `read_once*` call per check) and the generation check are
//!   unchanged, and every case but `Unchanged` still fails open.
//! - **The read is `read_once_upto`, not `coherent_read_upto`,** because the
//!   latter folds a failed, torn and over-cap read into one `None`.
//! - **Torn before over-cap.** An unstable read is reported as `unstable`
//!   whatever its length: the length of a torn read proves nothing.
//! - **`not_checked` is the route's.** `is_unchanged_why` never returns it;
//!   `process_event_checked` records it for an event it never checks.
//! - **Closed vocabulary**: `as_str` is an exhaustive match, `ALL` (test-only)
//!   lists every variant, and a device brief greps for these strings.

use super::read::read_once_upto;
use super::{baseline_key, hash_bytes, BaselineStore, Slot, HASH_CAP_BYTES};
use std::path::Path;

/// Why the unchanged-file check did or did not drop an event (D112-WI-2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum UnchangedCheck {
    /// The route never called the check for this event.
    NotChecked,
    /// Proven equal to the baseline: the event is dropped.
    Unchanged,
    /// No baseline slot for the path.
    NoEntry,
    /// A slot whose stat or hash is unknown (a missing, unreadable, torn,
    /// over-cap or directory register).
    NoBaseline,
    /// The open, the fstat or the read returned an io error.
    ReadFailed,
    /// The read was torn: the handle or the path moved during it.
    Unstable,
    /// The file is longer than the cap.
    OverCap,
    /// A stable read whose `(mtime, size)` differs from the stored stat.
    StatDiffers,
    /// Same stat, different bytes.
    HashDiffers,
    /// A register or remove landed during the read (D109).
    GenMoved,
}

impl UnchangedCheck {
    /// Every variant, for the tests that enumerate the domain.
    #[cfg(test)]
    pub(crate) const ALL: [UnchangedCheck; 10] = [
        UnchangedCheck::NotChecked,
        UnchangedCheck::Unchanged,
        UnchangedCheck::NoEntry,
        UnchangedCheck::NoBaseline,
        UnchangedCheck::ReadFailed,
        UnchangedCheck::Unstable,
        UnchangedCheck::OverCap,
        UnchangedCheck::StatDiffers,
        UnchangedCheck::HashDiffers,
        UnchangedCheck::GenMoved,
    ];

    /// The `unchangedCheck` value of the `file.watch.event` line.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            UnchangedCheck::NotChecked => "not_checked",
            UnchangedCheck::Unchanged => "unchanged",
            UnchangedCheck::NoEntry => "no_entry",
            UnchangedCheck::NoBaseline => "no_baseline",
            UnchangedCheck::ReadFailed => "read_failed",
            UnchangedCheck::Unstable => "unstable",
            UnchangedCheck::OverCap => "over_cap",
            UnchangedCheck::StatDiffers => "stat_differs",
            UnchangedCheck::HashDiffers => "hash_differs",
            UnchangedCheck::GenMoved => "gen_moved",
        }
    }
}

impl BaselineStore {
    /// Why `raw` is or is not unchanged since its baseline (ADR-0068
    /// decision 3, D112-WI-2). `Unchanged` only if `raw` has an entry with a
    /// stored stat and hash, one stable read of at most the cap (the larger
    /// of `HASH_CAP_BYTES` and the stored size; only a save or the Save As
    /// seed can store a hashed size past it, and that size is always the
    /// written length, D112, D129) has the stored `(mtime, size)` and hash,
    /// and the slot generation did not move across the read (D109). Every
    /// other answer fails open. Never `NotChecked`. I/O runs unlocked.
    pub(crate) fn is_unchanged_why(&self, raw: &Path) -> UnchangedCheck {
        let key = baseline_key(raw);
        let Some(Slot { entry, gen }) = self.copy_out(&key) else {
            return UnchangedCheck::NoEntry;
        };
        let (Some(stat), Some(hash)) = (entry.stat, entry.hash) else {
            return UnchangedCheck::NoBaseline;
        };
        let cap = HASH_CAP_BYTES.max(stat.1);
        let Ok(read) = read_once_upto(raw, cap) else {
            return UnchangedCheck::ReadFailed;
        };
        if !read.stable {
            return UnchangedCheck::Unstable;
        }
        if read.over_cap {
            return UnchangedCheck::OverCap;
        }
        if read.s1 != stat {
            return UnchangedCheck::StatDiffers;
        }
        if hash_bytes(&read.bytes) != hash {
            return UnchangedCheck::HashDiffers;
        }
        if self.copy_out(&key).is_some_and(|slot| slot.gen == gen) {
            UnchangedCheck::Unchanged
        } else {
            UnchangedCheck::GenMoved
        }
    }

    /// `is_unchanged_why(raw) == Unchanged`: the boolean the routing tests
    /// and the read seam (`is_unchanged_with`) use. Test-only since the
    /// route asks `is_unchanged_why` (D112-WI-2).
    #[cfg(test)]
    pub(crate) fn is_unchanged(&self, raw: &Path) -> bool {
        self.is_unchanged_why(raw) == UnchangedCheck::Unchanged
    }
}

#[cfg(test)]
#[cfg(unix)]
#[path = "file_watcher_baseline_check_tests.rs"]
mod tests;
