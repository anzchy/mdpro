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
//!
//! @coordinates-with docs/adr/0027-a-quit-ack-timeout-draws-a-native-alert.md

/// One window's answer, in either phase.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Answer {
    Clean,
    Dirty,
    Discard(Vec<String>),
    Cancel,
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

/// What the driver must do after an input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    Wait,
    Prompt(String),
    Commit { discard_document_ids: Vec<String> },
    Abort { reason: AbortReason },
    Ignored { why: IgnoredWhy },
    NativeFallback { timed_out: Vec<String> },
}
