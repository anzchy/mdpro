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
//!   longer cancels the quit. `on_tick` hands the request to a native alert
//!   (`Step::NativeFallback`), which then owns it exclusively — every other
//!   input is `Ignored { why: FallbackOwns }` — and resolves it only through
//!   `on_fallback_answer`.
//! - **`QuitAnyway` commits an empty id set.** Drafts are the last copy of the
//!   discarded work, so a request no window ever answered deletes none.
//! - **A gone window counts as `clean`** in every position, and never a second
//!   time. Ids a window has already discarded stand after it disappears.
//! - **An ignored input leaves the state untouched**, so a late or duplicate
//!   reply from a recovering webview can never advance the machine.

/// A phase-1 ack that has not arrived by this many milliseconds hands the
/// decision to the native alert (ADR-0027).
pub const QUIT_ACK_TIMEOUT_MS: u64 = 2_000;

pub use super::types::*;

/// An input the coordinator declines to act on; the state is left untouched.
fn refuse(why: IgnoredWhy) -> Step {
    Step::Ignored { why }
}

/// Where one window has got to within the live request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Status {
    /// Has not sent its phase-1 ack yet, and can still time out.
    Pending,
    /// Acked `dirty`, waiting for its turn to be prompted.
    Queued,
    /// Prompted, waiting for `discard`, `clean` or `cancel`.
    Prompted,
    /// Done with this request: clean, discarded, or gone.
    Settled,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Window {
    label: String,
    status: Status,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Request {
    id: u64,
    started_ms: u64,
    windows: Vec<Window>,
    discard_document_ids: Vec<String>,
    /// The native alert has taken the request over (ADR-0027).
    fallback: bool,
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
        self.request = Some(Request {
            id: self.last_request_id,
            started_ms: now_ms,
            windows: window_labels
                .iter()
                .map(|label| Window {
                    label: label.as_ref().to_string(),
                    status: Status::Pending,
                })
                .collect(),
            discard_document_ids: Vec::new(),
            fallback: false,
        });
        Begin::Later {
            request_id: self.last_request_id,
        }
    }

    /// One window's answer, in whichever phase it is in.
    pub fn on_answer(
        &mut self,
        request_id: u64,
        label: &str,
        answer: Answer,
        _now_ms: u64,
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
        let Some(at) = request.windows.iter().position(|w| w.label == label) else {
            return refuse(IgnoredWhy::UnknownLabel);
        };

        match (request.windows[at].status, &answer) {
            // Phase 1: the ack.
            (Status::Pending, Answer::Clean) => request.windows[at].status = Status::Settled,
            (Status::Pending, Answer::Dirty) => request.windows[at].status = Status::Queued,
            // Phase 2: the prompted window decides. `clean` means the user saved
            // in the meantime, so it is a discard with no ids.
            (Status::Prompted, Answer::Clean) => request.windows[at].status = Status::Settled,
            (Status::Prompted, Answer::Discard(ids)) => {
                request.windows[at].status = Status::Settled;
                for id in ids {
                    if !request.discard_document_ids.contains(id) {
                        request.discard_document_ids.push(id.clone());
                    }
                }
            }
            (Status::Prompted, Answer::Cancel) => {
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
            // `discard` / `cancel` from a window that was never prompted, and
            // `dirty` from the window that is prompted right now.
            _ => return refuse(IgnoredWhy::OutOfPhase),
        }
        self.advance()
    }

    /// The ack deadline. Silent windows hand the request to the native alert.
    pub fn on_tick(&mut self, now_ms: u64) -> Step {
        let Some(request) = self.request.as_mut() else {
            return refuse(IgnoredWhy::StaleRequest);
        };
        if request.fallback {
            return refuse(IgnoredWhy::FallbackOwns);
        }
        // `saturating_sub` so a clock that goes backwards never times out.
        if now_ms.saturating_sub(request.started_ms) < QUIT_ACK_TIMEOUT_MS {
            return Step::Wait;
        }
        let timed_out: Vec<String> = request
            .windows
            .iter()
            .filter(|w| w.status == Status::Pending)
            .map(|w| w.label.clone())
            .collect();
        if timed_out.is_empty() {
            return Step::Wait;
        }
        request.fallback = true;
        Step::NativeFallback { timed_out }
    }

    /// A window destroyed mid-request counts as `clean`, once.
    pub fn on_window_gone(&mut self, label: &str) -> Step {
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
        self.advance()
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

    /// The step the live request is owed now: keep waiting, prompt the next
    /// dirty window, or commit.
    fn advance(&mut self) -> Step {
        let Some(request) = self.request.as_mut() else {
            return Step::Wait;
        };
        if request
            .windows
            .iter()
            .any(|w| matches!(w.status, Status::Pending | Status::Prompted))
        {
            return Step::Wait;
        }
        if let Some(window) = request
            .windows
            .iter_mut()
            .find(|w| w.status == Status::Queued)
        {
            window.status = Status::Prompted;
            return Step::Prompt(window.label.clone());
        }
        let discard_document_ids = std::mem::take(&mut request.discard_document_ids);
        self.request = None;
        Step::Commit {
            discard_document_ids,
        }
    }
}

#[cfg(test)]
#[path = "coordinator_tests.rs"]
mod coordinator_tests;

#[cfg(test)]
#[path = "coordinator_gone_tests.rs"]
mod coordinator_gone_tests;

#[cfg(test)]
#[path = "coordinator_fallback_tests.rs"]
mod coordinator_fallback_tests;

#[cfg(test)]
#[path = "coordinator_domain_tests.rs"]
mod coordinator_domain_tests;

#[cfg(test)]
#[path = "coordinator_props_tests.rs"]
mod coordinator_props_tests;

#[cfg(test)]
#[path = "coordinator_props_rel_tests.rs"]
mod coordinator_props_rel_tests;
