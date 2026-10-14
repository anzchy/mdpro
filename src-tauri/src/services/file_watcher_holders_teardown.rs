//! The `FileWatcher` side of the D173 holders (plan r2 §3): the acquisition
//! and release API, and the I/O each holders-map decision needs.
//!
//! Purpose: `reserve_hold` / `confirm_hold` / `release_hold` / `restore_hold`
//! (audit M1) / `release_window` take lock T, ask the pure `HoldMap` (parent)
//! under H, then, outside H, do what it decided to the watch list, the
//! baselines and notify (rows 7, 7b, 9), and log it: one `file.watch.hold`
//! line per reservation, one `file.watch.release` line per release, restore
//! or orphan, one `file.watch.alias_cleanup` line per extra notify spelling.
//!
//! Key decisions:
//! - **Lock T is held through every notify `unwatch`.** Each function here
//!   that reaches one takes a `TransitionGuard` (tripwire d173_wi1_k), so no
//!   reservation can interleave with a teardown. `group_key`'s canonicalize
//!   runs before T and H are taken.
//! - **`unclaim` never calls notify.** Unwatching one spelling removes the
//!   canonical filter entry every spelling of the file relies on (notify
//!   6.1.1 `remove_path`), so a spelling the group outlives only leaves the
//!   watch list and drops its baseline claim (D106 keeps the shared entry).
//!   Its ticket is drawn under the watcher and list locks, like `unwatch`'s.
//! - **The group's teardown** runs the legacy `unwatch` for the last
//!   spelling (list, baseline, notify), then `drop_notify_path` for every
//!   other spelling it reserved, clearing them from notify's stream. Their
//!   `watch_not_found` is expected: the canonical entry already went.
//! - **An orphan register** (its confirm found the hold gone) is undone only
//!   if nothing else consumes its spelling: `unclaim` while the group lives,
//!   the legacy `unwatch` when the group is gone and the spelling is listed.
//! - **D173-WI-4**: `reserve_hold` copies the prior baseline entry out before
//!   T; a current `confirm_hold` drops T, then runs the reconcile.
//!
//! @coordinates-with services/file_watcher_holders.rs (parent; the map and
//! its decisions), services/file_watcher.rs (`unwatch`, the watch list),
//! services/file_watcher_register_log.rs (`apply_watch_list`),
//! services/file_watcher_holders_reconcile.rs (`prior_entry`,
//! `reconcile_hold`, and the shared log `line`)
use super::super::watch_log::{apply_watch_list, WatchOp};
use super::super::{next_ticket, FileWatcher};
use super::reconcile::line;
use super::{GroupKey, Orphan, ReleaseOutcome, Released, Reservation, Reserved, TransitionGuard};
use crate::models::log_entry::{LogLevel, LogStatus};
use crate::services::logger;
use notify::Watcher;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const HOLD_EVENT: &str = "file.watch.hold";
const RELEASE_EVENT: &str = "file.watch.release";
const ALIAS_CLEANUP_EVENT: &str = "file.watch.alias_cleanup";

/// The group `raw` belongs to: `canonicalize(raw)`, else the canonical
/// parent joined with the file name, else `raw`. File-system I/O: never
/// called under H. Also `HoldsLeaf::spellings_of`'s lookup (D185).
pub(super) fn group_key(raw: &Path) -> GroupKey {
    if let Ok(canonical) = std::fs::canonicalize(raw) {
        return canonical;
    }
    raw.parent()
        .zip(raw.file_name())
        .and_then(|(parent, name)| std::fs::canonicalize(parent).ok().map(|p| p.join(name)))
        .unwrap_or_else(|| raw.to_path_buf())
}

