//! Per-path content baselines for the D32 unchanged-file filter (ADR-0068).
//!
//! Purpose: remember `(mtime, size, content hash)` for each watched file,
//! name the event kinds the watcher may drop (`is_filtered_kind`), and answer
//! one question for it: "is this file byte-for-byte what it was at the last
//! advance?" (`BaselineStore::is_unchanged`). Tauri-free.
//!
//! Pipeline (`is_unchanged`): copy the slot out under the lock; outside it,
//! one `coherent_read` (file_watcher_baseline_read.rs) must match its `(mtime,
//! size)` and hash, and a second copy-out must show the same generation.
//!
//! @coordinates-with services/file_watcher.rs (parent; `FileWatcher` owns one
//! `Arc<BaselineStore>` shared with its notify callback; `process_event` asks
//! `is_unchanged` for a filtered kind or replaced file and advances with
//! `refresh_if_present` after an emitted `modified`; `watch` / `unwatch`
//! call `register_at` / `remove_at` after the watcher locks drop, with a
//! ticket taken under them — D32 WI-4, WI-5, D86 WI-2),
//! commands/file.rs (`save_file` refreshes after a successful write, WI-6;
//! `MAX_FILE_SIZE` is the hash cap), file_watcher_baseline_save.rs (that
//! refresh, bound to the written bytes, WI-6b), file_watcher_gate.rs (self-write, then
//! this check, then debounce), file_watcher_baseline_read.rs (`read_once`,
//! `coherent_read`, `snapshot`, `hash_bytes`; re-exported here, D86 WI-1),
//! file_watcher_baseline_seam.rs (test-only read hook and read counter),
//! file_watcher_baseline_gen.rs (tickets, `Slot`, `admit`),
//! file_watcher_baseline_seed.rs (the open path's seed, `register_seeded`,
//! D86 WI-3), docs/adr/0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md
//!
//! Key decisions:
//! - **Three filtered kinds** (ADR-0068 decision 1): `Modify(Metadata(Extended))`,
//!   `Modify(Metadata(Any))` and `Modify(Data(Content))`, the residual flags
//!   FSEvents reports for an xattr write within ~30 s of a real one. The
//!   route also checks a replaced file (ADR-0072); other kinds never are.
//! - **Presence means registered.** A register (snapshot or seed) that lands
//!   always inserts or overwrites, even for a missing or unreadable file
//!   (fields `None`, which fails open); a refresh never inserts.
//! - **Last writer by ticket wins** (D86 WI-2, see the gen module): register
//!   and remove are ticketed, `latest` keeps a raw-keyed tombstone, and a
//!   refresh stores only if the slot generation it copied out is unchanged.
//! - **Canonical key** (ADR decision 5), falling back to the raw path. The
//!   store records `raw -> key` at `register`; a re-register replaces the
//!   record and drops the entry under the previous key, and `remove` uses
//!   the record, so a key change between the two cannot leak an entry.
//! - **One read, one handle** (ADR-0068 decision 3, D86 WI-1). `snapshot`
//!   and `is_unchanged` each decide from a single `coherent_read`: stat, bytes
//!   and restat through one open file, plus a path-identity check. A read torn
//!   by a write, rename or metadata change fails open: `snapshot` stores the
//!   path stat with no hash, `is_unchanged` answers false. More than
//!   `HASH_CAP_BYTES` means no hash. ctime and ino prove stability and are
//!   never stored (D32): `Entry` stays `(mtime, size)` plus a hash.
//! - **The mutex (lock L5) is a leaf.** It is taken only in `locked()`, and
//!   only the map helpers `copy_out` / `put` / `put_if_present` / `take` call
//!   that; they do no I/O. Every stat, read and `canonicalize` runs outside
//!   the lock. A poisoned lock is recovered, never unwrapped: this code runs
//!   on notify's callback thread.

use notify::event::{DataChange, MetadataKind, ModifyKind};
use notify::EventKind;
use std::collections::HashMap;
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

/// `entries`: key -> slot. `keys`: raw -> key at the last register.
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

    /// True only if `raw` has an entry with a stored hash and one stable,
    /// in-cap read of it has the stored `(mtime, size)` and hashes equal to
    /// it (ADR-0068 decision 3). Every other case, an unstable read included,
    /// fails open, as does a register or remove landing during the read: the
    /// slot generation must not move across it (D109). I/O runs unlocked.
    pub(crate) fn is_unchanged(&self, raw: &Path) -> bool {
        let key = baseline_key(raw);
        let Some(Slot { entry, gen }) = self.copy_out(&key) else {
            return false;
        };
        let (Some(stat), Some(hash)) = (entry.stat, entry.hash) else {
            return false;
        };
        coherent_read(raw).is_some_and(|(s1, bytes)| s1 == stat && hash_bytes(&bytes) == hash)
            && self.copy_out(&key).is_some_and(|slot| slot.gen == gen)
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
        if let Some(previous) = inner.keys.insert(raw.to_path_buf(), key.clone()) {
            if previous != key {
                inner.entries.remove(&previous);
            }
        }
        inner.entries.insert(key, Slot { entry, gen: ticket });
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

    /// Remove `raw`'s entry and leave its ticket as a tombstone, unless a
    /// newer op already landed; a skipped remove leaves `keys` untouched.
    fn take(&self, raw: &Path, fallback: PathBuf, ticket: u64) -> StoreOutcome {
        let mut inner = self.locked();
        if !admit(inner.latest.get(raw).copied(), ticket) {
            return StoreOutcome::StaleSkipped;
        }
        inner.latest.insert(raw.to_path_buf(), ticket);
        let key = inner.keys.remove(raw).unwrap_or(fallback);
        inner.entries.remove(&key);
        StoreOutcome::Removed
    }
}

#[path = "file_watcher_baseline_save.rs"]
mod save;

#[path = "file_watcher_baseline_gen.rs"]
mod gen;
use gen::admit;
pub(crate) use gen::{next_ticket, Slot, StoreOutcome};

#[path = "file_watcher_baseline_read.rs"]
mod read;
pub(crate) use read::{coherent_read, hash_bytes, snapshot};

#[path = "file_watcher_baseline_seed.rs"]
pub(crate) mod seed;

#[cfg(test)]
#[path = "file_watcher_baseline_race_fixture.rs"]
mod race_fixture;

#[cfg(test)]
#[path = "file_watcher_baseline_coherent_race_tests.rs"]
mod coherent_race_tests;

#[cfg(test)]
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
