//! Purpose: the commit-phase draft backstop (ADR-0035 §4-5) — the last round a
//! quit request runs before it commits, and the tally the commit carries.
//!
//! A child of `coordinator.rs`, extracted under rule 50 §6. It owns opening the
//! backstop, accepting a `Drafted` answer, and building the `Commit` step; the
//! coordinator decides *when* each happens.
//!
//! Key decisions:
//! - **After the rounds, before the gate closes** (plan A1). The backstop opens
//!   once no re-check is due, over every live window, and at most once.
//! - **A machine step whose deadline commits** (plan A2). `Drafting` is
//!   outstanding but never machine-side, so a silent window is counted in
//!   `missing` rather than raising the ADR-0027 alert.
//! - **The tally is a sum.** `drafted` and `failed` add up every accepted
//!   `Drafted` answer; a window gone while drafting is neither drafted nor
//!   missing.
//! - **Only a backstop-bearing commit carries a tally.** The all-gone path and
//!   the alert's `QuitAnyway` commit with `backstop: None`.
//! - **A redraft of a discarded document survives** (review M-1). A `Drafted`
//!   answer may name ids its window discarded and then redrafted after an
//!   edit; the commit drops an id from the delete list only when no window
//!   still stands behind its discard, and counts it in `undiscarded`.
//!
//! @coordinates-with docs/adr/0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md

use super::{BackstopTally, QuitCoordinator, Step, QUIT_BACKSTOP_TIMEOUT_MS};
use crate::services::quit_guard::request::{Request, Status};
use crate::services::quit_guard::rounds::Ruling;
use crate::services::quit_guard::types::IgnoredWhy;

impl Request {
    /// Open the backstop, if it has not run and any window is still live:
    /// every live window goes to `Drafting` on a deadline timed from `now_ms`.
    pub(in crate::services::quit_guard) fn start_backstop(&mut self, now_ms: u64) -> Option<Step> {
        let window_count = self
            .windows
            .iter()
            .filter(|w| w.status != Status::Gone)
            .count();
        if self.backstop.is_some() || window_count == 0 {
            return None;
        }
        for window in self.windows.iter_mut() {
            if window.status != Status::Gone {
                window.status = Status::Drafting;
            }
        }
        self.backstop = Some(BackstopTally::default());
        let deadline_ms = now_ms.saturating_add(QUIT_BACKSTOP_TIMEOUT_MS);
        self.deadline_ms = Some(deadline_ms);
        Some(Step::Backstop {
            deadline_ms,
            window_count,
        })
    }

    /// A `Drafted` answer from the window at `at`. Accepted once, from a
    /// `Drafting` window; a repeat during the backstop is a duplicate, and one
    /// outside it is out of phase. `undiscarded` keeps only ids this same
    /// window discarded (review M-1): a window cannot cancel a sibling's discard.
    pub(in crate::services::quit_guard) fn drafted(
        &mut self,
        at: usize,
        drafted: u32,
        failed: u32,
        undiscarded: Vec<String>,
    ) -> Ruling {
        let Some(tally) = self.backstop.as_mut() else {
            return Ruling::Refuse(IgnoredWhy::OutOfPhase);
        };
        let window = &mut self.windows[at];
        match window.status {
            Status::Drafting => {
                window.status = Status::Settled;
                window.undiscarded = undiscarded
                    .into_iter()
                    .filter(|id| window.discarded.contains(id))
                    .collect();
                tally.drafted = tally.drafted.saturating_add(drafted);
                tally.failed = tally.failed.saturating_add(failed);
                Ruling::Advance
            }
            Status::Settled | Status::Gone => Ruling::Refuse(IgnoredWhy::Duplicate),
            _ => Ruling::Refuse(IgnoredWhy::OutOfPhase),
        }
    }
}

impl QuitCoordinator {
    /// The backstop deadline was reached (plan A2, A4): every window still
    /// `Drafting` is `missing`, and the request commits all the same.
    pub(super) fn backstop_expired(&mut self) -> Option<Step> {
        let request = self.request.as_mut()?;
        let missing = request
            .windows
            .iter()
            .filter(|w| w.status == Status::Drafting)
            .count();
        let tally = request.backstop.as_mut()?;
        tally.missing = u32::try_from(missing).unwrap_or(u32::MAX);
        Some(self.commit())
    }

    /// Drop the request and hand the driver its delete list, with the backstop
    /// tally when a backstop ran.
    pub(super) fn commit(&mut self) -> Step {
        let Some(request) = self.request.take() else {
            return Step::Wait;
        };
        let capped = request.capped;
        let (discard_document_ids, undiscarded) = request.kept_discards();
        Step::Commit {
            discard_document_ids,
            backstop: request.backstop.map(|t| BackstopTally {
                capped,
                undiscarded,
                ..t
            }),
        }
    }
}

impl Request {
    /// The delete list, in order, minus every id no window still stands behind:
    /// an id stays while some window discarded it and did not redraft it
    /// (review M-1). Returns the list and how many ids left it.
    fn kept_discards(&self) -> (Vec<String>, u32) {
        let kept: Vec<String> = self
            .discard_document_ids
            .iter()
            .filter(|id| {
                self.windows
                    .iter()
                    .any(|w| w.discarded.contains(id) && !w.undiscarded.contains(id))
            })
            .cloned()
            .collect();
        let dropped = self.discard_document_ids.len() - kept.len();
        (kept, u32::try_from(dropped).unwrap_or(u32::MAX))
    }
}
