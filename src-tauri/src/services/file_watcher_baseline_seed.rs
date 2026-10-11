//! The open path's seed for the D32 baseline (D86 WI-3, finding ②), and the
//! entry for bytes a save wrote (`seed_for_written`: the Save As seed, D69,
//! and the save refresh's entry, D129).
//!
//! Purpose: give `open_file` the bytes it decodes together with the baseline
//! entry that describes exactly those bytes, from one read (`read_for_open`),
//! and store that entry without reading again
//! (`BaselineStore::register_seeded`). For a save or a Save As,
//! `seed_for_written` builds the entry from the bytes the save wrote instead
//! of a read.
//! Tauri-free and lock-free.
//!
//! Pipeline: `read_for_open` → one `read_once` (fstat `s1`, capped read,
//! fstat `s2`, path stat) → `(bytes, Entry { stat: s1, hash })`. The caller
//! decodes `bytes`, then hands the entry to `register_seeded`, which
//! canonicalises outside the lock and stores it through `put` under the
//! ticket rule.
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; `put`,
//! `baseline_key`), file_watcher_baseline_read.rs (`read_once`, `stat_of`,
//! `hash_bytes`),
//! file_watcher_baseline_gen.rs (tickets, `StoreOutcome`),
//! services/file_watcher_seed.rs (`FileWatcher::watch_seeded` calls
//! `register_seeded`; re-exports `read_for_open` and `seed_for_written` for
//! `commands`), commands/file_open_seed.rs (`open_file_from_path_seeded`
//! decodes the bytes `read_for_open` returns), commands/save_as_watch.rs
//! (seeds the Save As target with `seed_for_written`, D69),
//! file_watcher_baseline_save.rs (`refresh_after_save` builds its entry with
//! `seed_for_written`, D129), file_watcher_baseline_lock_tests.rs (B18′ scans
//! this file)
//!
//! Key decisions:
//! - **Hash the raw disk bytes**, before any decoding, exactly as `snapshot`
//!   does, so the seed of a quiescent file equals its snapshot.
//! - **The stat is `s1`**, the fstat taken before the read, never a stat taken
//!   after it: a write landing during the read leaves the seed older than the
//!   disk, so the next event for it is not dropped.
//! - **Fail open.** An unstable or over-cap read seeds `hash: None`, which
//!   never compares equal. The bytes are returned anyway: the open path turns
//!   an over-cap read into `FileTooLarge`, and decodes an unstable one.
//! - **`register_seeded` never reads.** The seed is the read; a second read
//!   would hash bytes the editor never saw (matrix r8). A seed overwrites any
//!   entry, subject only to the WI-2 ticket rule (ADR-0068 decision 4).
//! - **`seed_for_written` hashes the written bytes uncapped** (the D112 rule)
//!   and does not read; it stores `stat: None` when the stat's size is not
//!   the written length (D129), because another writer got in after our
//!   rename and its size must not raise `is_unchanged_why`'s read cap. It is
//!   the one rule for both written-bytes entries: `refresh_after_save` and
//!   the Save As seed both build theirs with it.
use super::read::{read_once, stat_of};
use super::{baseline_key, hash_bytes, BaselineStore, Entry, StoreOutcome};
use std::io;
use std::path::Path;

/// One read of `path` for `open_file`: the bytes read (at most
/// `HASH_CAP_BYTES + 1`) and the entry that describes them.
pub(crate) fn read_for_open(path: &Path) -> io::Result<(Vec<u8>, Entry)> {
    let read = read_once(path)?;
    let hash = (read.stable && !read.over_cap).then(|| hash_bytes(&read.bytes));
    let seed = Entry {
        stat: Some(read.s1),
        hash,
    };
    Ok((read.bytes, seed))
}

/// The seed for a file a save just wrote: the path's stat now and the hash
/// of `written` (the exact encoded bytes handed to `atomic_write`), whatever
/// its size (D112), with no read. If the stat's size is not `written.len()`,
/// another writer replaced the file after our rename, so the stat is stored
/// as `None` and the check fails open (D129): a size we never wrote must not
/// raise `is_unchanged_why`'s read cap. The Save As register (D69) and
/// `refresh_after_save` (D129) both build their entry with it.
pub(crate) fn seed_for_written(path: &Path, written: &[u8]) -> Entry {
    let stat = stat_of(path).filter(|&(_, size)| size == written.len() as u64);
    Entry {
        stat,
        hash: Some(hash_bytes(written)),
    }
}

impl BaselineStore {
    /// Store `seed` for `raw` under `raw`'s key, unless an op newer than
    /// `ticket` already landed on `raw`. Does no read.
    pub(crate) fn register_seeded(&self, raw: &Path, seed: Entry, ticket: u64) -> StoreOutcome {
        let key = baseline_key(raw);
        self.put(raw, key, seed, ticket)
    }
}

/// Test-only reach into the baseline's fixtures and seam for the `commands`
/// and `file_watcher` suites (matrix P8), re-exported by
/// services/file_watcher_seed.rs.
#[cfg(test)]
pub(crate) mod kit {
    pub(crate) use super::super::fixture::{
        chmod_000_unreadable, h, modified, rewrite_keep_stat, set_mtime, sparse, TempDir,
    };
    pub(crate) use super::super::race_fixture::{file_symlink, stat_pair};
    pub(crate) use super::super::read::read_once;
    pub(crate) use super::super::seam::{read_once_calls, with_read_hook};
    pub(crate) use super::super::{snapshot, HASH_CAP_BYTES};
}

#[cfg(test)]
#[path = "file_watcher_baseline_seed_tests.rs"]
mod tests;
