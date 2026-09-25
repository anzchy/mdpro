//! Purpose: the stuck-quit escape hatch's ruling (ADR-0030, shaped by
//! ADR-0036): which phase a quit request is in, and what "Stop Waiting and
//! Quit…" does to it there.
//!
//! A child of `coordinator.rs`. Pure and clock-free: `on_escape` takes no
//! `now_ms` and never reads a deadline, because the escape is a person asking,
//! not a machine running late. The driver (`driver_escape.rs`) owns logging
//! and the alert; `escape_view` is what it logs, read under the same lock.
//!
//! Per-phase rulings (precedence when markers overlap, highest first:
//! fallback, backstop, Prompted, Deciding, then everything else):
//!
//! | Phase                                   | Ruling                         |
//! |-----------------------------------------|--------------------------------|
//! | Idle (no live request)                  | Noop (`Ignored{StaleRequest}`) |
//! | Checking: phase 1 or a re-check round   | Fallback                       |
//! | AwaitingDelivery: some window Prompted  | Fallback                       |
//! | Deciding: some window reading a dialog  | Fallback                       |
//! | Backstop in progress (ADR-0035 §4)      | Ignored(OutOfPhase) — ADR-silent |
//! | Fallback already owns the request       | Ignored(FallbackOwns)          |
//! | Committed (request taken)               | Noop — ADR-silent, = Idle      |
//!
//! Key decisions:
//! - **Fallback reuses the ADR-0027 alert** (ADR-0030 §2/§4): it sets
//!   `request.fallback` and nothing else, so `on_fallback_answer` resolves it
//!   exactly as it resolves a timer fallback. The escape never quits directly.
//! - **Backstop is ruled `OutOfPhase` (the ADRs are silent).** The ADR-0035
//!   correction rejected handing the backstop to the ADR-0027 alert, whose
//!   Quit Without Saving would drop discards the user already accepted; the
//!   backstop also commits by itself on its own 2 s machine deadline.
//! - **Committed is ruled Noop (the ADRs are silent).** After `commit()` took
//!   the request, the coordinator cannot tell it from idle, and AppKit's
//!   `NSTerminateLater` must be resolved exactly once.
//! - **`timed_out` lists every unresolved window** (not `Settled`, not `Gone`),
//!   in window order — including `Queued` and `Deciding`, which the timer's
//!   `machine_side_outstanding` leaves out.
//! - No new `Step` or `IgnoredWhy` variants, and no `_ =>` arm on these enums.
//!
//! @coordinates-with docs/adr/0030-a-menu-item-is-the-escape-hatch-for-a-stuck-quit.md
//! @coordinates-with docs/adr/0036-the-stuck-quit-escape-hatch-is-an-always-enabled-app-menu-item-without-a-shortcut.md
//! @coordinates-with docs/adr/0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md

use super::{refuse, IgnoredWhy, QuitCoordinator, Step};
use crate::services::quit_guard::request::{Request, Status};

/// Where a quit request stands, as far as the escape is concerned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EscapePhase {
    Idle,
    Checking { round: u32 },
    AwaitingDelivery,
    Deciding,
    Backstop,
    Fallback,
}

/// What the escape does in a phase.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EscapeRuling {
    Fallback,
    Noop,
    Ignored(IgnoredWhy),
}

/// Classify the live request, if any, by the documented precedence. Reads
/// only statuses, `fallback`, `backstop.is_some()` and `round` — never a
/// deadline.
pub(in crate::services::quit_guard) fn escape_phase(request: Option<&Request>) -> EscapePhase {
    let Some(request) = request else {
        return EscapePhase::Idle;
    };
    let any = |status: Status| request.windows.iter().any(|w| w.status == status);
    if request.fallback {
        EscapePhase::Fallback
    } else if request.backstop.is_some() {
        EscapePhase::Backstop
    } else if any(Status::Prompted) {
        EscapePhase::AwaitingDelivery
    } else if any(Status::Deciding) {
        EscapePhase::Deciding
    } else {
        // Pending, a re-check round, or the residual live request with
        // nothing outstanding: the alert is always a safe way to resolve it.
        EscapePhase::Checking {
            round: request.round,
        }
    }
}

/// The ruling for `phase`; one row per phase.
pub fn escape_ruling(phase: EscapePhase) -> EscapeRuling {
    match phase {
        EscapePhase::Idle => EscapeRuling::Noop,
        EscapePhase::Checking { .. } | EscapePhase::AwaitingDelivery | EscapePhase::Deciding => {
            EscapeRuling::Fallback
        }
        EscapePhase::Backstop => EscapeRuling::Ignored(IgnoredWhy::OutOfPhase),
        EscapePhase::Fallback => EscapeRuling::Ignored(IgnoredWhy::FallbackOwns),
    }
}

/// What the escape's log line reports, read in the same lock acquisition as
/// `on_escape` (WI-3, adversary G4) so the line agrees with the ruling.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EscapeView {
    pub phase: EscapePhase,
    /// `(request id, round)` of the live request; `None` when idle.
    pub live: Option<(u64, u32)>,
    /// Windows neither `Settled` nor `Gone` (plan D5); 0 when idle.
    pub unresolved: usize,
}

/// Still owed something by the person or the webview: not `Settled`, not
/// `Gone`.
fn unresolved(status: Status) -> bool {
    match status {
        Status::Pending
        | Status::Queued
        | Status::Prompted
        | Status::Deciding
        | Status::Drafting => true,
        Status::Settled | Status::Gone => false,
    }
}

impl QuitCoordinator {
    /// The person chose "Stop Waiting and Quit…" (ADR-0030). A Fallback ruling
    /// hands the request to the ADR-0027 alert by setting `fallback` and
    /// nothing else; every other ruling leaves the state untouched. Idle and
    /// committed report `StaleRequest`, which the driver logs as `noop`.
    pub fn on_escape(&mut self) -> Step {
        match escape_ruling(escape_phase(self.request.as_ref())) {
            EscapeRuling::Noop => refuse(IgnoredWhy::StaleRequest),
            EscapeRuling::Ignored(why) => refuse(why),
            EscapeRuling::Fallback => {
                let Some(request) = self.request.as_mut() else {
                    return refuse(IgnoredWhy::StaleRequest);
                };
                request.fallback = true;
                let timed_out = request
                    .windows
                    .iter()
                    .filter(|w| unresolved(w.status))
                    .map(|w| w.label.clone())
                    .collect();
                Step::NativeFallback { timed_out }
            }
        }
    }

    /// The escape's view of the request, before `on_escape` rules on it.
    /// Read-only; `on_escape` changes none of these fields.
    pub fn escape_view(&self) -> EscapeView {
        let request = self.request.as_ref();
        EscapeView {
            phase: escape_phase(request),
            live: request.map(|r| (r.id, r.round)),
            unresolved: request.map_or(0, |r| {
                r.windows.iter().filter(|w| unresolved(w.status)).count()
            }),
        }
    }

    /// The live request, read-only, for the driver specifications
    /// (`driver_escape_tests.rs`): `fallback` and `deadline_ms` have no
    /// production reader outside the coordinator.
    #[cfg(test)]
    pub(in crate::services::quit_guard) fn live_request(&self) -> Option<&Request> {
        self.request.as_ref()
    }
}
