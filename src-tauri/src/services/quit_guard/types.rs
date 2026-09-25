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
    /// The backstop ack (ADR-0035 §4): this window wrote a draft for every
    /// document still dirty in it. Counts only, never ids. Valid from
    /// `Drafting` only.
    Drafted {
        drafted: u32,
        failed: u32,
    },
    /// A `Drafted` answer that also names ids this window discarded in this
    /// request and has since redrafted after an edit (ADR-0035 review M-1).
    /// The commit keeps their drafts. Only the wire builds it, and only with a
    /// non-empty list; ids the window did not discard are ignored.
    DraftedUndiscarding {
        drafted: u32,
        failed: u32,
        undiscarded: Vec<String>,
    },
}

/// What the commit-phase draft backstop (ADR-0035 §4-5) did, in counts only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BackstopTally {
    /// Drafts written, summed over every accepted `Drafted` answer.
    pub drafted: u32,
    /// Draft writes that failed, summed the same way.
    pub failed: u32,
    /// Windows still `Drafting` when the backstop deadline passed.
    pub missing: u32,
    /// Windows dirty again after their one re-prompt (ADR-0035 §3).
    pub capped: u32,
    /// Discarded ids whose deletion the discarding window cancelled by
    /// redrafting them after an edit (ADR-0035 review M-1).
    pub undiscarded: u32,
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
    StaleRound,
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
            IgnoredWhy::StaleRound => "staleRound",
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
    Recheck {
        deadline_ms: u64,
        window_count: usize,
    },
    /// Ask every live window to draft its dirty documents before the commit
    /// (ADR-0035 §4), and wake at `deadline_ms`, which commits regardless.
    Backstop {
        deadline_ms: u64,
        window_count: usize,
    },
    /// `backstop` is `None` when no backstop ran: the ADR-0027 alert's
    /// `QuitAnyway`, and a request whose windows were all gone first.
    Commit {
        discard_document_ids: Vec<String>,
        backstop: Option<BackstopTally>,
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
