//! Purpose: combine every window's answer to a quit request into one decision.
//!
//! A pure state machine: no `AppHandle`, no objc, no clock — time arrives as
//! `now_ms`. That keeps the whole quit protocol testable without a running app
//! and lets the module compile on every platform. The driver (WI-3) owns the
//! side effects: emitting the ack requests, deleting drafts, and logging steps.
//!
//! Key decisions:
//! - **Two phases.** Phase 1 collects one `clean` / `dirty` ack per window;
//!   phase 2 prompts the dirty windows one at a time, in snapshot order. A
//!   second `Prompt` is issued only once the first window has answered.
//! - **ADR-0027 supersedes ADR-0025 §3.** A phase-1 ack that never arrives no
//!   longer cancels the quit: the request goes to a native alert
//!   (`Step::NativeFallback`) which owns it exclusively — every other input is
//!   `Ignored { why: FallbackOwns }` — and resolves it via `on_fallback_answer`.
//! - **`QuitAnyway` commits an empty id set.** Drafts are the last copy of the
//!   discarded work, so a request no window ever answered deletes none.
//! - **A gone window counts as `clean`** in every position, and never a second
//!   time. Ids a window has already discarded stand after it disappears, and it
//!   is `Status::Gone` so no re-check round ever asks it again.
//! - **Every commit is preceded by a re-check round** (ADR-0035): the live
//!   windows are asked the phase-1 question again, and a window dirty again is
//!   prompted at most once more. The round logic lives in `rounds.rs`.
//! - **Then by a draft backstop** (ADR-0035 §4, `backstop.rs`), whose deadline
//!   commits with the tally rather than raising the alert (plan A2, A4). The
//!   alert's delivery-failure inputs live in the child `fallback.rs`.
//! - **An ignored input leaves the state untouched**, so a late or duplicate
//!   reply from a recovering webview can never advance the machine.
//! - **Deadlines bound machines, never people** (ADR-0029). Phase 1's ack and
//!   phase 2's *delivery* ack are a webview making progress, so both are
//!   bounded; the user reading the dialog (`Status::Deciding`) is not, and the
//!   request then carries no deadline at all.
//! - **The coordinator owns the one deadline**, and returns it: `Prompt` and
//!   `Rearm` carry the instant to wake at, and an early `on_tick` re-arms rather
//!   than spending the request's only timer.
//! - **The escape hatch is one more pure input** (ADR-0030, ADR-0036):
//!   `on_escape` (child `escape.rs`) takes no clock and hands a live request to
//!   the same ADR-0027 alert, except during the backstop (`OutOfPhase`) or
//!   when the alert already owns it; idle and committed are a no-op.
//!
//! @coordinates-with docs/adr/0029-quit-deadlines-bound-machine-progress-not-people.md

/// A phase-1 ack that has not arrived by this many milliseconds hands the
/// decision to the native alert (ADR-0027).
pub const QUIT_ACK_TIMEOUT_MS: u64 = 2_000;

/// A phase-2 prompt whose **delivery** ack has not arrived this long after that
/// prompt was issued hands the request to the same alert (ADR-0029 §1). It
/// bounds the webview's drawing of the dialog, never the user's reading of it.
pub const QUIT_PROMPT_DELIVERY_TIMEOUT_MS: u64 = 2_000;

/// The draft backstop (ADR-0035 §4) is a machine step: this long after it was
/// issued, the request commits with whatever was drafted (§5, plan A2).
pub const QUIT_BACKSTOP_TIMEOUT_MS: u64 = 2_000;

pub use super::types::*;

use super::request::{Request, Status};
use super::rounds::Ruling;

