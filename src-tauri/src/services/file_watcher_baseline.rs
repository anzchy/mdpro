//! Per-path content baselines for the D32 unchanged-file filter (ADR-0068).
//!
//! Purpose: remember `(mtime, size, content hash)` for each watched file,
//! name the event kinds the watcher may drop (`is_filtered_kind`), and answer
//! one question for it: "is this file byte-for-byte what it was at the last
//! advance?" (`BaselineStore::is_unchanged`). Tauri-free.
//!
//! Pipeline (`is_unchanged`): copy the entry out under the lock, then, outside
//! it: stat, capped read and hash, stat again. All three must match.
//!
//! @coordinates-with services/file_watcher.rs (parent; `FileWatcher` owns one
//! `Arc<BaselineStore>` shared with its notify callback; `process_event` asks
//! `is_unchanged` for an `is_filtered_kind` event and advances with
//! `refresh_if_present` after an emitted `modified`; `watch` / `unwatch`
//! call `register` / `remove` after the watcher locks drop — D32 WI-4, WI-5),
//! commands/file.rs (`save_file` refreshes after a successful write, WI-6;
//! `MAX_FILE_SIZE` is the hash cap), file_watcher_baseline_save.rs (that
//! refresh, bound to the written bytes, WI-6b), file_watcher_gate.rs (self-write, then
//! this check, then debounce), file_watcher_baseline_seam.rs (test-only hook
//! between the read and the second stat),
//! docs/adr/0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md
//!
//! Key decisions:
//! - **Three filtered kinds** (ADR-0068 decision 1): `Modify(Metadata(Extended))`,
//!   `Modify(Metadata(Any))` and `Modify(Data(Content))`, the residual flags
//!   FSEvents reports for an xattr write within ~30 s of a real one. Every
//!   other kind routes as before.
//! - **Presence means registered.** `register` always inserts or overwrites,
//!   even for a missing or unreadable file (fields `None`, which fails open);
//!   `refresh_if_present` never inserts, so a late event cannot resurrect an
//!   unwatched path.
//! - **Canonical key** (ADR decision 5), falling back to the raw path. The
//!   store records `raw -> key` at `register`; a re-register replaces the
//!   record and drops the entry under the previous key, and `remove` uses
//!   the record, so a key change between the two cannot leak an entry.
//! - **Stat, then a capped read.** A snapshot torn by a concurrent write holds
//!   an old stat and a new hash, and fails open later.
//!   Reads take `HASH_CAP_BYTES + 1` bytes; more than the cap means no hash.
//! - **Coherent check** (ADR-0068 decision 3): `is_unchanged` stats before and
//!   after the hash read, and both must equal the baseline, so a write landing
//!   during the read fails open.
//! - **64-bit SipHash** (std `DefaultHasher`, fixed keys) over the disk bytes,
//!   never the editor's text. Collisions are accepted by the ADR.
//! - **The mutex (lock L5) is a leaf.** It is taken only in `locked()`, and
//!   only the map helpers `copy_out` / `put` / `put_if_present` / `take` call
//!   that; they do no I/O. Every stat, read and `canonicalize` runs outside
//!   the lock. A poisoned lock is recovered, never unwrapped: this code runs
//!   on notify's callback thread.

use notify::event::{DataChange, MetadataKind, ModifyKind};
use notify::EventKind;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::Hasher;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::SystemTime;

/// Files larger than this get no hash, so `is_unchanged` fails open on them.
/// Equal to the open cap, `commands::file::MAX_FILE_SIZE`.
pub(crate) const HASH_CAP_BYTES: u64 = 10 * 1024 * 1024;

/// One file's baseline. `stat` is the full-precision mtime and the size;
/// `None` fields mean "unknown", which never compares equal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Entry {
    pub(crate) stat: Option<(SystemTime, u64)>,
    pub(crate) hash: Option<u64>,
}

/// The store key for `raw`: its canonical path, or `raw` itself when it
/// cannot be canonicalised (missing file or directory).
pub(crate) fn baseline_key(raw: &Path) -> PathBuf {
    std::fs::canonicalize(raw).unwrap_or_else(|_| raw.to_path_buf())
}

/// The kinds the unchanged-file drop applies to (ADR-0068 decision 1).
pub(crate) fn is_filtered_kind(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Modify(
            ModifyKind::Metadata(MetadataKind::Extended | MetadataKind::Any)
                | ModifyKind::Data(DataChange::Content)
        )
    )
}

/// Stat `path`, then hash at most `HASH_CAP_BYTES` of its bytes. A missing
/// file has neither; an unreadable or over-cap one has a stat but no hash.
pub(crate) fn snapshot(path: &Path) -> Entry {
    let Some(stat) = stat_of(path) else {
        return Entry {
            stat: None,
            hash: None,
        };
    };
    Entry {
        stat: Some(stat),
        hash: read_capped(path).map(|bytes| hash_bytes(&bytes)),
    }
}

