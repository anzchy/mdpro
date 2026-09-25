//! Purpose: the two inputs that move a quit request into and out of the
//! ADR-0027 native alert from the side of the driver: a prompt that could not
//! be delivered, and an alert that could not be posted.
//!
//! A child of `coordinator.rs`, extracted under rule 50 §6 when the ADR-0035
//! backstop pushed that file past 300 lines. Behaviour is unchanged.
//!
//! @coordinates-with docs/adr/0029-quit-deadlines-bound-machine-progress-not-people.md

use super::{refuse, IgnoredWhy, QuitCoordinator, Status, Step};

impl QuitCoordinator {
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
}