/// An input the coordinator declines to act on; the state is left untouched.
fn refuse(why: IgnoredWhy) -> Step {
    Step::Ignored { why }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QuitCoordinator {
    last_request_id: u64,
    request: Option<Request>,
}

impl QuitCoordinator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open a quit request over `window_labels`, the snapshot taken now.
    pub fn begin<S: AsRef<str>>(&mut self, window_labels: &[S], now_ms: u64) -> Begin {
        // A live request outranks an empty snapshot (ADR-0025 §2). The order
        // matters: a fallback-owned request survives `on_window_gone`, so every
        // window can be gone with the alert still on screen, and answering
        // `TerminateNow` there would quit past an alert nobody answered.
        if self.request.is_some() {
            return Begin::AlreadyPending;
        }
        if window_labels.is_empty() {
            return Begin::TerminateNow;
        }
        self.last_request_id += 1;
        self.request = Some(Request::open(self.last_request_id, window_labels, now_ms));
        Begin::Later {
            request_id: self.last_request_id,
        }
    }

    /// Is a request open (D74)? `false` once it commits or is cancelled.
    pub fn is_live(&self) -> bool {
        self.request.is_some()
    }

    /// The live request's round (ADR-0035 A5): 0 for phase 1, +1 per re-check.
    /// `None` when no request is live.
    pub fn round(&self) -> Option<u32> {
        self.request.as_ref().map(|r| r.round)
    }

    /// One window's answer, in whichever phase it is in. Legacy entry: the
    /// same as `on_answer_in` with no round tag.
    pub fn on_answer(&mut self, request_id: u64, label: &str, answer: Answer, now_ms: u64) -> Step {
        self.on_answer_in(request_id, None, label, answer, now_ms)
    }

    /// One window's answer, tagged with the round it answers (ADR-0035 A5). A
    /// tag from any other round is a reordered reply and changes nothing; no
    /// tag means "the current round", which keeps untagged callers working.
    pub fn on_answer_in(
        &mut self,
        request_id: u64,
        round: Option<u32>,
        label: &str,
        answer: Answer,
        now_ms: u64,
    ) -> Step {
        let Some(request) = self.request.as_mut() else {
            return refuse(IgnoredWhy::StaleRequest);
        };
        if request.id != request_id {
            return refuse(IgnoredWhy::StaleRequest);
        }
        if request.fallback {
            return refuse(IgnoredWhy::FallbackOwns);
        }
        // After the id and the fallback, so the log names the reason that
        // matters most for triage.
        if round.is_some_and(|k| k != request.round) {
            return refuse(IgnoredWhy::StaleRound);
        }
        let Some(at) = request.position_of(label) else {
            return refuse(IgnoredWhy::UnknownLabel);
        };
        match request.rule(at, answer) {
            Ruling::Advance => self.advance(now_ms),
            Ruling::Hold => Step::Wait,
            Ruling::Refuse(why) => refuse(why),
            Ruling::Cancelled { by } => {
                self.request = None;
                Step::Abort {
                    reason: AbortReason::Cancelled { by },
                }
            }
        }
    }

    /// The deadline the driver was told to wake at. An early tick re-arms it
    /// (ADR-0029 §5); a reached one hands the request to the native alert.
    pub fn on_tick(&mut self, now_ms: u64) -> Step {
        let Some(request) = self.request.as_mut() else {
            return refuse(IgnoredWhy::StaleRequest);
        };
        if request.fallback {
            return refuse(IgnoredWhy::FallbackOwns);
        }
        // Nothing machine-side is outstanding: a user is reading a dialog, and
        // no amount of elapsed time makes that a failure.
        let Some(deadline_ms) = request.deadline_ms else {
            return Step::Wait;
        };
        // Early — including a clock that went backwards — puts the wake-up
        // back. Returning `Wait` here is what used to spend the request's only
        // timer and leave it with no deadline at all.
        if now_ms < deadline_ms {
            return Step::Rearm { deadline_ms };
        }
        // Before the early return below (plan A4): every `Drafting` window is
        // outside `machine_side_outstanding`, which would strand the quit.
        if let Some(commit) = self.backstop_expired() {
            return commit;
        }
        let Some(request) = self.request.as_mut() else {
            return Step::Wait;
        };
        let timed_out = request.machine_side_outstanding();
        if timed_out.is_empty() {
            request.deadline_ms = None;
            return Step::Wait;
        }
        request.fallback = true;
        Step::NativeFallback { timed_out }
    }

    /// A window destroyed mid-request counts as `clean`, once, and is never
    /// asked again (ADR-0035: a re-check must not wait on a dead webview).
    pub fn on_window_gone(&mut self, label: &str, now_ms: u64) -> Step {
        let Some(request) = self.request.as_mut() else {
            return refuse(IgnoredWhy::StaleRequest);
        };
        if request.fallback {
            return refuse(IgnoredWhy::FallbackOwns);
        }
        let Some(window) = request.windows.iter_mut().find(|w| w.label == label) else {
            return refuse(IgnoredWhy::UnknownLabel);
        };
        if window.status == Status::Gone {
            // Already counted, and any ids it discarded stand.
            return Step::Wait;
        }
        window.status = Status::Gone;
        self.advance(now_ms)
    }

    /// The user's answer to the native alert (ADR-0027). It resolves the request
    /// outright, and `QuitAnyway` deletes no drafts.
    pub fn on_fallback_answer(&mut self, request_id: u64, answer: FallbackAnswer) -> Step {
        let Some(request) = self.request.as_ref() else {
            return refuse(IgnoredWhy::StaleRequest);
        };
        if request.id != request_id {
            return refuse(IgnoredWhy::StaleRequest);
        }
        if !request.fallback {
            return refuse(IgnoredWhy::OutOfPhase);
        }
        self.request = None;
        match answer {
            FallbackAnswer::KeepOpen => Step::Abort {
                reason: AbortReason::UserKeptOpen,
            },
            FallbackAnswer::QuitAnyway => Step::Commit {
                discard_document_ids: Vec::new(),
                backstop: None,
            },
        }
    }

    /// The step the live request is owed now: wait, prompt the next dirty
    /// window, re-check the live windows, open the backstop (ADR-0035), or
    /// commit. `now_ms` is when the triggering input happened.
    fn advance(&mut self, now_ms: u64) -> Step {
        let Some(request) = self.request.as_mut() else {
            return Step::Wait;
        };
        if request.outstanding() {
            return Step::Wait;
        }
        if let Some((label, deadline_ms)) = request.promote_next_queued(now_ms) {
            return Step::Prompt { label, deadline_ms };
        }
        if let Some(recheck) = request.start_recheck(now_ms) {
            return recheck;
        }
        if let Some(backstop) = request.start_backstop(now_ms) {
            return backstop;
        }
        self.commit()
    }
}

