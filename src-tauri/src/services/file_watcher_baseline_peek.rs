//! A pure read of one baseline entry by store key (D173-WI-4, plan r2 §5).
//!
//! Purpose: `entry_of(key)` copies the entry stored under `key` out through
//! `copy_out` (lock L5 only, a leaf, no I/O). The holders' second-holder
//! reconcile takes it before an acquisition's register can overwrite the
//! shared baseline, and again after, to compare the two hashes.
//!
//! Key decisions:
//! - **No canonicalize, no read.** The caller passes a key it already has
//!   (the reservation's group key, or the raw spelling as the store's
//!   fallback key), so the copy can run anywhere outside the holders' locks.
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; `copy_out`,
//! `Entry`), services/file_watcher_holders_reconcile.rs (the only caller)
use super::{BaselineStore, Entry};
use std::path::Path;

impl BaselineStore {
    /// The entry stored under `key`, if any: one `copy_out`, no I/O.
    pub(crate) fn entry_of(&self, key: &Path) -> Option<Entry> {
        self.copy_out(key).map(|slot| slot.entry)
    }
}
