//! Ticket ordering for the D32 baseline store (D86 WI-2).
//!
//! Purpose: make the last writer by ticket win, whatever order a register's
//! or remove's store step reaches the lock in. `register_at` / `remove_at`
//! take a ticket from the global counter `next_ticket`; the store keeps, per
//! raw path, the ticket of the last op that landed (`Inner.latest`) and
//! skips an op older than it (`StoreOutcome::StaleSkipped`).
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; `put` / `take`
//! do the admit check and the store under lock L5; the test-only plain
//! `register` / `remove` draw a fresh ticket and call in here), services/file_watcher.rs (`watch` /
//! `unwatch` draw their ticket inside the block holding the watcher locks,
//! so ticket order is watch-list order, then call `register_at` /
//! `remove_at` after the locks drop), file_watcher_baseline_save.rs (its
//! refresh is generation-checked through `copy_out` / `put_if_present`)
//!
//! Key decisions:
//! - **One global ticket, never a per-slot counter.** A slot's generation is
//!   the ticket of the op that stored it, so a slot removed and stored again
//!   never repeats a generation, and a refresh holding an old one cannot land
//!   even when the newer entry has an equal value.
//! - **`latest` is keyed by the raw path, and a remove leaves a tombstone.**
//!   The canonical key can change between a register's read and a remove
//!   (the file is deleted), but the raw spelling the caller passed cannot.
//!   So the ticket rule orders ops per spelling, and a landed remove drops
//!   only that spelling's claim on the shared entry (D106,
//!   file_watcher_baseline_claims.rs).
//! - **An equal ticket is admitted**, so re-applying an op is idempotent.
//! - **No lock here.** The admit decision runs inside the parent's map
//!   helpers; this module only snapshots outside the lock and calls them.
use super::{baseline_key, snapshot, BaselineStore, Entry};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static TICKETS: AtomicU64 = AtomicU64::new(1);

/// The next ticket from the process-wide counter; strictly increasing.
pub(crate) fn next_ticket() -> u64 {
    TICKETS.fetch_add(1, Ordering::SeqCst)
}

/// A stored entry and its generation: the ticket of the op that stored it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Slot {
    pub(crate) entry: Entry,
    pub(crate) gen: u64,
}

/// What a ticketed store step did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StoreOutcome {
    /// The register landed with this entry.
    Stored(Entry),
    /// The remove landed and left a tombstone.
    Removed,
    /// A newer op had already landed on this raw path; nothing changed.
    StaleSkipped,
}

/// Whether an op with `ticket` may land, given the raw path's last ticket.
pub(super) fn admit(latest: Option<u64>, ticket: u64) -> bool {
    latest.is_none_or(|last| last <= ticket)
}

impl BaselineStore {
    /// Snapshot `raw` outside the lock, then store it under its key unless
    /// an op newer than `ticket` already landed on `raw`.
    pub(crate) fn register_at(&self, raw: &Path, ticket: u64) -> StoreOutcome {
        let key = baseline_key(raw);
        let entry = snapshot(raw);
        self.put(raw, key, entry, ticket)
    }

    /// Drop `raw`'s claim (the entry too once no other spelling holds it)
    /// and record `ticket` as its tombstone, unless an op newer than
    /// `ticket` already landed on `raw`.
    pub(crate) fn remove_at(&self, raw: &Path, ticket: u64) -> StoreOutcome {
        let fallback = baseline_key(raw);
        self.take(raw, fallback, ticket)
    }
}

#[cfg(test)]
#[path = "file_watcher_baseline_gen_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "file_watcher_baseline_gen_refresh_tests.rs"]
mod refresh_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_gen_watch_tests.rs"]
mod watch_tests;

#[cfg(test)]
#[path = "file_watcher_baseline_gen_unchanged_tests.rs"]
mod unchanged_tests;
