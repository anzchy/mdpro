//! The second-holder reconcile (D173-WI-4, plan r2 §5, ADR-0086 decision 6;
//! Codex review BLOCK 1).
//!
//! Purpose: a register into a live group overwrites the shared baseline, so
//! an external write whose event had not routed yet is absorbed: the delayed
//! event then routes `IgnoredUnchanged`. `reserve_hold` copies the prior
//! entry out (`prior_entry`) before the register; a current `confirm_hold`,
//! after dropping T, runs `reconcile_hold`, which compares it with the entry
//! the register stored. On a divergence every distinct held spelling of the
//! group gets one plain `file:changed` `modified` (no `origin`) through
//! `NoticeSink::emit_plain`, and one `file.watch.reconcile` line is logged.
//!
//! Pipeline: `reserve_hold` → `prior_entry` (lock L5 only) → T → H → the
//! legacy register → `confirm_hold` (T → H, `drop(t)`) → `reconcile_hold` →
//! `prior_entry` again → `consumer_spellings` (parent; H only) → `emit_plain` per
//! spelling → `file.watch.reconcile`.
//!
//! Key decisions:
//! - **Hash, not stat.** The same bytes under a new mtime have nothing to
//!   reload. A missing hash on either side, or no stored entry, is diverged
//!   (ADR-0068: unknown never compares equal).
//! - **No prior entry, no reconcile**: a first holder, including one after
//!   the group was fully released, is never told. A confirm that lost its
//!   hold never reaches here.
//! - **A Save As never reconciles** (`Reservation::without_reconcile`,
//!   D173-WI-4b): its save notice carries `origin` and already reaches every
//!   holder; an origin-less one would prompt the saving document itself.
//! - **Outside every lock, no I/O of its own** (tripwire d173_wi4_k): the
//!   entry copies are pure L5 reads by a key the reservation already has
//!   (the group key, else the raw spelling, the store's fallback key).
//! - **No `origin`**: every window records it, the acquiring one too; its
//!   new document may prompt once for bytes its own read holds (a recorded
//!   limit). An emit `Err` is counted and logged at error level, never retried.
//!
//! @coordinates-with services/file_watcher_holders.rs (parent;
//! `consumer_spellings`), services/file_watcher_holders_teardown.rs (`reserve_hold`,
//! `confirm_hold`; uses `line`), services/file_watcher_baseline_peek.rs
//! (`entry_of`), services/file_watcher_save_notice.rs (`NoticeSink`,
//! `now_millis`)
use super::super::save_notice::now_millis;
use super::super::seed::Entry;
use super::super::{FileChangedEvent, FileWatcher};
use super::Reservation;
use crate::models::log_entry::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use serde_json::{json, Value};
use std::path::Path;

const RECONCILE_EVENT: &str = "file.watch.reconcile";

impl FileWatcher {
    /// The baseline entry the group `group` has now, read by the group key,
    /// else by `raw` (the key a register stores under when it cannot
    /// canonicalise). Lock L5 only, no I/O.
    pub(super) fn prior_entry(&self, group: &Path, raw: &Path) -> Option<Entry> {
        self.baselines
            .entry_of(group)
            .or_else(|| self.baselines.entry_of(raw))
    }

    /// After a current confirm, with T dropped: when the reservation copied
    /// a prior entry, is not a Save As's, and the stored one diverges from it, one plain
    /// `modified` per held spelling, then one `file.watch.reconcile` line.
    pub(super) fn reconcile_hold(&self, r: &Reservation) {
        let Some(prior) = r.prior.filter(|_| r.reconcile) else {
            return;
        };
        let stored = self.prior_entry(&r.group, &r.raw);
        let diverged = diverged(&prior, stored.as_ref());
        let spellings = if diverged {
            self.consumer_spellings(&r.group)
        } else {
            Vec::new()
        };
        let timestamp = now_millis();
        let (mut emitted, mut first_error) = (0usize, None::<String>);
        for spelling in &spellings {
            let event = FileChangedEvent {
                path: spelling.clone(),
                change_type: "modified".to_string(),
                new_path: None,
                timestamp,
            };
            match self.notices.emit_plain(&event) {
                Ok(()) => emitted += 1,
                Err(e) => {
                    first_error.get_or_insert(e);
                }
            }
        }
        let context = json!({
            "path": r.raw.to_string_lossy(),
            "windowLabel": r.label,
            "gen": r.gen,
            "diverged": diverged,
            "priorHash": prior.hash.is_some(),
            "storedHash": stored.and_then(|e| e.hash).is_some(),
            "spellings": spellings,
            "emitted": emitted,
        });
        let mut entry = line(RECONCILE_EVENT, LogLevel::Info, LogStatus::Success, context);
        if first_error.is_some() {
            (entry.level, entry.status, entry.error) =
                (LogLevel::Error, LogStatus::Fail, first_error);
        }
        logger::log_event(entry);
    }
}

/// Diverged unless both entries carry a hash and the hashes are equal.
fn diverged(prior: &Entry, stored: Option<&Entry>) -> bool {
    match (prior.hash, stored.and_then(|e| e.hash)) {
        (Some(a), Some(b)) => a != b,
        _ => true,
    }
}

/// A holders log line with `context` and no action id, duration or error.
pub(super) fn line(
    event: &str,
    level: LogLevel,
    status: LogStatus,
    context: Value,
) -> LogEntryPayload {
    LogEntryPayload {
        level,
        event: event.to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error: None,
    }
}
