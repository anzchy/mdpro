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
/// The three liveness-critical ones return whether they were dispatched
/// (ADR-0029 §4). A discarded failure here is not a lost log line but a
/// permanently unquittable app, so the driver has to be able to see it.
pub trait QuitEffects: Send + Sync + 'static {
    fn emit_all(&self, event: QuitEvent);
    /// `false` when the event could not be handed to `label`'s webview.
    fn emit_to(&self, label: &str, event: QuitEvent) -> bool;
    fn activate(&self, label: &str);
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
