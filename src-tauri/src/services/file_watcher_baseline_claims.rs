//! Which raw spellings hold each canonical baseline entry (D106).
//!
//! Purpose: two spellings of one file (a symlinked directory, `/tmp` and
//! `/private/tmp`) canonicalise to one key and share one entry. Removing
//! spelling A must drop only A's claim; the entry goes when no spelling
//! still holds it. `Inner::claim` and `Inner::release` keep the `raw -> key`
//! record (`Inner.keys`) and the entry map in step.
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; `put` and
//! `take` call these under lock L5 after the ticket check),
//! file_watcher_baseline_gen.rs (the per-spelling ticket rule that decides
//! whether a claim or release lands at all), services/file_watcher.rs
//! (`watch` / `unwatch` per raw spelling; its watch list keeps raw strings)
//!
//! Key decisions:
//! - **A claim is the `keys` record.** A spelling holds key K exactly while
//!   `keys[raw] == K`, so no second map can drift from it. Releasing scans
//!   `keys` for another holder: one record per registered spelling, bounded
//!   by the open documents.
//! - **A second register through a new spelling overwrites the entry**, as
//!   any register does (ADR-0068 decision 4). Only removal is shared.
//! - **Tickets stay per spelling** (`Inner.latest`, D86 WI-2): a remove
//!   through A, however old relative to B's register, releases only A's
//!   claim; a register through A older than A's own remove is skipped before
//!   it reaches `claim`, so it cannot revive A.
//! - **Pure map edits.** They run inside the parent's map helpers with the
//!   guard held, so they do no I/O and take no lock.
use super::{Inner, Slot};
use std::path::{Path, PathBuf};

impl Inner {
    /// Record that `raw` holds `key` and store `slot` under it, overwriting
    /// any entry. If `raw` held a different key before, that entry goes
    /// only when no other spelling still holds it.
    pub(super) fn claim(&mut self, raw: &Path, key: PathBuf, slot: Slot) {
        if let Some(previous) = self.keys.insert(raw.to_path_buf(), key.clone()) {
            if previous != key {
                self.drop_if_unclaimed(&previous);
            }
        }
        self.entries.insert(key, slot);
    }

    /// Drop `raw`'s claim on its recorded key (`fallback` when none is
    /// recorded); the entry goes only when no other spelling holds it.
    pub(super) fn release(&mut self, raw: &Path, fallback: PathBuf) {
        let key = self.keys.remove(raw).unwrap_or(fallback);
        self.drop_if_unclaimed(&key);
    }

    fn drop_if_unclaimed(&mut self, key: &Path) {
        if !self.keys.values().any(|held| held == key) {
            self.entries.remove(key);
        }
    }
}

#[cfg(test)]
#[path = "file_watcher_baseline_spelling_tests.rs"]
mod spelling_tests;
