//! Who holds each watched file, per window and per canonical group (D173,
//! ADR-0086 decisions 1-3): the registry's state and its pure decisions.
//!
//! Purpose: layer 1 keys a hold by (window label, raw spelling) with a
//! monotonic generation. Layer 2 groups spellings by canonical file and owns
//! the notify watch: notify `unwatch` runs only when the group has no
//! consumer, as notify 6.1.1 keeps one canonical filter entry per file.
//! `HoldMap` decides with no I/O (reserve, confirm check, release, restore,
//! fence, a group's spellings); the locked `FileWatcher` API lives in
//! file_watcher_holders_teardown.rs (bar `consumer_spellings`, here), the
//! reconcile (D173-WI-4) in file_watcher_holders_reconcile.rs, the values
//! returned in file_watcher_holders_outcomes.rs.
//!
//! Pipeline: `reserve_hold` → the legacy register (`watch` / `watch_seeded`,
//! unchanged) → `confirm_hold` (→ the reconcile, outside every lock). A
//! release is `release_hold` (a stale gen is a no-op) or `release_window` on
//! `Destroyed`, which fences the label: a late acquisition is refused, or
//! torn down on confirm if its register raced the fence.
//!
//! Key decisions:
//! - **Locks.** T (`transitions`) serialises reserve, confirm and release,
//!   held through a teardown's notify I/O (a `TransitionGuard`). H (`map`)
//!   is a leaf, only in `with_map` around one pure `HoldMap` call. Order:
//!   T → H, T → watcher → list → L5; a register takes neither. The notify
//!   callback never takes T: notify's `stop()` joins its thread.
//! - **Every acquisition still runs the legacy register** (D86 seed, D111
//!   seed check, baseline overwrite); only release is layered.
//! - **A spelling joins `notify_spellings` when it is reserved**, so a
//!   register raced by its own release is still cleared at the teardown.
//! - **A duplicate keeps its group**: the group is fixed at the first
//!   acquisition, and a later symlink retarget is not followed.
//! - **Recipients are raw strings** (audit b97 M1). The holds key stays
//!   (label, `PathBuf`), a recorded limit: one window's `/d/./x.md` and
//!   `/d/x.md` are one hold, noticed under the string it first reserved.
//! - Gen 0 is never issued; replies use 0 for "no hold".
//!
//! @coordinates-with services/file_watcher.rs (parent; the `holders` field
//! and the legacy `watch` / `unwatch`), file_watcher_holders_teardown.rs
//! (the `FileWatcher` API: `reserve_hold`, `confirm_hold`, `release_hold`,
//! `release_window`, and the I/O and log lines behind them),
//! commands/file.rs and commands/draft_recover_watch.rs (the acquisitions),
//! commands/watch_hold.rs, main.rs (`release_window` on `Destroyed`),
//! file_watcher_holders_outcomes.rs (`impl HoldMap` stays here, where
//! tripwire d173_wi1_k reads it), file_watcher_holders_reconcile.rs
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Layer 2 key: the backend watch is owned per canonical group.
pub(crate) type GroupKey = PathBuf;

/// The holder registry: lock T (`transitions`) and lock H (`map`).
#[derive(Default)]
pub(crate) struct Holders {
    transitions: Mutex<()>,
    map: Mutex<HoldMap>,
}

/// Proof that lock T is held, passed to everything that may unwatch.
pub(crate) struct TransitionGuard<'a> {
    _held: MutexGuard<'a, ()>,
}

#[derive(Default)]
struct HoldMap {
    next_gen: u64,
    /// Layer 1: one hold per (window label, raw spelling).
    holds: HashMap<(String, PathBuf), Hold>,
    /// Layer 2: the canonical groups; a group lives while it has a consumer.
    groups: HashMap<GroupKey, Group>,
    /// Fence: windows that reached `Destroyed`. Labels are unique per
    /// process; a change that reuses one must clear it here.
    destroyed: HashSet<String>,
}

