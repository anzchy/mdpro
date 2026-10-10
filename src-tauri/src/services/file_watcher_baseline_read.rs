//! The single-handle coherent read behind the D32 baseline (D86 WI-1,
//! ADR-0068 decision 3).
//!
//! Purpose: read a file once and say whether that read saw one unmoving
//! file (`read_once`), and build the baseline decisions on it: the bytes and
//! stat of a stable read (`coherent_read`) and a store entry (`snapshot`).
//! Tauri-free and lock-free: nothing here touches the store's mutex.
//!
//! Pipeline (`read_once_upto`): open the path once; fstat the handle (`s1`);
//! read at most `cap + 1` bytes through it (`read_once` and `coherent_read`
//! use `cap = HASH_CAP_BYTES`); run the test seam; fstat
//! the handle again (`s2`); stat the path (`p`, following symlinks).
//! `stable` means `s1 == s2` on `(mtime, size, ctime)` and `p` is the same
//! file as `s1` on `(dev, ino, mtime, size)`.
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; `is_unchanged`
//! calls `coherent_read_upto` with a cap derived from the stored size, and
//! `register` / `refresh_if_present` call `snapshot`; the parent re-exports
//! `hash_bytes`, `snapshot`),
//! services/file_watcher_baseline_save.rs (`refresh_after_save` stores
//! `stat_of` and `hash_bytes` of the written bytes, never a read, D112), file_watcher_baseline_seam.rs (test-only
//! hook run between the read and `s2`, and the per-thread `read_once` call
//! counter; production compiles both to nothing),
//! file_watcher_baseline_seed.rs (`read_for_open`, the open path's one read),
//! file_watcher_baseline_lock_tests.rs (B18′ scans this file too),
//! docs/adr/0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md
//!
//! Key decisions:
//! - **ctime/ino: proof only, never stored (D32).** ctime, ctime_nsec, dev
//!   and ino prove a read was stable and are then dropped. `ReadOnce::s1` and
//!   `Entry::stat` carry only `(mtime, size)`: the LaunchServices xattr write
//!   that D32 drops moves ctime, so a stored ctime would make every such
//!   write a change again.
//! - **One handle.** `s1`, the bytes and `s2` all come from the same open
//!   file, so a write or a rename-over landing during the read moves ctime
//!   (or the inode) and the read is unstable. The path stat then catches a
//!   swap of the path itself (a parent-directory rename, a rename-over) that
//!   leaves the open inode untouched.
//! - **The path stat follows symlinks** (`fs::metadata`, never
//!   `symlink_metadata`): the handle refers to the link's target, so an lstat
//!   would make every read through a file symlink unstable.
//! - **Keep what was read.** An unstable or over-cap read still returns its
//!   bytes and `s1`, and a failed one keeps its io error, so the open path can
//!   use them. Only `coherent_read` turns them into `None`.
//! - **The cap is the caller's.** `snapshot` and the seed read at most
//!   `HASH_CAP_BYTES`, so neither ever hashes more; only `is_unchanged` asks
//!   for more, and only up to a size a save recorded (D112).
//! - **Fail open.** An unstable, over-cap or failed read gives a snapshot
//!   with the path's current stat (or none) and no hash, which never compares
//!   equal: a missing file has neither, an unreadable file or a directory a
//!   stat only (B7, B8, B10).
//! - **64-bit SipHash** (std `DefaultHasher`, fixed keys) over the disk bytes,
//!   never the editor's text. Collisions are accepted by the ADR.
use super::{Entry, HASH_CAP_BYTES};
use std::collections::hash_map::DefaultHasher;
use std::fs::{File, Metadata};
use std::hash::Hasher;
use std::io::{self, Read};
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::time::SystemTime;

