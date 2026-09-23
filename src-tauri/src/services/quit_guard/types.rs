//! Purpose: the vocabulary the quit coordinator and its driver speak.
//!
//! Extracted from `coordinator.rs` under rule 50 §6 (types → `types.rs`).
//! `coordinator` re-exports all of it, so callers and the specification files
//! name these through `services::quit_guard::coordinator`.
//!
//! Key decisions:
//! - `Step` is the whole instruction set the driver has to handle; every input
//!   returns exactly one, so there is no implicit "nothing happened" case.
//! - `NativeFallback` and `FallbackAnswer` exist because ADR-0027 supersedes
//!   ADR-0025 §3: a missing ack draws a native alert instead of cancelling.
//! - **The coordinator owns every deadline** (ADR-0029). `Prompt` and `Rearm`
//!   therefore carry the absolute instant the driver must wake at; the driver
//!   never computes one of its own, because only the coordinator knows whether
//!   what is outstanding is a machine step or a human decision.
//!
//! @coordinates-with docs/adr/0027-a-quit-ack-timeout-draws-a-native-alert.md
//! @coordinates-with docs/adr/0029-quit-deadlines-bound-machine-progress-not-people.md

/// One window's answer, in either phase.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Answer {
    Clean,
    Dirty,
    Discard(Vec<String>),
    Cancel,
    /// The phase-2 delivery ack (ADR-0029 §1): the window has committed the
    /// dialog UI. It ends the bounded part of phase 2 and hands the window
    /// unbounded time to decide.
    Delivered,
}

/// The user's answer to the native timeout alert (ADR-0027).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FallbackAnswer {
    KeepOpen,
    QuitAnyway,
}

/// What `begin` tells the native hook to reply.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Begin {
    TerminateNow,
    Later { request_id: u64 },
    AlreadyPending,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AbortReason {
    Cancelled { by: String },
    UserKeptOpen,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IgnoredWhy {
    StaleRequest,
    UnknownLabel,
    OutOfPhase,
    Duplicate,
    FallbackOwns,
}

impl IgnoredWhy {
    /// The identifier a refusal is logged under. A refused answer that reaches
    /// the log as a bare success makes a quit that did nothing look healthy, so
    /// the reason travels with it.
    pub fn as_str(self) -> &'static str {
        match self {
            IgnoredWhy::StaleRequest => "staleRequest",
            IgnoredWhy::UnknownLabel => "unknownLabel",
            IgnoredWhy::OutOfPhase => "outOfPhase",
            IgnoredWhy::Duplicate => "duplicate",
            IgnoredWhy::FallbackOwns => "fallbackOwns",
        }
    }
}

/// What the driver must do after an input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    Wait,
    /// Prompt `label`, and wake again at `deadline_ms` — the instant its
    /// delivery ack stops being late and starts being a failure.
    Prompt {
        label: String,
        deadline_ms: u64,
    },
    /// The tick arrived early. Re-arm for `deadline_ms` rather than dropping
    /// the request's only wake-up (ADR-0029 §5).
    Rearm {
        deadline_ms: u64,
    },
    Commit {
        discard_document_ids: Vec<String>,
    },
    Abort {
        reason: AbortReason,
    },
    Ignored {
        why: IgnoredWhy,
    },
    NativeFallback {
        timed_out: Vec<String>,
    },
}