struct Hold {
    gen: u64,
    group: GroupKey,
    /// The raw string first reserved: a notice recipient (audit b97 M1).
    spelling: String,
}

#[derive(Default)]
struct Group {
    /// raw spelling -> number of windows holding it.
    consumers: BTreeMap<PathBuf, usize>,
    /// Every raw string reserved while the group lived, in order, so the
    /// teardown can clear each one from notify's stream.
    notify_spellings: Vec<PathBuf>,
}

#[path = "file_watcher_holders_outcomes.rs"]
mod outcomes;
pub use outcomes::ReleaseOutcome;
pub(crate) use outcomes::Reservation;
use outcomes::{Counts, Orphan, Released, Reserved};

impl HoldMap {
    fn reserve(&mut self, label: &str, raw: &Path, group: &Path) -> Option<Reserved> {
        if self.destroyed.contains(label) {
            return None;
        }
        self.next_gen += 1;
        let gen = self.next_gen;
        let key = (label.to_string(), raw.to_path_buf());
        let held = self.holds.get(&key);
        let prior = held.map(|h| h.gen);
        let duplicate = held.map(|h| (h.group.clone(), h.spelling.clone()));
        let (group, spelling) = duplicate
            .clone()
            .unwrap_or_else(|| (group.to_path_buf(), raw.to_string_lossy().into_owned()));
        let g = self.groups.entry(group.clone()).or_default();
        let transition = match (&duplicate, g.consumers.get(raw)) {
            (Some(_), _) => "duplicate",
            (None, Some(_)) => "additional_window",
            (None, None) if g.consumers.is_empty() => "first",
            (None, None) => "additional_spelling",
        };
        if duplicate.is_none() {
            *g.consumers.entry(raw.to_path_buf()).or_insert(0) += 1;
        }
        if !g.notify_spellings.iter().any(|s| s == raw) {
            g.notify_spellings.push(raw.to_path_buf());
        }
        let counts = Counts {
            group: g.consumers.values().sum(),
            raw: g.consumers.get(raw).copied().unwrap_or(0),
        };
        let hold = Hold {
            gen,
            group: group.clone(),
            spelling,
        };
        self.holds.insert(key, hold);
        Some(Reserved {
            gen,
            prior,
            group,
            transition,
            counts,
        })
    }

    /// Audit M1: put back the hold's `prior` gen when (label, raw) still
    /// holds the duplicate reservation's `gen`. True when it did.
    fn restore(&mut self, label: &str, raw: &Path, gen: u64, prior: u64) -> bool {
        let key = (label.to_string(), raw.to_path_buf());
        match self.holds.get_mut(&key) {
            Some(hold) if hold.gen == gen => {
                hold.gen = prior;
                true
            }
            _ => false,
        }
    }

    /// Every distinct raw STRING held in the group `group` (D173-WI-2).
    /// From the holds, not `consumers`: `PathBuf` compares components, so
    /// `/d/./x.md` and `/d/x.md` are one key there but two notices (b97 M1).
    fn spellings(&self, group: &Path) -> Vec<String> {
        let held = self.holds.values().filter(|h| h.group == group);
        let distinct: BTreeSet<String> = held.map(|h| h.spelling.clone()).collect();
        distinct.into_iter().collect()
    }

    fn is_current(&self, label: &str, raw: &Path, gen: u64) -> bool {
        let key = (label.to_string(), raw.to_path_buf());
        self.holds.get(&key).is_some_and(|h| h.gen == gen)
    }

    fn orphan(&self, raw: &Path, group: &Path) -> Orphan {
        match self.groups.get(group) {
            None => Orphan::GroupGone,
            Some(g) if g.consumers.contains_key(raw) => Orphan::Held,
            Some(_) => Orphan::Unclaim,
        }
    }

