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
//!   time. Ids a window has already discarded stand after it disappears.
//! - **An ignored input leaves the state untouched**, so a late or duplicate
//!   reply from a recovering webview can never advance the machine.
//! - **Deadlines bound machines, never people** (ADR-0029). Phase 1's ack and
//!   phase 2's *delivery* ack are a webview making progress, so both are
//!   bounded; the user reading the dialog (`Status::Deciding`) is not, and the
//!   request then carries no deadline at all.
//! - **The coordinator owns the one deadline**, and returns it: `Prompt` and
//!   `Rearm` carry the instant to wake at, and an early `on_tick` re-arms rather
//!   than spending the request's only timer.
//!
//! @coordinates-with docs/adr/0029-quit-deadlines-bound-machine-progress-not-people.md

/// A phase-1 ack that has not arrived by this many milliseconds hands the
/// decision to the native alert (ADR-0027).
pub const QUIT_ACK_TIMEOUT_MS: u64 = 2_000;

/// A phase-2 prompt whose **delivery** ack has not arrived this long after that
/// prompt was issued hands the request to the same alert (ADR-0029 §1). It
/// bounds the webview's drawing of the dialog, never the user's reading of it.
pub const QUIT_PROMPT_DELIVERY_TIMEOUT_MS: u64 = 2_000;

pub use super::types::*;

use super::request::{Request, Status};

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

    /// One window's answer, in whichever phase it is in.
    pub fn on_answer(&mut self, request_id: u64, label: &str, answer: Answer, now_ms: u64) -> Step {
        let Some(request) = self.request.as_mut() else {
            return refuse(IgnoredWhy::StaleRequest);
        };
        if request.id != request_id {
            return refuse(IgnoredWhy::StaleRequest);
        }
        if request.fallback {
            return refuse(IgnoredWhy::FallbackOwns);
        }
        let Some(at) = request.position_of(label) else {
            return refuse(IgnoredWhy::UnknownLabel);
        };
        match (request.windows[at].status, &answer) {
            // Phase 1: the ack.
            (Status::Pending, Answer::Clean) => request.windows[at].status = Status::Settled,
            (Status::Pending, Answer::Dirty) => request.windows[at].status = Status::Queued,
            // The delivery ack: the dialog is on screen, so what is outstanding
            // stops being a machine step and becomes a person's decision. Valid
            // from `Prompted` only — see the `Deciding` arm below for why the
            // repeat is a duplicate rather than a phase error.
            (Status::Prompted, Answer::Delivered) => {
                request.windows[at].status = Status::Deciding;
                request.deadline_ms = None;
                return Step::Wait;
            }
            // A second ack for the same dialog. It is a retransmission of a true
            // statement, not a protocol fault: a webview that re-renders its
            // dialog would otherwise log an error for behaving correctly.
            (Status::Deciding, Answer::Delivered) => return refuse(IgnoredWhy::Duplicate),
            // Phase 2: the prompted window decides. `clean` means the user saved
            // in the meantime, so it is a discard with no ids. A decision that
            // arrives without the ack is its own delivery confirmation — a user
            // fast enough to beat their own ack must still be heard.
            (Status::Prompted | Status::Deciding, Answer::Clean) => {
                request.windows[at].status = Status::Settled
            }
            (Status::Prompted | Status::Deciding, Answer::Discard(ids)) => {
                request.windows[at].status = Status::Settled;
                request.add_discards(ids);
            }
            (Status::Prompted | Status::Deciding, Answer::Cancel) => {
                let by = request.windows[at].label.clone();
                self.request = None;
                return Step::Abort {
                    reason: AbortReason::Cancelled { by },
                };
            }
            // An ack from a window that has already acked.
            (Status::Queued | Status::Settled, Answer::Clean | Answer::Dirty) => {
                return refuse(IgnoredWhy::Duplicate)
            }
            // `discard` / `cancel` from a window that was never prompted,
            // `dirty` from the window that is prompted right now, and the
            // delivery ack for a dialog that was never asked for.
            _ => return refuse(IgnoredWhy::OutOfPhase),
        }
        self.advance(now_ms)
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
        let timed_out = request.machine_side_outstanding();
        if timed_out.is_empty() {
            request.deadline_ms = None;
            return Step::Wait;
        }
        request.fallback = true;
        Step::NativeFallback { timed_out }
    }

    /// A prompt that could not be delivered to `label` (ADR-0029 §4). Waiting
    /// out a deadline for a dialog that was never sent only delays the alert;
    /// the failure is already known, so the request goes over at once.
    pub fn on_delivery_failed(&mut self, request_id: u64, label: &str) -> Step {
        let Some(request) = self.request.as_mut() else {
            return refuse(IgnoredWhy::StaleRequest);
        };
        if request.id != request_id {
            return refuse(IgnoredWhy::StaleRequest);
        }
        if request.fallback {
            return refuse(IgnoredWhy::FallbackOwns);
        }
        let Some(status) = request.status_of(label) else {
            return refuse(IgnoredWhy::UnknownLabel);
        };
        // Only the window that is waiting for its dialog can fail to receive
        // one. A report for a `Deciding` window is stale by definition — its
        // dialog is demonstrably on screen — and acting on it would take the
        // request away from a user who is looking at it.
        if status != Status::Prompted {
            return refuse(IgnoredWhy::OutOfPhase);
        }
        request.fallback = true;
        Step::NativeFallback {
            timed_out: vec![label.to_string()],
        }
    }

    /// The alert `on_tick` / `on_delivery_failed` handed the request to could not
    /// be posted (ADR-0029 §4). Hand it back, so the windows still listening can
    /// resolve it. No deadline is set: the alert is the last machine-side step
    /// there is, and re-arming would retry a failing main-thread dispatch every
    /// two seconds for as long as the app runs.
    pub fn release_fallback(&mut self, request_id: u64) -> bool {
        let Some(request) = self.request.as_mut() else {
            return false;
        };
        if request.id != request_id || !request.fallback {
            return false;
        }
        request.fallback = false;
        request.deadline_ms = None;
        true
    }

    /// A window destroyed mid-request counts as `clean`, once.
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
        if window.status == Status::Settled {
            // Already counted, and any ids it discarded stand.
            return Step::Wait;
        }
        window.status = Status::Settled;
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
            },
        }
    }

    /// The step the live request is owed now: wait, prompt the next dirty window,
    /// or commit. `now_ms` is when the input that got here happened, so a prompt
    /// issued from it is timed from it.
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
        let discard_document_ids = std::mem::take(&mut request.discard_document_ids);
        self.request = None;
        Step::Commit {
            discard_document_ids,
        }
    }
}

// Specification files, one per area; see `.claude/rules/10-tdd.md`.
#[cfg(test)]
#[path = "coordinator_deadline_tests.rs"]
mod coordinator_deadline_tests;
#[cfg(test)]
#[path = "coordinator_domain_tests.rs"]
mod coordinator_domain_tests;
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
#[path = "coordinator_tests.rs"]
mod coordinator_tests;