/// One read through one handle. `s1` is the `(mtime, size)` of the handle
/// before the read; `bytes` holds at most `cap + 1` bytes, and `over_cap`
/// says it holds more than `cap`.
#[derive(Debug)]
pub(crate) struct ReadOnce {
    pub(crate) s1: (SystemTime, u64),
    pub(crate) bytes: Vec<u8>,
    pub(crate) stable: bool,
    pub(crate) over_cap: bool,
}

/// `read_once_upto` with the hash cap, `HASH_CAP_BYTES`.
pub(crate) fn read_once(path: &Path) -> io::Result<ReadOnce> {
    read_once_upto(path, HASH_CAP_BYTES)
}

/// Open `path` once, fstat, read at most `cap + 1` bytes through the handle,
/// fstat again, then stat the path. Errors from the open, the first fstat or
/// the read are returned as they are; a failed second fstat or path stat
/// only makes the read unstable.
pub(crate) fn read_once_upto(path: &Path, cap: u64) -> io::Result<ReadOnce> {
    note_read_call();
    let mut file = File::open(path)?;
    let m1 = file.metadata()?;
    let s1 = (m1.modified()?, m1.len());
    let mut bytes = Vec::new();
    (&mut file)
        .take(cap.saturating_add(1))
        .read_to_end(&mut bytes)?;
    between_read_and_restat();
    let same_fd = file
        .metadata()
        .is_ok_and(|m2| fd_proof(&m1) == fd_proof(&m2));
    let same_path = std::fs::metadata(path).is_ok_and(|p| path_proof(&p) == path_proof(&m1));
    Ok(ReadOnce {
        s1,
        over_cap: bytes.len() as u64 > cap,
        bytes,
        stable: same_fd && same_path,
    })
}

/// `coherent_read_upto` with the hash cap, `HASH_CAP_BYTES`.
pub(crate) fn coherent_read(path: &Path) -> Option<((SystemTime, u64), Vec<u8>)> {
    coherent_read_upto(path, HASH_CAP_BYTES)
}

/// The bytes and `(mtime, size)` of a stable read of at most `cap` bytes;
/// `None` otherwise.
pub(crate) fn coherent_read_upto(path: &Path, cap: u64) -> Option<((SystemTime, u64), Vec<u8>)> {
    let read = read_once_upto(path, cap).ok()?;
    (read.stable && !read.over_cap).then_some((read.s1, read.bytes))
}

/// The entry for `path`: the stat and hash of one stable read, or the path's
/// current stat with no hash (fails open).
pub(crate) fn snapshot(path: &Path) -> Entry {
    match coherent_read(path) {
        Some((stat, bytes)) => Entry {
            stat: Some(stat),
            hash: Some(hash_bytes(&bytes)),
        },
        // One line on purpose: the path stat is only ever the no-hash fallback (r7b).
        #[rustfmt::skip]
        None => Entry { stat: stat_of(path), hash: None },
    }
}

/// Full-precision mtime and size, or `None` when either is unavailable.
pub(crate) fn stat_of(path: &Path) -> Option<(SystemTime, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

/// SipHash with std's fixed keys: the same bytes hash the same in every call.
pub(crate) fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    hasher.write(bytes);
    hasher.finish()
}

/// What must not move on the handle between `s1` and `s2`. Compared, never
/// stored.
fn fd_proof(m: &Metadata) -> (i64, i64, i64, i64, u64) {
    (
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec(),
        m.size(),
    )
}

/// Path identity: the path still names the inode that was read, with the
/// same `(mtime, size)`. Compared, never stored.
fn path_proof(m: &Metadata) -> (u64, u64, i64, i64, u64) {
    (m.dev(), m.ino(), m.mtime(), m.mtime_nsec(), m.size())
}

/// Production no-op; the test build runs the installed read hook here
/// instead (file_watcher_baseline_seam.rs).
#[cfg(not(test))]
fn between_read_and_restat() {}

/// Production no-op; the test build counts the call (D86 WI-3).
#[cfg(not(test))]
fn note_read_call() {}

#[cfg(test)]
use super::seam::{between_read_and_restat, note_read_call};