    fn release(&mut self, label: &str, raw: &Path, gen: u64) -> Released {
        let key = (label.to_string(), raw.to_path_buf());
        match self.holds.get(&key).map(|h| h.gen) {
            None => return Released::of(ReleaseOutcome::NotHeld),
            Some(current) if current != gen => return Released::of(ReleaseOutcome::Stale),
            Some(_) => {}
        }
        let Some(hold) = self.holds.remove(&key) else {
            return Released::of(ReleaseOutcome::NotHeld);
        };
        let Some(group) = self.groups.get_mut(&hold.group) else {
            return Released::of(ReleaseOutcome::NotHeld);
        };
        let left = group.consumers.get(raw).map_or(0, |n| n.saturating_sub(1));
        if left == 0 {
            group.consumers.remove(raw);
        } else {
            group.consumers.insert(raw.to_path_buf(), left);
        }
        let counts = Counts {
            group: group.consumers.values().sum(),
            raw: left,
        };
        let outcome = if left > 0 {
            ReleaseOutcome::KeptRaw
        } else if !group.consumers.is_empty() {
            ReleaseOutcome::UnclaimedRaw
        } else {
            ReleaseOutcome::BackendReleased
        };
        let others = match outcome {
            ReleaseOutcome::BackendReleased => {
                self.groups.remove(&hold.group).map_or_else(Vec::new, |g| {
                    g.notify_spellings
                        .into_iter()
                        .filter(|s| s != raw)
                        .collect()
                })
            }
            _ => Vec::new(),
        };
        Released {
            outcome,
            others,
            counts,
        }
    }

    fn fence(&mut self, label: &str) -> Vec<(PathBuf, u64)> {
        self.destroyed.insert(label.to_string());
        let mut held: Vec<(PathBuf, u64)> = self
            .holds
            .iter()
            .filter(|((l, _), _)| l == label)
            .map(|((_, raw), h)| (raw.clone(), h.gen))
            .collect();
        held.sort();
        held
    }
}

impl Holders {
    fn transition(&self) -> TransitionGuard<'_> {
        let held = self
            .transitions
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        TransitionGuard { _held: held }
    }

    /// The only place H is taken: one pure `HoldMap` step, poison recovered.
    fn with_map(&self, step: impl FnOnce(&mut HoldMap)) {
        step(&mut self.map.lock().unwrap_or_else(PoisonError::into_inner));
    }
}

impl super::FileWatcher {
    /// Every distinct raw string held in the canonical group `target`
    /// (already a group key), in a stable order: the save notice's and the
    /// reconcile's recipients (D173-WI-2, WI-4). Lock H only, no I/O.
    pub(crate) fn consumer_spellings(&self, target: &Path) -> Vec<String> {
        let mut out = Vec::new();
        self.holders.with_map(|m| out = m.spellings(target));
        out
    }
}

#[path = "file_watcher_holders_teardown.rs"]
mod teardown;

#[path = "file_watcher_holders_reconcile.rs"]
mod reconcile;

#[cfg(test)]
#[path = "file_watcher_holders_fixture.rs"]
// D173-WI-1-rust: recorded red spec, bytes are the receipt's evidence
#[rustfmt::skip]
mod fixture;

#[cfg(test)]
#[path = "file_watcher_holders_tests.rs"]
// D173-WI-1-rust: recorded red spec, bytes are the receipt's evidence
#[rustfmt::skip]
mod tests;

#[cfg(test)]
#[path = "file_watcher_holders_rows_tests.rs"]
// D173-WI-1-rust: recorded red spec, bytes are the receipt's evidence
#[rustfmt::skip]
mod rows_tests;

#[cfg(test)]
#[path = "file_watcher_holders_lock_tests.rs"]
// D173-WI-1-rust: recorded red spec, bytes are the receipt's evidence
#[rustfmt::skip]
mod lock_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_holders_live_tests.rs"]
// D173-WI-1-rust: recorded red spec, bytes are the receipt's evidence
#[rustfmt::skip]
mod live_tests;
