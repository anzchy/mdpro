//! Purpose: the two ways a quit request resolves. A commit closes the draft
//! gate, deletes the discarded drafts, records and logs the report, then
//! replies YES; an abort cancels every open dialog, then replies NO.
//! Extracted from `driver.rs` under rule 50 §6 so the driver stays under 300
//! lines.
//!
//! Key decisions:
//! - **Close, then delete, then reply**, with the ADR-0035 backstop already
//!   finished before any of it (plan A1): the gate's write guard covers the
//!   whole deletion loop (ADR-0025 §4), and is released before the coordinator
//!   mutex is taken and before the reply is posted.
//! - **`gateWaitMs` is the time `close()` spent waiting** for an in-flight save
//!   to release the gate (ADR-0035 A6), measured around `close()` alone — not
//!   the deletes. It goes to the log only, never into `CommitReport`, so the
//!   report stays a deterministic record of what was done.
//! - One draft that will not go must not strand the quit: it is counted and
//!   the rest still run.
//! - `ids` arrive with the backstop's redrafts already removed (review M-1);
//!   `undiscarded` in the report counts them, never names them.
//!
//! @coordinates-with src-tauri/src/services/quit_guard/driver.rs
//! @coordinates-with docs/adr/0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md

use super::super::coordinator::BackstopTally;
use super::{logging, AbortReason, CommitReport, QuitEffects, QuitEvent, QuitGuard};
use crate::services::draft;
use std::time::Instant;

impl<E: QuitEffects> QuitGuard<E> {
    /// Run a `Plan::Abort`: close every open dialog before refusing, so no
    /// window is left showing a prompt for a request that no longer exists.
    pub(super) fn abort(&self, request_id: u64, reason: &AbortReason, round: u32) {
        logging::log_cancel(request_id, reason);
        if !self
            .effects
            .emit_all(QuitEvent::Cancelled { request_id, round })
        {
            logging::log_effect_failed(request_id, "emitCancelled");
        }
        if !self.effects.reply(false) {
            logging::log_effect_failed(request_id, "reply");
        }
    }

    /// Run a `Plan::Commit`. `backstop` is `None` when no backstop ran.
    pub(super) fn commit(&self, request_id: u64, ids: &[String], backstop: Option<BackstopTally>) {
        // One critical section for the close AND the deletes. A save that is
        // mid-write holds this off until it finishes, and no save can start
        // once it is taken — so nothing can write a discarded draft back
        // behind the loop (ADR-0025 §4).
        let (mut report, gate_wait_ms) = {
            let asked = Instant::now();
            let _closed = self.committed.close();
            let waited = asked.elapsed().as_millis();
            let gate_wait_ms = u64::try_from(waited).unwrap_or(u64::MAX);
            (delete_discarded(&self.effects, ids), gate_wait_ms)
        };
        if let Some(tally) = backstop {
            report.drafted = tally.drafted;
            report.draft_failed = tally.failed;
            report.draft_missing = tally.missing;
            report.capped = tally.capped;
            report.undiscarded = usize::try_from(tally.undiscarded).unwrap_or(usize::MAX);
            report.backstop = true;
        }
        // The gate guard is released above, before the coordinator mutex is
        // taken and before the reply is posted: see the lock ordering in the
        // driver's header.
        self.lock().last_commit_report = Some(report);
        logging::log_commit(request_id, &report, gate_wait_ms);
        if !self.effects.reply(true) {
            logging::log_effect_failed(request_id, "reply");
        }
    }
}

/// Delete each discarded document's draft, telling `effects.on_delete` first.
/// The caller holds the draft gate closed for the whole loop.
fn delete_discarded<E: QuitEffects>(effects: &E, ids: &[String]) -> CommitReport {
    let mut report = CommitReport::default();
    for id in ids {
        effects.on_delete(id);
        match draft::delete_draft(id) {
            Ok(true) => report.deleted += 1,
            // Nothing to delete: the draft was never written.
            Ok(false) => {}
            Err(_) => report.failed += 1,
        }
    }
    report
}
