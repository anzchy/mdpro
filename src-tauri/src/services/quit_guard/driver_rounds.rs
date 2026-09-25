//! Purpose: run the ADR-0035 round steps the coordinator returns before a
//! commit — the re-check and the draft backstop — and take a window's
//! `Drafted` answer to the backstop.
//!
//! Split out of `driver.rs` under rule 50 §6. `run` hands every round plan here
//! with nothing held, the same as its own arms.
//!
//! Key decisions:
//! - **A re-check is the phase-1 broadcast again**, with the same request id
//!   and the next round, so a window answers it through the handler it already
//!   has. Its deadline is the coordinator's, and a broadcast that failed is
//!   logged as `emitRecheck` and left to that deadline, which routes to the
//!   native alert as phase 1 does.
//! - **The backstop is its own event, `app:quit-backstop`** `{requestId,
//!   round}`, sent to every window. A failed broadcast is logged as
//!   `emitBackstop` and its deadline is still armed: that deadline commits,
//!   counting the silent windows as `draftMissing` (plan A2).
//! - Each round start is logged (`app.quit.recheck` / `app.quit.backstop`,
//!   counts only). A `Drafted` answer goes through `driver_wire.rs` like every
//!   other answer: validated, then logged after the coordinator ruled.
//!
//! @coordinates-with docs/adr/0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md

use super::{logging, Plan, QuitAnswer, QuitEffects, QuitEvent, QuitGuard};

impl<E: QuitEffects> QuitGuard<E> {
    /// Run one round plan. Every other plan is `run`'s own.
    pub(super) fn run_round(&self, plan: Plan) {
        match plan {
            Plan::Recheck {
                request_id,
                deadline_ms,
                window_count,
                round,
            } => {
                logging::log_recheck(request_id, round, window_count);
                if !self
                    .effects
                    .emit_all(QuitEvent::Requested { request_id, round })
                {
                    logging::log_effect_failed(request_id, "emitRecheck");
                }
                self.effects.arm_timer(request_id, deadline_ms);
            }
            Plan::Backstop {
                request_id,
                deadline_ms,
                window_count,
                round,
            } => {
                logging::log_backstop(request_id, round, window_count);
                if !self
                    .effects
                    .emit_all(QuitEvent::Backstop { request_id, round })
                {
                    logging::log_effect_failed(request_id, "emitBackstop");
                }
                self.effects.arm_timer(request_id, deadline_ms);
            }
            // `run` routes only the two round plans here.
            other => self.run(other),
        }
    }

    /// A window's answer to the backstop: it drafted `counts.0` documents and
    /// failed to draft `counts.1`. Counts only, never ids. Untagged; it goes
    /// through `handle_wire_reply`, so the counts are validated and the answer
    /// logged exactly as one from `quit_guard_reply` — a refusal is logged there
    /// and has nothing further to report to this caller.
    pub fn handle_drafted(&self, label: &str, request_id: u64, counts: (u32, u32), now_ms: u64) {
        let _ = self.handle_wire_reply(
            label,
            request_id,
            QuitAnswer::Drafted,
            None,
            Some(counts.0),
            Some(counts.1),
            None,
            now_ms,
        );
    }
}
