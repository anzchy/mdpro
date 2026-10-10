//! The save refresh for the D32 baseline store (ADR-0068 decision 4).
//!
//! Purpose: after `save_file` writes a file, advance its baseline to the
//! bytes the save wrote, and only to those (`BaselineStore::refresh_after_save`).
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; owns the map
//! helpers, `snapshot` and the hasher), commands/file.rs (`save_file_with`
//! calls this between `atomic_write` and `mark_write_end`)
//!
//! Key decisions:
//! - **Bound to the written bytes.** A plain re-snapshot would adopt an
//!   external write landing between our rename and the read; that write's
//!   event would then compare equal and be dropped while the editor holds our
//!   bytes. The disk snapshot is kept only when its hash equals the hash of
//!   the bytes `atomic_write` wrote; otherwise the hash is `None` (fresh stat
//!   kept), which fails open and emits, as before D32.
//! - **Same hasher, same cap, same lock discipline** as the parent: `hash_bytes`
//!   over at most `HASH_CAP_BYTES`, presence via `copy_out`, store via
//!   `put_if_present`, all I/O outside the lock.
use super::{baseline_key, hash_bytes, snapshot, BaselineStore, Entry, HASH_CAP_BYTES};
use std::path::Path;

impl BaselineStore {
    /// Advance `raw`'s baseline after a save that wrote `written` (the exact
    /// encoded bytes handed to `atomic_write`), only if `raw` is registered.
    /// The fresh snapshot is stored as is when its hash equals `written`'s;
    /// when it differs, or the read failed or went over the cap, the entry
    /// keeps the fresh stat with no hash, so the next filtered event emits
    /// (ADR-0068 decision 4). Never inserts; no I/O under the lock.
    pub(crate) fn refresh_after_save(&self, raw: &Path, written: &[u8]) {
        let key = baseline_key(raw);
        if self.copy_out(&key).is_none() {
            return;
        }
        let entry = bind_to_written(snapshot(raw), written);
        self.put_if_present(&key, entry);
    }
}

/// `disk` when its hash is the hash of `written`, else `disk` without a hash.
fn bind_to_written(disk: Entry, written: &[u8]) -> Entry {
    let ours = (written.len() as u64 <= HASH_CAP_BYTES).then(|| hash_bytes(written));
    if disk.hash.is_some() && disk.hash == ours {
        disk
    } else {
        Entry {
            stat: disk.stat,
            hash: None,
        }
    }
}

#[cfg(test)]
#[path = "file_watcher_baseline_save_tests.rs"]
mod tests;
