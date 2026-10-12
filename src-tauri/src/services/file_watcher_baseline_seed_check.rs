//! The open-time seed check (D111-WI-2, ADR-0081 § "Open-time check").
//!
//! Purpose: after `watch_seeded` registers a path with the seed of the read
//! the caller is about to hand to the editor (an open's read, or the bytes a
//! Save As wrote), say whether the file on disk still is that seed. A write
//! landing between the read and the registration raises no notify event the
//! watcher can see, so this answer, carried on the open / Save As reply as
//! `changedSinceRead`, is the only report of it.
//!
//! Pipeline (`check_seed`): a seed with no stat or no hash is
//! `failopen_seed`, with no read; otherwise one `read_once_upto` (cap: the
//! larger of `HASH_CAP_BYTES` and the seed's size, as `is_unchanged_why`):
//! an io error is `failopen_read`, a torn read `failopen_unstable`, a read
//! past the cap `failopen_cap`; then the read's `(mtime, size)` and hash
//! against the seed: `changed` or `unchanged`.
//!
//! @coordinates-with services/file_watcher_baseline_seed.rs (parent; mounts
//! this file and re-exports `check_seed`, `SeedCheck`),
//! file_watcher_baseline_read.rs (`read_once_upto`, `hash_bytes`),
//! services/file_watcher_seed.rs (`watch_seeded` runs the check after its
//! store and logs `with_seed_check`), commands/file.rs (`open_file`,
//! `open_file_dialog`), commands/save_as_watch.rs (`save_as_watched_with`)
//!
//! Key decisions:
//! - **Against the seed the caller passed, never the stored baseline.** A
//!   notify refresh, a newer register or an unwatch may already have changed
//!   the slot; comparing with it would hide a change the caller's buffer
//!   never saw (Codex ruling, D111).
//! - **Read-only on the store.** The check never stores: it neither advances
//!   the baseline to the bytes it read nor restores the seed over a newer
//!   operation. It takes no lock and touches no slot.
//! - **Fail open, by name.** Every answer but `unchanged` reports the file as
//!   changed; the four `failopen_*` names keep the reason on the log line.
//! - **Reported whatever the store did.** A register skipped by the ticket
//!   rule still checks: the caller's read is just as stale.
//! - **Closed vocabulary**: `as_str` is an exhaustive match; `ALL` (test-only)
//!   lists every variant.
use super::super::read::read_once_upto;
use super::super::{hash_bytes, Entry, HASH_CAP_BYTES};
use crate::models::log_entry::LogEntryPayload;
use serde_json::json;
use std::path::Path;

/// What the seed check found (the `seedCheck` value of the register line).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum SeedCheck {
    /// A stable read with the seed's `(mtime, size)` and hash.
    Unchanged,
    /// A stable read whose stat or hash differs from the seed.
    Changed,
    /// The seed has no stat or no hash, so nothing can prove it current.
    FailOpenSeed,
    /// The file is now longer than the cap.
    FailOpenCap,
    /// The read was torn: the handle or the path moved during it.
    FailOpenUnstable,
    /// The open, the fstat or the read returned an io error.
    FailOpenRead,
}

impl SeedCheck {
    /// Every variant, for the tests that enumerate the domain.
    #[cfg(test)]
    pub(crate) const ALL: [SeedCheck; 6] = [
        SeedCheck::Unchanged,
        SeedCheck::Changed,
        SeedCheck::FailOpenSeed,
        SeedCheck::FailOpenCap,
        SeedCheck::FailOpenUnstable,
        SeedCheck::FailOpenRead,
    ];

    /// The `seedCheck` value of the `file.watch.register` line.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SeedCheck::Unchanged => "unchanged",
            SeedCheck::Changed => "changed",
            SeedCheck::FailOpenSeed => "failopen_seed",
            SeedCheck::FailOpenCap => "failopen_cap",
            SeedCheck::FailOpenUnstable => "failopen_unstable",
            SeedCheck::FailOpenRead => "failopen_read",
        }
    }

    /// The reply's `changedSinceRead`: anything but `Unchanged`.
    pub(crate) fn changed(self) -> bool {
        self != SeedCheck::Unchanged
    }
}

/// Whether `raw` on disk is still `seed`. Reads once, unlocked; never
/// touches the store.
pub(crate) fn check_seed(raw: &Path, seed: &Entry) -> SeedCheck {
    let (Some(stat), Some(hash)) = (seed.stat, seed.hash) else {
        return SeedCheck::FailOpenSeed;
    };
    let Ok(read) = read_once_upto(raw, HASH_CAP_BYTES.max(stat.1)) else {
        return SeedCheck::FailOpenRead;
    };
    if !read.stable {
        return SeedCheck::FailOpenUnstable;
    }
    if read.over_cap {
        return SeedCheck::FailOpenCap;
    }
    if read.s1 == stat && hash_bytes(&read.bytes) == hash {
        SeedCheck::Unchanged
    } else {
        SeedCheck::Changed
    }
}

/// `line` with `context.seedCheck` set to `check`'s closed string. A line
/// without a JSON-object context is returned unchanged.
pub(crate) fn with_seed_check(mut line: LogEntryPayload, check: SeedCheck) -> LogEntryPayload {
    if let Some(context) = line.context.as_mut().and_then(|c| c.as_object_mut()) {
        context.insert("seedCheck".to_string(), json!(check.as_str()));
    }
    line
}
