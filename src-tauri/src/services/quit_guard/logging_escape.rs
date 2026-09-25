//! Purpose: the `app.quit.escape` log line (ADR-0030, ADR-0036): what "Stop
//! Waiting and Quit…" did, in which phase, to how many unresolved windows.
//!
//! A child of `logging.rs`, which is at its line budget; it writes through the
//! parent's private `write`.
//!
//! Key decisions:
//! - **Counts only.** The builder takes no window label or document id, so no
//!   caller can leak one into the line.
//! - `outcome`, `phase` and `unresolvedCount` are always present. `requestId`,
//!   `round` and `reason` are present only when given — absent, never `null`.
//! - **Every outcome is Info / `success`.** A refused escape is the hatch
//!   working as designed, not a failure.
//!
//! @coordinates-with src-tauri/src/services/quit_guard/escape.rs

use serde_json::{json, Value};

use super::write;
use crate::models::LogStatus;
use crate::services::quit_guard::coordinator::EscapePhase;

/// What the escape did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EscapeOutcome {
    /// The ADR-0027 alert was posted for the live request.
    Fallback,
    /// There was nothing to rescue (idle, committed, or no guard).
    Noop,
    /// A live request the escape refused to touch; `reason` says why.
    Ignored,
}

impl EscapeOutcome {
    fn as_str(self) -> &'static str {
        match self {
            EscapeOutcome::Fallback => "fallback",
            EscapeOutcome::Noop => "noop",
            EscapeOutcome::Ignored => "ignored",
        }
    }
}

/// The D7 wire string of a phase. `checking` covers phase 1 and every
/// re-check round; the round is its own key.
fn phase_str(phase: EscapePhase) -> &'static str {
    match phase {
        EscapePhase::Idle => "idle",
        EscapePhase::Checking { .. } => "checking",
        EscapePhase::AwaitingDelivery => "awaitingDelivery",
        EscapePhase::Deciding => "deciding",
        EscapePhase::Backstop => "backstop",
        EscapePhase::Fallback => "fallback",
    }
}

/// Context for `app.quit.escape`. Key presence is a projection of the
/// arguments, never derived from `outcome`.
pub fn escape_log_context(
    outcome: EscapeOutcome,
    phase: EscapePhase,
    request_id: Option<u64>,
    round: Option<u32>,
    unresolved_count: usize,
    reason: Option<&str>,
) -> Value {
    let mut context = json!({
        "outcome": outcome.as_str(),
        "phase": phase_str(phase),
        "unresolvedCount": unresolved_count,
    });
    if let Some(map) = context.as_object_mut() {
        if let Some(id) = request_id {
            map.insert("requestId".to_string(), json!(id));
        }
        if let Some(round) = round {
            map.insert("round".to_string(), json!(round));
        }
        if let Some(reason) = reason {
            map.insert("reason".to_string(), json!(reason));
        }
    }
    context
}

/// `app.quit.escape`: one Info / `success` line per escape, whatever the
/// outcome.
pub(in crate::services::quit_guard) fn log_escape(
    outcome: EscapeOutcome,
    phase: EscapePhase,
    request_id: Option<u64>,
    round: Option<u32>,
    unresolved_count: usize,
    reason: Option<&str>,
) {
    write(
        "app.quit.escape",
        LogStatus::Success,
        escape_log_context(outcome, phase, request_id, round, unresolved_count, reason),
        None,
    );
}

#[cfg(test)]
#[path = "logging_escape_tests.rs"]
mod tests;
