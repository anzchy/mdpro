//! Who holds each watched file, per window and per canonical group (D173,
//! ADR-0086 decisions 1-3): the registry's state and its pure decisions.
//!
//! Purpose: layer 1 keys a hold by (window label, raw spelling) and gives it
//! a monotonic generation. Layer 2 groups spellings by canonical file, and
//! the group owns the notify watch: notify `unwatch` runs only when the group
//! has no consumer, because notify 6.1.1 keeps one canonical filter entry per
//! file and unwatching any spelling silences the others. `HoldMap` decides
//! (reserve, confirm check, release, fence) with no I/O; the `FileWatcher`
//! API that takes the locks and does what a decision needs lives in
//! file_watcher_holders_teardown.rs, and the values a decision returns
//! (`Reservation`, `ReleaseOutcome`, `Released`, ...) in
//! file_watcher_holders_outcomes.rs.
//!
//! Pipeline: an acquisition is `reserve_hold` → the legacy register (`watch`
//! / `watch_seeded`, unchanged) → `confirm_hold`. A release is `release_hold`
//! (a stale generation is a no-op) or `release_window` on
//! `WindowEvent::Destroyed`, which also fences the label so a late
//! acquisition is refused or, if its register raced the fence, torn down on
//! confirm.
//!
//! Key decisions:
//! - **Locks.** T (`transitions`) serialises reservations, confirms and
//!   releases, and is held through a teardown's notify I/O: everything that
//!   reaches notify `unwatch` takes a `TransitionGuard`. H (`map`) is a leaf,
//!   taken only in `with_map` around one pure `HoldMap` call: no I/O, no
//!   other lock. Order: T → H, and T → watcher → list → L5. A register takes
//!   neither T nor H. The notify callback never takes T: notify's `stop()`
//!   joins the callback thread, so waiting on T there would deadlock a
//!   teardown.
//! - **Every acquisition still runs the legacy register**, so the D86 seed,
//!   the D111 seed check and the baseline overwrite are what they were; only
//!   release is layered.
//! - **A spelling joins `notify_spellings` when it is reserved**, so a
//!   register raced by its own release is still cleared at the teardown.
//! - **A duplicate keeps its group**: the group is fixed at the first
//!   acquisition, and a later symlink retarget is not followed.
//! - Gen 0 is never issued; replies use 0 for "no hold".
//!
//! @coordinates-with services/file_watcher.rs (parent; the `holders` field
//! and the legacy `watch` / `unwatch`), file_watcher_holders_teardown.rs
//! (the `FileWatcher` API: `reserve_hold`, `confirm_hold`, `release_hold`,
//! `release_window`, and the I/O and log lines behind them),
//! commands/file.rs and commands/draft_recover_watch.rs (the acquisitions),
//! commands/watch_hold.rs (`release_watch_hold`), main.rs (`release_window`
//! on `Destroyed`), file_watcher_holders_outcomes.rs (the decisions' return
//! values; `impl HoldMap` stays here, where tripwire d173_wi1_k reads it)
use std::collections::{BTreeMap, HashMap, HashSet};
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
        let duplicate = self.holds.get(&key).map(|h| h.group.clone());
        let group = duplicate.clone().unwrap_or_else(|| group.to_path_buf());
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
        self.holds.insert(
            key,
            Hold {
                gen,
                group: group.clone(),
            },
        );
        Some(Reserved {
            gen,
            group,
            transition,
            counts,
        })
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

#[path = "file_watcher_holders_teardown.rs"]
mod teardown;

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
