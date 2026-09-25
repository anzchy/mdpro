//! Purpose: the events the quit driver sends out, and the seam it sends them
//! through.
//!
//! Extracted from `driver.rs` under rule 50 §6 (types → their own file), and
//! kept apart from `types.rs` so the coordinator's vocabulary does not grow a
//! platform seam it has no business knowing about.
//!
//! Key decisions:
//! - One trait for every platform effect, so the whole quit protocol runs
//!   headless against a recording implementation.
//! - Draft deletion is **not** in the trait. It is the one effect whose failure
//!   is data loss, so the tests exercise the real filesystem; `on_delete` is an
//!   observation point, not a substitution.
//! - The alert's answer enters through `deliver_fallback`, so the one call
//!   site that can find no guard logs it instead of dropping it.

use super::coordinator::FallbackAnswer;
use super::driver::QuitGuard;
use super::logging;

#[path = "alert_text.rs"]
pub(super) mod alert_text;

/// Why the driver is presenting the ADR-0027 native alert. The driver knows it
/// from which call site it is on; the alert text is picked from it
/// (`alert_text::fallback_alert_text`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FallbackCause {
    /// The ack timer ran out, or a prompt could not be delivered to its window.
    Timeout,
    /// The user chose "Stop Waiting and Quit…" (ADR-0030, ADR-0036).
    Escape,
}

/// An event the driver sends to the frontend. `round` is the request's round
/// when the event went out: 0 for phase 1, then +1 per re-check (ADR-0035 A5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuitEvent {
    Requested {
        request_id: u64,
        round: u32,
    },
    Prompt {
        request_id: u64,
        round: u32,
    },
    Cancelled {
        request_id: u64,
        round: u32,
    },
    /// Draft every dirty document now (ADR-0035 §4): the last round before
    /// the commit.
    Backstop {
        request_id: u64,
        round: u32,
    },
}

impl QuitEvent {
    /// The name the frontend listens on.
    pub fn name(&self) -> &'static str {
        match self {
            QuitEvent::Requested { .. } => "app:quit-requested",
            QuitEvent::Prompt { .. } => "app:quit-prompt",
            QuitEvent::Cancelled { .. } => "app:quit-cancelled",
            QuitEvent::Backstop { .. } => "app:quit-backstop",
        }
    }

    pub fn request_id(&self) -> u64 {
        match self {
            QuitEvent::Requested { request_id, .. }
            | QuitEvent::Prompt { request_id, .. }
            | QuitEvent::Cancelled { request_id, .. }
            | QuitEvent::Backstop { request_id, .. } => *request_id,
        }
    }

    pub fn round(&self) -> u32 {
        match self {
            QuitEvent::Requested { round, .. }
            | QuitEvent::Prompt { round, .. }
            | QuitEvent::Cancelled { round, .. }
            | QuitEvent::Backstop { round, .. } => *round,
        }
    }
}

/// What one commit did: the drafts of the discarded documents, and the draft
/// backstop's tally (ADR-0035 §4-5). Counts only, never ids.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CommitReport {
    pub deleted: usize,
    pub failed: usize,
    /// Backstop drafts written, summed over every window's `Drafted`.
    pub drafted: u32,
    /// Backstop draft writes that failed.
    pub draft_failed: u32,
    /// Windows still drafting when the backstop deadline passed.
    pub draft_missing: u32,
    /// Windows dirty again after their one re-prompt (plan A8: a window count).
    pub capped: u32,
    /// Whether a backstop round ran. The ADR-0027 `QuitAnyway` and an all-gone
    /// request commit without one.
    pub backstop: bool,
    /// Discarded ids whose deletion was cancelled because the window that
    /// discarded them redrafted them in the backstop after an edit (ADR-0035
    /// review M-1). A count, never the ids.
    pub undiscarded: usize,
}

/// Every platform effect the driver can have.
///
/// Every effect but the timer returns whether it was dispatched (ADR-0029
/// §4). A discarded failure of a liveness-critical one is not a lost log line
/// but a permanently unquittable app, so the driver has to be able to see it;
/// the others (`emit_all`, `activate`) are logged and change nothing. The
/// timer reports its own main-thread dispatch (`effects::report_dispatch`).
pub trait QuitEffects: Send + Sync + 'static {
    /// `false` when the broadcast could not be emitted.
    fn emit_all(&self, event: QuitEvent) -> bool;
    /// `false` when the event could not be handed to `label`'s webview.
    fn emit_to(&self, label: &str, event: QuitEvent) -> bool;
    /// `false` when the app or `label`'s window could not be brought forward.
    fn activate(&self, label: &str) -> bool;
    fn arm_timer(&self, request_id: u64, deadline_ms: u64);
    /// `false` when `replyToApplicationShouldTerminate:` could not be posted.
    fn reply(&self, terminate: bool) -> bool;
    /// `false` when the fallback alert could not be posted to the main thread.
    /// `cause` is why the driver is presenting it: its ack timer or an
    /// undeliverable prompt (`Timeout`), or the escape hatch (`Escape`).
    fn native_fallback(
        &self,
        request_id: u64,
        timed_out: Vec<String>,
        cause: FallbackCause,
    ) -> bool;

    /// Called immediately before each real `delete_draft`.
    fn on_delete(&self, document_id: &str) {
        let _ = document_id;
    }
}

/// Where the ADR-0027 alert's answer goes. A trait so the macOS call site's
/// routing (`deliver_fallback`) is testable without an `AppHandle`.
pub trait FallbackSink {
    fn fallback_answer(&self, request_id: u64, answer: FallbackAnswer);
}

impl<E: QuitEffects> FallbackSink for QuitGuard<E> {
    fn fallback_answer(&self, request_id: u64, answer: FallbackAnswer) {
        QuitGuard::fallback_answer(self, request_id, answer);
    }
}

/// Hand the alert's answer to the guard, or log that there was none.
///
/// The macOS alert calls this with `try_state::<AppQuitGuard>()`. A missing
/// guard writes one `app.quit.fallback` fail line (`noGuard`) instead of
/// dropping the answer silently; a present one is exactly a direct call.
pub fn deliver_fallback<G: FallbackSink>(
    guard: Option<&G>,
    request_id: u64,
    answer: FallbackAnswer,
) {
    match guard {
        Some(guard) => guard.fallback_answer(request_id, answer),
        None => logging::log_fallback_no_guard(request_id, answer),
    }
}
