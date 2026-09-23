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

/// An event the driver sends to the frontend.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuitEvent {
    Requested { request_id: u64 },
    Prompt { request_id: u64 },
    Cancelled { request_id: u64 },
}

impl QuitEvent {
    /// The name the frontend listens on.
    pub fn name(&self) -> &'static str {
        match self {
            QuitEvent::Requested { .. } => "app:quit-requested",
            QuitEvent::Prompt { .. } => "app:quit-prompt",
            QuitEvent::Cancelled { .. } => "app:quit-cancelled",
        }
    }

    pub fn request_id(&self) -> u64 {
        match self {
            QuitEvent::Requested { request_id }
            | QuitEvent::Prompt { request_id }
            | QuitEvent::Cancelled { request_id } => *request_id,
        }
    }
}

/// What one commit did to the drafts of the discarded documents.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CommitReport {
    pub deleted: usize,
    pub failed: usize,
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
    /// `false` when the timeout alert could not be posted to the main thread.
    fn native_fallback(&self, request_id: u64, timed_out: Vec<String>) -> bool;

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