impl FileWatcher {
    /// Reserve a hold on `raw` for window `label` before its register (plan
    /// §3 rows 1-4); `None` when the window is fenced (row 6). Logs one
    /// `file.watch.hold` line.
    pub(crate) fn reserve_hold(&self, label: &str, raw: &Path) -> Option<Reservation> {
        let group = group_key(raw);
        let prior = self.prior_entry(&group, raw);
        let t = self.holders.transition();
        let mut reserved = None;
        self.holders
            .with_map(|m| reserved = m.reserve(label, raw, &group));
        drop(t);
        log_hold(label, raw, reserved.as_ref());
        let r = reserved?;
        Some(Reservation {
            gen: r.gen,
            prior_gen: r.prior,
            raw: raw.to_path_buf(),
            label: label.to_string(),
            group: r.group,
            prior,
            reconcile: true,
        })
    }

    /// After the register: true when the reservation is still the current
    /// hold, and then, with T dropped, the second-holder reconcile (D173-WI-4).
    /// Otherwise the window was destroyed or the hold released during the
    /// register, what the register left is torn down (row 9), and no notice.
    pub(crate) fn confirm_hold(&self, reservation: &Reservation) -> bool {
        let t = self.holders.transition();
        let mut current = false;
        let (label, raw, gen) = (&reservation.label, &reservation.raw, reservation.gen);
        self.holders
            .with_map(|m| current = m.is_current(label, raw, gen));
        if !current {
            self.retire_orphan(&t, reservation);
            return false;
        }
        drop(t);
        self.reconcile_hold(reservation);
        true
    }

    /// Release window `label`'s hold on `raw` if `gen` is its current one
    /// (rows 7, 7b). Logs one `file.watch.release` line.
    pub(crate) fn release_hold(&self, label: &str, raw: &Path, gen: u64) -> ReleaseOutcome {
        let t = self.holders.transition();
        self.release_locked(&t, label, raw, gen, "release")
    }

    /// Audit M1: a failed Save As settles a duplicate reservation by putting
    /// back the hold's prior gen, so the window keeps the hold it had. False,
    /// changing nothing, for a new hold (the caller releases it) or one that
    /// is no longer current. Logs a `file.watch.release` line when it restores.
    pub(crate) fn restore_hold(&self, r: &Reservation) -> bool {
        let Some(prior) = r.prior_gen else {
            return false;
        };
        let _t = self.holders.transition();
        let mut restored = false;
        self.holders
            .with_map(|m| restored = m.restore(&r.label, &r.raw, r.gen, prior));
        if restored {
            let context = json!({ "transition": "save_as_failed", "outcome": "restored",
                "windowLabel": r.label, "gen": prior, "path": r.raw.to_string_lossy() });
            log_release(context);
        }
        restored
    }

    /// `WindowEvent::Destroyed`: fence `label`, then release each of its
    /// holds (row 8). Never call it on `CloseRequested`, which can be vetoed.
    pub fn release_window(&self, label: &str) {
        let t = self.holders.transition();
        let mut held = Vec::new();
        self.holders.with_map(|m| held = m.fence(label));
        for (raw, gen) in held {
            self.release_locked(&t, label, &raw, gen, "window_destroyed");
        }
    }
}

impl FileWatcher {
    /// Release (`label`, `raw`, `gen`) and do what the map decided: nothing,
    /// an `unclaim`, or the group's teardown. `reason` names the caller.
    fn release_locked(
        &self,
        t: &TransitionGuard<'_>,
        label: &str,
        raw: &Path,
        gen: u64,
        reason: &str,
    ) -> ReleaseOutcome {
        let mut released = Released::of(ReleaseOutcome::NotHeld);
        self.holders
            .with_map(|m| released = m.release(label, raw, gen));
        match released.outcome {
            ReleaseOutcome::UnclaimedRaw => self.unclaim(t, raw),
            ReleaseOutcome::BackendReleased => self.teardown_group(t, raw, &released.others),
            ReleaseOutcome::Stale | ReleaseOutcome::KeptRaw | ReleaseOutcome::NotHeld => {}
        }
        let counts = released.counts;
        let context = json!({
            "transition": reason,
            "outcome": released.outcome.as_str(),
            "windowLabel": label,
            "gen": gen,
            "groupConsumers": counts.group,
            "rawConsumers": counts.raw,
            "path": raw.to_string_lossy(),
        });
        log_release(context);
        released.outcome
    }

