//! Per-path content baselines for the D32 unchanged-file filter (ADR-0068).
//!
//! Purpose: remember `(mtime, size, content hash)` for each watched file
//! and answer one question for the watcher: "is this file byte-for-byte what it was at the last
//! advance?" (`BaselineStore::is_unchanged_why`, in the check module, which
//! also says why not: `UnchangedCheck`, D112-WI-2). Tauri-free.
//!
//! Pipeline (`is_unchanged_why`, file_watcher_baseline_check.rs): copy the
//! slot out under the lock; outside it, one `read_once_upto`
//! (file_watcher_baseline_read.rs; cap: the larger of `HASH_CAP_BYTES` and
//! the stored size) must be stable and match its `(mtime, size)` and hash,
//! and a second copy-out must show the same generation.
//!
//! @coordinates-with services/file_watcher.rs (parent; `FileWatcher` owns one
//! `Arc<BaselineStore>` shared with its notify callback; `process_event_checked` asks
//! `is_unchanged_why` for a filtered kind or replaced file and advances with
//! `refresh_if_present` after an emitted `modified`; `watch` / `unwatch`
//! call `register_at` / `remove_at` after the watcher locks drop, with a
//! ticket taken under them — D32 WI-4, WI-5, D86 WI-2),
//! commands/file.rs (`save_file` refreshes after a successful write, WI-6;
//! `MAX_FILE_SIZE` is the hash cap), file_watcher_baseline_save.rs (that
//! refresh, bound to the written bytes without a read, WI-6b, D112),
//! file_watcher_gate.rs (self-write, then this check, then debounce),
//! file_watcher_baseline_read.rs (`read_once`, `coherent_read(_upto)`,
//! `snapshot`, `hash_bytes`; the last two re-exported here, D86 WI-1),
//! file_watcher_baseline_check.rs (`is_unchanged_why`, `UnchangedCheck`,
//! re-exported here; test-only `is_unchanged`, D112-WI-2),
//! file_watcher_baseline_seam.rs (test-only read hook and read counter),
//! file_watcher_baseline_gen.rs (tickets, `Slot`, `admit`),
//! file_watcher_baseline_claims.rs (`Inner::claim` / `release`, D106),
//! file_watcher_baseline_seed.rs (the open path's seed, `register_seeded`,
//! D86 WI-3), file_watcher_baseline_kind.rs (`is_filtered_kind`, the kinds
//! the drop applies to; re-exported here), docs/adr/0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md
//!
//! Key decisions:
//! - **Presence means registered.** A register (snapshot or seed) that lands
//!   always inserts or overwrites, even for a missing or unreadable file
//!   (fields `None`, which fails open); a refresh never inserts.
//! - **Last writer by ticket wins** (D86 WI-2, see the gen module): register
//!   and remove are ticketed, `latest` keeps a raw-keyed tombstone, and a
//!   refresh stores only if the slot generation it copied out is unchanged.
//! - **Canonical key** (ADR decision 5), falling back to the raw path. The
//!   store records `raw -> key` at `register`; a re-register replaces the
//!   record, and `remove` uses it, so a key change cannot leak an entry.
//!   Each record is that spelling's claim: an entry is dropped only when no
//!   spelling still holds it, so closing one of two spellings of a file
//!   keeps the other's baseline (D106, file_watcher_baseline_claims.rs).
//! - **One read, one handle** (ADR-0068 decision 3, D86 WI-1). `snapshot`
//!   and `is_unchanged_why` each decide from a single coherent read: stat, bytes
//!   and restat through one open file, plus a path-identity check. A read torn
//!   by a write, rename or metadata change fails open: `snapshot` stores the
//!   path stat with no hash, `is_unchanged_why` answers `unstable`. A read past
//!   `HASH_CAP_BYTES` stores no hash. ctime and ino prove stability and are
//!   never stored (D32): `Entry` stays `(mtime, size)` plus a hash.
//! - **Only written-bytes entries read past the cap (D112, D129).** Register,
//!   the open seed and `refresh_if_present` hash at most `HASH_CAP_BYTES`;
//!   `seed_for_written` (save refresh, Save As seed) hashes the written bytes
//!   uncapped and keeps a stat only if its size is theirs, so the stored size
//!   that sets `is_unchanged_why`'s read cap is bounded by what we wrote.
//! - **The mutex (lock L5) is a leaf.** It is taken only in `locked()`, and
//!   only the map helpers `copy_out` / `put` / `put_if_present` / `take` call
//!   that; they do no I/O. Every stat, read and `canonicalize` runs outside
//!   the lock. A poisoned lock is recovered, never unwrapped: this code runs
//!   on notify's callback thread.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::SystemTime;

/// Files larger than this get no hash from a read, so `is_unchanged_why` fails
/// open on them unless a save recorded their hash (D112). Equal to the open
/// cap, `commands::file::MAX_FILE_SIZE`.
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

