//! The open path's seed for the D32 baseline (D86 WI-3, finding ②).
//!
//! Purpose: give `open_file` the bytes it decodes together with the baseline
//! entry that describes exactly those bytes, from one read (`read_for_open`),
//! and store that entry without reading again
//! (`BaselineStore::register_seeded`). Tauri-free and lock-free.
//!
//! Pipeline: `read_for_open` → one `read_once` (fstat `s1`, capped read,
//! fstat `s2`, path stat) → `(bytes, Entry { stat: s1, hash })`. The caller
//! decodes `bytes`, then hands the entry to `register_seeded`, which
//! canonicalises outside the lock and stores it through `put` under the
//! ticket rule.
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; `put`,
//! `baseline_key`), file_watcher_baseline_read.rs (`read_once`, `hash_bytes`),
//! file_watcher_baseline_gen.rs (tickets, `StoreOutcome`),
//! services/file_watcher_seed.rs (`FileWatcher::watch_seeded` calls
//! `register_seeded`; re-exports `read_for_open` for `commands`),
//! commands/file_open_seed.rs (`open_file_from_path_seeded` decodes the bytes
//! `read_for_open` returns), file_watcher_baseline_lock_tests.rs (B18′ scans
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
use super::read::read_once;
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
