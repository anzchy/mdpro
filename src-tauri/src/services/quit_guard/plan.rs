//! Purpose: turn a coordinator `Step` into the work the driver does **after** it
//! has let go of the lock.
//!
//! Extracted from `driver.rs` under rule 50 §6. The split is by role: a `Step`
//! is what the state machine decided, a `Plan` is what the platform must be told
//! about it. Nothing here touches the mutex, the effects, or the draft gate —
//! `translate` is pure, which is what makes "no effect ever runs under the lock"
//! checkable by reading one function.
//!
//! Key decisions:
//! - **`Plan` carries the request id the driver knew, not one read later.** By
//!   the time the effect runs, the coordinator may already be on the next
//!   request; a log line or a fallback that re-read the id would name the wrong
//!   one.
//! - **`resolves_request` replaces an out-parameter.** `Abort` and `Commit` are
//!   the two steps that end the request, and the driver clears its `current`
//!   from that one predicate instead of duplicating the match. `Recheck` and
//!   `Backstop` (ADR-0035) are rounds of the live request, never its end, so
//!   they are deliberately outside it.
//! - **A plan carries the round the driver read under the lock** (ADR-0035
//!   A5), for the same reason it carries the request id: the event payload
//!   must name the round the window is answering.
//!
//! @coordinates-with docs/adr/0029-quit-deadlines-bound-machine-progress-not-people.md
//! @coordinates-with docs/adr/0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md

use super::coordinator::{AbortReason, BackstopTally, IgnoredWhy, Step};

/// What to do once the lock is released. Computed under the lock so the driver's
/// own state is already consistent before any effect can re-enter it.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Plan {
    Nothing,
    Prompt {
        request_id: u64,
        label: String,
        deadline_ms: u64,
        round: u32,
    },
    Rearm {
        request_id: u64,
        deadline_ms: u64,
    },
    /// Ask every live window the phase-1 question again (ADR-0035). It does
    /// not resolve the request.
    Recheck {
        request_id: u64,
        deadline_ms: u64,
        window_count: usize,
        round: u32,
    },
    /// Ask every live window to draft its dirty documents (ADR-0035 §4). It
    /// does not resolve the request.
    Backstop {
        request_id: u64,
        deadline_ms: u64,
        window_count: usize,
        round: u32,
    },
    Fallback {
        request_id: u64,
        timed_out: Vec<String>,
    },
    Abort {
        request_id: u64,
        reason: AbortReason,
        round: u32,
    },
    Commit {
        request_id: u64,
        discard_document_ids: Vec<String>,
        backstop: Option<BackstopTally>,
    },
}

impl Plan {
    /// Does running this plan end the live request? The driver drops its
    /// `current` id when it does.
    pub(super) fn resolves_request(&self) -> bool {
        matches!(self, Plan::Abort { .. } | Plan::Commit { .. })
    }
}

/// One `Step`, plus the refusal reason when the coordinator declined the input —
/// the caller decides whether that is worth a log line, because only the caller
/// knows what was refused.
pub(super) fn translate(step: Step, request_id: u64, round: u32) -> (Plan, Option<IgnoredWhy>) {
    match step {
        Step::Wait => (Plan::Nothing, None),
        // The refusal itself produces no effect; whether it is worth a line
        // depends on the input, and only `handle_reply` has that context.
        Step::Ignored { why } => (Plan::Nothing, Some(why)),
        Step::Recheck {
            deadline_ms,
            window_count,
        } => (
            Plan::Recheck {
                request_id,
                deadline_ms,
                window_count,
                round,
            },
            None,
        ),
        Step::Backstop {
            deadline_ms,
            window_count,
        } => (
            Plan::Backstop {
                request_id,
                deadline_ms,
                window_count,
                round,
            },
            None,
        ),
        Step::Rearm { deadline_ms } => (
            Plan::Rearm {
                request_id,
                deadline_ms,
            },
            None,
        ),
        Step::Prompt { label, deadline_ms } => (
            Plan::Prompt {
                request_id,
                label,
                deadline_ms,
                round,
            },
            None,
        ),
        Step::NativeFallback { timed_out } => (
            Plan::Fallback {
                request_id,
                timed_out,
            },
            None,
        ),
        Step::Abort { reason } => (
            Plan::Abort {
                request_id,
                reason,
                round,
            },
            None,
        ),
        Step::Commit {
            discard_document_ids,
            backstop,
        } => (
            Plan::Commit {
                request_id,
                discard_document_ids,
                backstop,
            },
            None,
        ),
    }
}