    /// A confirm found its hold gone: undo what its register left unless
    /// another hold still consumes the spelling (row 9).
    fn retire_orphan(&self, t: &TransitionGuard<'_>, r: &Reservation) {
        let mut orphan = Orphan::Held;
        self.holders
            .with_map(|m| orphan = m.orphan(&r.raw, &r.group));
        let undone = match orphan {
            Orphan::Held => "none",
            Orphan::Unclaim => {
                self.unclaim(t, &r.raw);
                "unclaim"
            }
            Orphan::GroupGone if self.is_listed(&r.raw) => {
                self.unwatch(&r.raw);
                "unwatch"
            }
            Orphan::GroupGone => "none",
        };
        let context = json!({
            "transition": "orphan",
            "undone": undone,
            "windowLabel": r.label,
            "gen": r.gen,
            "path": r.raw.to_string_lossy(),
        });
        log_release(context);
    }

    /// The group emptied: the legacy `unwatch` of the last spelling, then
    /// every other spelling the group gave notify.
    fn teardown_group(&self, _t: &TransitionGuard<'_>, last: &Path, others: &[PathBuf]) {
        self.unwatch(last);
        for spelling in others {
            self.drop_notify_path(spelling);
        }
    }

    /// Take `raw` off the watch list and drop its baseline claim, with no
    /// notify call: the group still lives through another spelling.
    fn unclaim(&self, _t: &TransitionGuard<'_>, raw: &Path) {
        let ticket = {
            let (Ok(_watcher), Ok(mut list), ticket) = (
                self.watcher.lock(),
                self.watched_paths.lock(),
                next_ticket(),
            ) else {
                return;
            };
            apply_watch_list(&mut list, &raw.to_string_lossy(), WatchOp::Unregister);
            ticket
        };
        self.baselines.remove_at(raw, ticket);
    }

    /// notify `unwatch` only (no list, no baseline), for a spelling the
    /// teardown clears from the stream after the last one.
    fn drop_notify_path(&self, raw: &Path) {
        let result = match self.watcher.lock() {
            Ok(mut watcher) => watcher.unwatch(raw).map_err(|e| e.to_string()),
            Err(_) => return,
        };
        let context = json!({
            "path": raw.to_string_lossy(),
            "ok": result.is_ok(),
            "error": result.err(),
        });
        logger::log_event(line(
            ALIAS_CLEANUP_EVENT,
            LogLevel::Info,
            LogStatus::Success,
            context,
        ));
    }

    fn is_listed(&self, raw: &Path) -> bool {
        let raw = raw.to_string_lossy();
        let listed = self
            .watched_paths
            .lock()
            .map(|list| list.iter().any(|p| *p == raw));
        listed.unwrap_or(false)
    }
}

/// One info `file.watch.release` line with `context`.
fn log_release(context: Value) {
    logger::log_event(line(
        RELEASE_EVENT,
        LogLevel::Info,
        LogStatus::Success,
        context,
    ));
}

/// The `file.watch.hold` line for one reservation; a refused one (fenced
/// window) is a warn `cancel` with gen 0.
fn log_hold(label: &str, raw: &Path, reserved: Option<&Reserved>) {
    let path = raw.to_string_lossy();
    let entry = match reserved {
        Some(r) => line(
            HOLD_EVENT,
            LogLevel::Info,
            LogStatus::Success,
            json!({
                "transition": r.transition,
                "windowLabel": label,
                "gen": r.gen,
                "groupConsumers": r.counts.group,
                "rawConsumers": r.counts.raw,
                "path": path,
            }),
        ),
        None => line(
            HOLD_EVENT,
            LogLevel::Warn,
            LogStatus::Cancel,
            json!({ "transition": "refused", "windowLabel": label, "gen": 0, "path": path }),
        ),
    };
    logger::log_event(entry);
}