/// `entries`: key -> slot. `keys`: raw -> key at the last register, i.e.
/// which spellings hold each entry (D106).
/// `latest`: raw -> ticket of the last register or remove that landed on
/// that spelling; a remove leaves it behind as a tombstone (D86 WI-2).
#[derive(Default)]
struct Inner {
    entries: HashMap<PathBuf, Slot>,
    keys: HashMap<PathBuf, PathBuf>,
    latest: HashMap<PathBuf, u64>,
}

/// The baseline map (lock L5) and the `raw -> key` record.
#[derive(Default)]
pub(crate) struct BaselineStore {
    inner: Mutex<Inner>,
}

impl BaselineStore {
    /// Record `raw`'s snapshot under its key, overwriting any entry, under a
    /// fresh ticket drawn before the read (see `register_at`). Test-only:
    /// production callers draw their ticket under the watcher locks.
    #[cfg(test)]
    pub(crate) fn register(&self, raw: &Path) {
        self.register_at(raw, next_ticket());
    }

    /// Re-snapshot `raw` only if its key already has an entry; never inserts,
    /// so a late event after `remove` cannot bring the entry back. The store
    /// lands only if the slot still carries the generation copied out before
    /// the read, so a register or remove inside the read wins (D86 WI-2).
    pub(crate) fn refresh_if_present(&self, raw: &Path) {
        let key = baseline_key(raw);
        let Some(slot) = self.copy_out(&key) else {
            return;
        };
        let entry = snapshot(raw);
        self.put_if_present(&key, entry, slot.gen);
    }

    /// Drop the entry under `raw`'s recorded key (or its current key when
    /// none is recorded) under a fresh ticket (see `remove_at`). Test-only,
    /// like `register`.
    #[cfg(test)]
    pub(crate) fn remove(&self, raw: &Path) {
        self.remove_at(raw, next_ticket());
    }

    /// The only place the mutex is taken. Poison is recovered: the map holds
    /// plain values, so a panicking holder cannot leave it half-updated.
    fn locked(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    // Map helpers: the only callers of `locked()`. No I/O in any of them.

    fn copy_out(&self, key: &Path) -> Option<Slot> {
        self.locked().entries.get(key).copied()
    }

    /// Store `entry` for `raw` unless an op with a newer ticket already
    /// landed on `raw`; the slot's generation is the ticket.
    fn put(&self, raw: &Path, key: PathBuf, entry: Entry, ticket: u64) -> StoreOutcome {
        let mut inner = self.locked();
        if !admit(inner.latest.get(raw).copied(), ticket) {
            return StoreOutcome::StaleSkipped;
        }
        inner.latest.insert(raw.to_path_buf(), ticket);
        inner.claim(raw, key, Slot { entry, gen: ticket });
        StoreOutcome::Stored(entry)
    }

    /// Overwrite the entry only if the slot exists and still has `gen`.
    fn put_if_present(&self, key: &Path, entry: Entry, gen: u64) {
        if let Some(slot) = self.locked().entries.get_mut(key) {
            if slot.gen == gen {
                slot.entry = entry;
            }
        }
    }

    /// Drop `raw`'s claim and leave its ticket as a tombstone, unless a
    /// newer op already landed; the entry goes once no spelling holds it
    /// (D106). A skipped remove leaves `keys` untouched.
    fn take(&self, raw: &Path, fallback: PathBuf, ticket: u64) -> StoreOutcome {
        let mut inner = self.locked();
        if !admit(inner.latest.get(raw).copied(), ticket) {
            return StoreOutcome::StaleSkipped;
        }
        inner.latest.insert(raw.to_path_buf(), ticket);
        inner.release(raw, fallback);
        StoreOutcome::Removed
    }
}

#[path = "file_watcher_baseline_kind.rs"]
mod kind;
pub(crate) use kind::is_filtered_kind;

#[path = "file_watcher_baseline_save.rs"]
mod save;

#[path = "file_watcher_baseline_gen.rs"]
mod gen;
use gen::admit;
pub(crate) use gen::{next_ticket, Slot, StoreOutcome};

#[path = "file_watcher_baseline_claims.rs"]
mod claims;

#[path = "file_watcher_baseline_read.rs"]
mod read;
pub(crate) use read::{hash_bytes, snapshot};

#[path = "file_watcher_baseline_check.rs"]
mod check;
pub(crate) use check::UnchangedCheck;

#[path = "file_watcher_baseline_seed.rs"]
pub(crate) mod seed;

#[cfg(test)]
#[path = "file_watcher_baseline_race_fixture.rs"]
mod race_fixture;

#[cfg(test)]
#[cfg(target_os = "macos")]
#[path = "file_watcher_baseline_coherent_race_tests.rs"]
mod coherent_race_tests;

#[cfg(test)]
#[cfg(unix)]
#[path = "file_watcher_baseline_read_tests.rs"]
mod read_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_fixture.rs"]
pub(super) mod fixture;

#[cfg(test)]
#[path = "file_watcher_baseline_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "file_watcher_baseline_cap_tests.rs"]
mod cap_tests;

#[cfg(test)]
#[cfg(unix)]
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
#[cfg(target_os = "macos")]
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
