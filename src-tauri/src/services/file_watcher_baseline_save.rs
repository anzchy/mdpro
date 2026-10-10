//! The save refresh for the D32 baseline store (ADR-0068 decision 4).
//!
//! Purpose: after `save_file` writes a file, advance its baseline to the
//! bytes the save wrote, and only to those (`BaselineStore::refresh_after_save`).
//!
//! Pipeline: `copy_out` the slot (presence and generation) → test seam →
//! stat the path (`stat_of`, no content read) → hash the written bytes →
//! `put_if_present`.
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; owns the map
//! helpers), file_watcher_baseline_check.rs (`is_unchanged_why`, which
//! reads up to a save-recorded size),
//! file_watcher_baseline_read.rs (`stat_of`, `hash_bytes`),
//! file_watcher_baseline_seam.rs (test-only hook run after the copy-out, so
//! the D86 WI-2 g3 legs can land a register or remove there; production
//! compiles it to nothing), commands/file.rs (`save_file_with` calls this
//! between `atomic_write` and `mark_write_end`)
//!
//! Key decisions:
//! - **Bound to the written bytes, never re-read (D112).** The entry is the
//!   path's stat now and the hash of the bytes `atomic_write` wrote. The disk
//!   check is left to `is_unchanged_why`, which re-reads coherently and needs
//!   both the stat and the hash to match: if another writer got in after our
//!   rename, the disk no longer hashes to `written` and its event emits (fail
//!   toward prompting). The editor holds exactly `written`, so dropping only
//!   when the disk equals `written` is the D32 invariant. A re-read here used
//!   to store no hash whenever it went over the cap or was unstable, so our
//!   own save's rename event prompted (D112).
//! - **No size cap on the written bytes.** A save past `HASH_CAP_BYTES` is
//!   the only way an entry records a hash for more than the cap;
//!   `is_unchanged_why` derives its read cap from that size, so the cap is lifted
//!   only for entries a save wrote.
//! - **A failed stat stores `stat: None`**, which never compares equal.
//! - **Same hasher and lock discipline** as the parent: `hash_bytes`,
//!   presence via `copy_out`, store via `put_if_present`, no I/O under the lock.
//! - **Generation-checked** (D86 WI-2): the store lands only if the slot's
//!   generation is still the one `copy_out` returned before the stat.
use super::read::stat_of;
use super::{baseline_key, hash_bytes, BaselineStore, Entry};
use std::path::Path;

impl BaselineStore {
    /// Advance `raw`'s baseline after a save that wrote `written` (the exact
    /// encoded bytes handed to `atomic_write`), only if `raw` is registered:
    /// the path's stat now (`None` if it fails) and the hash of `written`,
    /// whatever its size. Does not read the file (D112); the next event's
    /// `is_unchanged_why` compares the disk against it. Never inserts; no I/O
    /// under the lock. Lands only if the slot still has the generation copied
    /// out before the stat (D86 WI-2), so a register or remove meanwhile wins.
    pub(crate) fn refresh_after_save(&self, raw: &Path, written: &[u8]) {
        let key = baseline_key(raw);
        let Some(slot) = self.copy_out(&key) else {
            return;
        };
        between_copy_and_store();
        let entry = Entry {
            stat: stat_of(raw),
            hash: Some(hash_bytes(written)),
        };
        self.put_if_present(&key, entry, slot.gen);
    }
}

/// Production no-op; the test build runs the installed read hook here
/// instead (file_watcher_baseline_seam.rs).
#[cfg(not(test))]
fn between_copy_and_store() {}

#[cfg(test)]
use super::seam::between_copy_and_store;

#[cfg(test)]
#[path = "file_watcher_baseline_save_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "file_watcher_baseline_save_cap_tests.rs"]
mod cap_tests;