#[path = "backstop.rs"]
mod backstop;
#[path = "escape.rs"]
mod escape;
pub use escape::{escape_ruling, EscapePhase, EscapeRuling};
#[path = "fallback.rs"]
mod fallback;

// Specification files, one per area; see `.claude/rules/10-tdd.md`.
#[cfg(test)]
#[path = "coordinator_backstop_tests.rs"]
mod coordinator_backstop_tests;
#[cfg(test)]
#[path = "coordinator_deadline_tests.rs"]
mod coordinator_deadline_tests;
#[cfg(test)]
#[path = "coordinator_domain_tests.rs"]
mod coordinator_domain_tests;
#[cfg(test)]
#[path = "coordinator_escape_tests.rs"]
mod coordinator_escape_tests;
#[cfg(test)]
#[path = "coordinator_fallback_tests.rs"]
mod coordinator_fallback_tests;
#[cfg(test)]
#[path = "coordinator_gone_tests.rs"]
mod coordinator_gone_tests;
#[cfg(test)]
#[path = "coordinator_props_rel_tests.rs"]
mod coordinator_props_rel_tests;
#[cfg(test)]
#[path = "coordinator_props_tests.rs"]
mod coordinator_props_tests;
#[cfg(test)]
#[path = "coordinator_recheck_tests.rs"]
mod coordinator_recheck_tests;
#[cfg(test)]
#[path = "coordinator_tests.rs"]
mod coordinator_tests;
