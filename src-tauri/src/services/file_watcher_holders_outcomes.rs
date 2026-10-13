//! The values the D173 holders map hands back (ADR-0086): a reservation, a
//! release outcome, consumer counts, and what a lost confirm must undo.
//!
//! Purpose: plain data, no I/O and no locks. `HoldMap` (parent module,
//! file_watcher_holders.rs) produces them; the `FileWatcher` API in
//! file_watcher_holders_teardown.rs acts on them and logs them. Split out of
//! the parent to keep it under the 300-line limit (rule 50).
//!
//! Key decisions:
//! - **`impl HoldMap` stays in the parent.** Tripwire d173_wi1_k reads only
//!   file_watcher_holders.rs and file_watcher_holders_teardown.rs to prove
//!   the map is pure, so the decisions must stay where it looks.
//! - **A `Reservation` carries the prior baseline entry** (D173-WI-4) from
//!   `reserve_hold` to `confirm_hold`'s reconcile, and whether to run it:
//!   a Save As opts out with `without_reconcile` (D173-WI-4b).
//! - Fields the parent kept private are `pub(super)` here, which is the same
//!   reach: the parent and its child modules.
//!
//! @coordinates-with services/file_watcher_holders.rs (parent; re-exports
//! these, `pub use ReleaseOutcome`), services/file_watcher_holders_teardown.rs
//! (consumes them), commands/watch_hold.rs (`ReleaseOutcome` on the wire)
use super::super::seed::Entry;
use super::GroupKey;
use serde::Serialize;
use std::path::PathBuf;

/// What `reserve_hold` hands an acquisition, to pass to `confirm_hold`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Reservation {
    pub(crate) gen: u64,
    /// Audit M1: the gen this window's hold on `raw` had before a duplicate
    /// reservation replaced it; `None` for a new hold.
    pub(crate) prior_gen: Option<u64>,
    pub(super) raw: PathBuf,
    pub(super) label: String,
    pub(super) group: GroupKey,
    /// D173-WI-4: the group's baseline entry copied out before the register,
    /// `None` for a first holder; the reconcile compares it with the stored one.
    pub(super) prior: Option<Entry>,
    /// D173-WI-4b: false for a Save As, whose save notice (with `origin`)
    /// already tells the holders; a plain notice would prompt the saver.
    pub(super) reconcile: bool,
}

impl Reservation {
    /// The Save As acquisition (`save_file_dialog`, `save_as_held_with`):
    /// `confirm_hold` runs no reconcile for it.
    pub(crate) fn without_reconcile(self) -> Self {
        Self {
            reconcile: false,
            ..self
        }
    }
}

/// What a release did (plan §3 rows 7 / 7b).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReleaseOutcome {
    /// The release named an older generation than the current hold: no-op.
    Stale,
    /// Another window still holds the same raw spelling.
    KeptRaw,
    /// The last holder of this spelling left; another spelling keeps the group.
    UnclaimedRaw,
    /// The group emptied: the backend watch and the baseline went.
    BackendReleased,
    /// No hold for (window, raw).
    NotHeld,
}

impl ReleaseOutcome {
    /// The wire / log name.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Stale => "stale",
            Self::KeptRaw => "keptRaw",
            Self::UnclaimedRaw => "unclaimedRaw",
            Self::BackendReleased => "backendReleased",
            Self::NotHeld => "notHeld",
        }
    }
}

/// Consumer counts after a transition, for the log lines.
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct Counts {
    pub(super) group: usize,
    pub(super) raw: usize,
}

/// A reservation as the map recorded it.
pub(super) struct Reserved {
    pub(super) gen: u64,
    pub(super) prior: Option<u64>,
    pub(super) group: GroupKey,
    pub(super) transition: &'static str,
    pub(super) counts: Counts,
}

/// A release as the map decided it; `others` are the group's other notify
/// spellings, set only for `BackendReleased`.
pub(super) struct Released {
    pub(super) outcome: ReleaseOutcome,
    pub(super) others: Vec<PathBuf>,
    pub(super) counts: Counts,
}

impl Released {
    /// A release that changed nothing but its outcome.
    pub(super) fn of(outcome: ReleaseOutcome) -> Self {
        Self {
            outcome,
            others: Vec::new(),
            counts: Counts::default(),
        }
    }
}

/// What a confirm that lost its hold must undo (plan §3 row 9).
pub(super) enum Orphan {
    /// The spelling is still consumed (another window, or a newer gen).
    Held,
    /// The group lives through another spelling: drop this one's claim.
    Unclaim,
    /// The group is gone: undo the register outright.
    GroupGone,
}