/// Full-precision mtime and size, or `None` when either is unavailable.
fn stat_of(path: &Path) -> Option<(SystemTime, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

/// Up to `HASH_CAP_BYTES` of the file; `None` on a read error or when more
/// than the cap comes back (also covers a file that grew since the stat).
fn read_capped(path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(HASH_CAP_BYTES + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= HASH_CAP_BYTES).then_some(bytes)
}

/// SipHash with std's fixed keys: the same bytes hash the same in every call.
fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    hasher.write(bytes);
    hasher.finish()
}

#[derive(Default)]
struct Inner {
    entries: HashMap<PathBuf, Entry>,
    keys: HashMap<PathBuf, PathBuf>,
}

/// The baseline map (lock L5) and the `raw -> key` record.
#[derive(Default)]
pub(crate) struct BaselineStore {
    inner: Mutex<Inner>,
}

impl BaselineStore {
    /// Record `raw`'s snapshot under its key, overwriting any entry. Also
    /// records `raw -> key`, dropping the entry under `raw`'s previous key.
    pub(crate) fn register(&self, raw: &Path) {
        let key = baseline_key(raw);
        let entry = snapshot(raw);
        self.put(raw, key, entry);
    }

    /// Re-snapshot `raw` only if its key already has an entry; never inserts,
    /// so a late event after `remove` cannot bring the entry back.
    pub(crate) fn refresh_if_present(&self, raw: &Path) {
        let key = baseline_key(raw);
        if self.copy_out(&key).is_none() {
            return;
        }
        let entry = snapshot(raw);
        self.put_if_present(&key, entry);
    }

    /// Drop the entry under `raw`'s recorded key (or its current key when
    /// none is recorded) and forget the record.
    pub(crate) fn remove(&self, raw: &Path) {
        let fallback = baseline_key(raw);
        self.take(raw, fallback);
    }

    /// True only if `raw` has an entry with a stored hash, and, read
    /// coherently, the stat before the read equals the stored one, a fresh
    /// capped read hashes equal to it, and the stat after the read still
    /// equals it (ADR-0068 decision 3). Every other case fails open.
    /// Read-only; all I/O runs after the lock is released.
    pub(crate) fn is_unchanged(&self, raw: &Path) -> bool {
        let key = baseline_key(raw);
        let Some(stored) = self.copy_out(&key) else {
            return false;
        };
        let (Some(stat), Some(hash)) = (stored.stat, stored.hash) else {
            return false;
        };
        if stat_of(raw) != Some(stat) {
            return false;
        }
        if read_capped(raw).map(|bytes| hash_bytes(&bytes)) != Some(hash) {
            return false;
        }
        Self::between_read_and_restat();
        stat_of(raw) == Some(stat)
    }

    /// Production no-op; the test build runs the K5 hook here instead
    /// (file_watcher_baseline_seam.rs).
    #[cfg(not(test))]
    fn between_read_and_restat() {}

    /// The only place the mutex is taken. Poison is recovered: the map holds
    /// plain values, so a panicking holder cannot leave it half-updated.
    fn locked(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    // Map helpers: the only callers of `locked()`. No I/O in any of them.

    fn copy_out(&self, key: &Path) -> Option<Entry> {
        self.locked().entries.get(key).copied()
    }

    fn put(&self, raw: &Path, key: PathBuf, entry: Entry) {
        let mut inner = self.locked();
        if let Some(previous) = inner.keys.insert(raw.to_path_buf(), key.clone()) {
            if previous != key {
                inner.entries.remove(&previous);
            }
        }
        inner.entries.insert(key, entry);
    }

    fn put_if_present(&self, key: &Path, entry: Entry) {
        if let Some(slot) = self.locked().entries.get_mut(key) {
            *slot = entry;
        }
    }

    fn take(&self, raw: &Path, fallback: PathBuf) {
        let mut inner = self.locked();
        let key = inner.keys.remove(raw).unwrap_or(fallback);
        inner.entries.remove(&key);
    }
}

#[path = "file_watcher_baseline_save.rs"]
mod save;

#[cfg(test)]
#[path = "file_watcher_baseline_fixture.rs"]
mod fixture;

#[cfg(test)]
#[path = "file_watcher_baseline_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "file_watcher_baseline_cap_tests.rs"]
mod cap_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_store_tests.rs"]
mod store_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_frame_tests.rs"]
mod frame_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_lock_tests.rs"]
mod lock_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_route_tests.rs"]
mod route_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_route_law_tests.rs"]
mod route_law_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_baseline_fsevents_tests.rs"]
mod fsevents_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_seam.rs"]
mod seam;

#[cfg(test)]
#[path = "file_watcher_baseline_kind_tests.rs"]
mod kind_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_kind_emit_tests.rs"]
mod kind_emit_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_coherent_tests.rs"]
mod coherent_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_cost_tests.rs"]
mod cost_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_baseline_live_tests.rs"]
mod live_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_baseline_live_race_tests.rs"]
mod live_race_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_wiring_tests.rs"]
mod wiring_tests;
