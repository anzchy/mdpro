//! The stability proof behind one `read_once_upto` (D86 WI-1, D159,
//! D190-WI-2 / ADR-0093): what must not have moved between the open and the
//! end of the read for its bytes to count as the file at the path.
//!
//! Purpose: `Proof::begin` takes what the proof needs from the read handle
//! before the read; `Proof::holds` checks it after the read and the test
//! seam. Tauri-free and lock-free.
//!
//! Pipeline: Unix: `begin` keeps the handle's first fstat; `holds` fstats
//! the handle again (`fd_proof`: mtime, ctime, size) and stats the path
//! (`path_proof`: dev, ino, mtime, size), exactly as before ADR-0093.
//! Elsewhere (the portable proof): `begin` keeps the handle's `(mtime,
//! size)` and its file identity (`same_file::Handle` of a duplicate of the
//! read handle, i.e. a fresh open bound to the path); `holds` fstats the
//! handle again, then opens the path fresh, and needs the same identity and
//! the same `(mtime, size)` on both.
//!
//! @coordinates-with services/file_watcher_baseline_read.rs (parent;
//! `read_once_upto` calls `begin` and `holds`),
//! file_watcher_baseline_seam.rs (`portable_proof_forced`: a Unix test build
//! can run the portable proof, `with_portable_proof`),
//! file_watcher_route_windows_atomic_save_tests.rs,
//! docs/adr/0093-windows-reads-are-proven-stable-by-file-identity-and-the-self-write-gate-matches-every-spelling.md
//!
//! Key decisions:
//! - **Unix is bit-identical** to the proof ADR-0068 decision 3 describes:
//!   the same two stats, in the same order, on the same fields.
//! - **The portable proof is identity + `(mtime, size)`, no ctime**
//!   (ADR-0093, user decision 「两个伴随修复 + (a) same-file」). Identity
//!   comes from `same-file` (volume serial + file index on Windows, dev +
//!   inode on Unix). It catches a rename-over or a parent swap during the
//!   read; it does not catch a same-length rewrite through an already-open
//!   handle that leaves `(mtime, size)` as they were (accepted limit).
//! - **Never a stored identity.** Both identities come from this read:
//!   an atomic save gives the path a new identity legitimately, so comparing
//!   with an identity from before the save would make every save a change.
//! - **Fail open on any query error**: a failed duplicate, identity query,
//!   fstat, mtime or fresh open makes the read unstable, which emits.
use std::fs::{File, Metadata};
use std::path::Path;
use std::time::SystemTime;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

/// What `begin` kept for `holds`.
pub(super) enum Proof {
    /// The handle's first fstat.
    #[cfg(unix)]
    Unix(Metadata),
    /// The handle's `(mtime, size)` and identity, `None` when a query failed.
    Portable {
        stat: Option<(SystemTime, u64)>,
        id: Option<same_file::Handle>,
    },
}

impl Proof {
    /// Take the proof's "before" from the open read handle and its first
    /// fstat `m1`. Never fails: a failed query is kept as `None`.
    pub(super) fn begin(file: &File, m1: &Metadata) -> Self {
        #[cfg(unix)]
        if !portable_proof_forced() {
            return Proof::Unix(m1.clone());
        }
        Proof::Portable {
            stat: stat_of(m1),
            id: file.try_clone().and_then(same_file::Handle::from_file).ok(),
        }
    }

    /// Whether the read through `file` was of one unmoving file still at
    /// `path`.
    pub(super) fn holds(&self, file: &File, path: &Path) -> bool {
        match self {
            #[cfg(unix)]
            Proof::Unix(m1) => {
                let same_fd = file
                    .metadata()
                    .is_ok_and(|m2| fd_proof(m1) == fd_proof(&m2));
                let same_path =
                    std::fs::metadata(path).is_ok_and(|p| path_proof(&p) == path_proof(m1));
                same_fd && same_path
            }
            Proof::Portable { stat, id } => {
                let (Some(stat), Some(id)) = (stat, id) else {
                    return false;
                };
                let same_fd = file.metadata().is_ok_and(|m2| stat_of(&m2) == Some(*stat));
                same_fd
                    && same_file::Handle::from_path(path).is_ok_and(|fresh| {
                        fresh == *id
                            && fresh
                                .as_file()
                                .metadata()
                                .is_ok_and(|p| stat_of(&p) == Some(*stat))
                    })
            }
        }
    }
}

/// Full-precision mtime and size, `None` when the mtime is unavailable.
fn stat_of(m: &Metadata) -> Option<(SystemTime, u64)> {
    Some((m.modified().ok()?, m.len()))
}

/// What must not move on the handle between `s1` and `s2`. Compared, never
/// stored.
#[cfg(unix)]
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
#[cfg(unix)]
fn path_proof(m: &Metadata) -> (u64, u64, i64, i64, u64) {
    (m.dev(), m.ino(), m.mtime(), m.mtime_nsec(), m.size())
}

/// Production: a Unix build always runs the Unix proof.
#[cfg(all(unix, not(test)))]
fn portable_proof_forced() -> bool {
    false
}

#[cfg(all(unix, test))]
use super::super::seam::portable_proof_forced;
