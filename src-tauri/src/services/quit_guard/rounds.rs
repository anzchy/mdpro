//! Purpose: where one answer puts a window, and the re-check rounds ADR-0035
//! runs before a quit commits.
//!
//! Extracted from `coordinator.rs` under rule 50 §6. The split is by role: this
//! file rules on a single window's answer and opens rounds; the coordinator
//! decides what the driver is owed, and owns dropping the request.
//!
//! Key decisions:
//! - **Every commit is preceded by a re-check** (ADR-0035 §1). `recheck_due` is
//!   set when the request opens and again whenever a prompt is issued, and a
//!   round clears it. A round with no prompt in it therefore ends the rounds, so
//!   a request passes at most N+1 of them.
//! - **The re-check is the phase-1 question, asked again.** Every live window
//!   goes back to `Pending` under a fresh ack deadline timed from the round's
//!   start, so a silent window falls back through the unchanged phase-1 rule.
//! - **One re-prompt per window** (ADR-0035 §3). Only a re-check-induced queue
//!   spends a window's bit; a phase-1 prompt does not. A window dirty again
//!   after its re-prompt is settled and counted in `capped`, never prompted a
//!   third time — an app that cannot be quit is the worse defect.
//! - **The backstop follows the rounds** (ADR-0035 §4). A `Drafted` answer is
//!   ruled on in `backstop.rs`, the one place that knows the tally.
//! - **`Gone` is absorbing.** A destroyed webview is never asked again, and a
//!   round with no live window left is not started.
//!
//! @coordinates-with docs/adr/0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md

use super::coordinator::QUIT_ACK_TIMEOUT_MS;
use super::request::{Request, Status};
use super::types::{Answer, IgnoredWhy, Step};

/// What one answer did to its window, for the coordinator to act on.
pub(super) enum Ruling {
    /// The window moved; the request may be owed its next step.
    Advance,
    /// The window moved, and nothing else is owed yet.
    Hold,
    /// Declined; nothing changed.
    Refuse(IgnoredWhy),
    /// The prompted window's user kept the app open.
    Cancelled { by: String },
}

impl Request {
    /// Apply `answer` from the window at `at`.
    pub fn rule(&mut self, at: usize, answer: Answer) -> Ruling {
        match (self.windows[at].status, answer) {
            // The ack, in phase 1 or in a re-check round.
            (Status::Pending, Answer::Clean) => self.windows[at].status = Status::Settled,
            (Status::Pending, Answer::Dirty) => self.queue_dirty(at),
            // The delivery ack: the dialog is on screen, so what is outstanding
            // stops being a machine step and becomes a person's decision. Valid
            // from `Prompted` only — see the `Deciding` arm below for why the
            // repeat is a duplicate rather than a phase error.
            (Status::Prompted, Answer::Delivered) => {
                self.windows[at].status = Status::Deciding;
                self.deadline_ms = None;
                return Ruling::Hold;
            }
            // A second ack for the same dialog. It is a retransmission of a true
            // statement, not a protocol fault: a webview that re-renders its
            // dialog would otherwise log an error for behaving correctly.
            (Status::Deciding, Answer::Delivered) => return Ruling::Refuse(IgnoredWhy::Duplicate),
            // Phase 2: the prompted window decides. `clean` means the user saved
            // in the meantime, so it is a discard with no ids. A decision that
            // arrives without the ack is its own delivery confirmation — a user
            // fast enough to beat their own ack must still be heard.
            (Status::Prompted | Status::Deciding, Answer::Clean) => {
                self.windows[at].status = Status::Settled
            }
            (Status::Prompted | Status::Deciding, Answer::Discard(ids)) => {
                self.windows[at].status = Status::Settled;
                self.add_discards(&ids);
                self.windows[at].discarded.extend(ids);
            }
            (Status::Prompted | Status::Deciding, Answer::Cancel) => {
                return Ruling::Cancelled {
                    by: self.windows[at].label.clone(),
                }
            }
            // An ack from a window that has already acked this round — or that
            // is gone, which counts as having answered `clean`.
            (Status::Queued | Status::Settled | Status::Gone, Answer::Clean | Answer::Dirty) => {
                return Ruling::Refuse(IgnoredWhy::Duplicate)
            }
            // The draft backstop's answer (ADR-0035 §4); see `backstop.rs`.
            (_, Answer::Drafted { drafted, failed }) => {
                return self.drafted(at, drafted, failed, Vec::new())
            }
            (
                _,
                Answer::DraftedUndiscarding {
                    drafted,
                    failed,
                    undiscarded,
                },
            ) => return self.drafted(at, drafted, failed, undiscarded),
            // `discard` / `cancel` from a window that was never prompted,
            // `dirty` from the window that is prompted right now, and the
            // delivery ack for a dialog that was never asked for, and anything
            // but `Drafted` from a `Drafting` window.
            _ => return Ruling::Refuse(IgnoredWhy::OutOfPhase),
        }
        Ruling::Advance
    }

    /// A `dirty` ack. In phase 1 it queues the window. In a re-check it queues
    /// it once, spending its re-prompt; after that the window is settled and
    /// counted in `capped`, once per window (ADR-0035 §3).
    fn queue_dirty(&mut self, at: usize) {
        let recheck = self.round > 0;
        let window = &mut self.windows[at];
        if !recheck {
            window.status = Status::Queued;
        } else if window.reprompted {
            window.status = Status::Settled;
            if !window.capped {
                window.capped = true;
                self.capped += 1;
            }
        } else {
            window.status = Status::Queued;
            window.reprompted = true;
        }
    }

    /// Open a re-check round, if one is due and any window is still live:
    /// every live window goes back to `Pending` on a fresh ack deadline timed
    /// from `now_ms`.
    pub fn start_recheck(&mut self, now_ms: u64) -> Option<Step> {
        let window_count = self
            .windows
            .iter()
            .filter(|w| w.status != Status::Gone)
            .count();
        if !self.recheck_due || window_count == 0 {
            return None;
        }
        for window in self.windows.iter_mut() {
            if window.status != Status::Gone {
                window.status = Status::Pending;
            }
        }
        self.recheck_due = false;
        self.round += 1;
        let deadline_ms = now_ms.saturating_add(QUIT_ACK_TIMEOUT_MS);
        self.deadline_ms = Some(deadline_ms);
        Some(Step::Recheck {
            deadline_ms,
            window_count,
        })
    }
}
