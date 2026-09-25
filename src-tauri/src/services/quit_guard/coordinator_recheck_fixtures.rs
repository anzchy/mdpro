//! Shared builders for the ADR-0035 re-check specifications (WI-1).
//!
//! Registered from `coordinator_recheck_tests.rs`. Every spec that used to see
//! `Commit` straight after the last answer now routes through
//! `finish_recheck_and_backstop`, the one shared helper the test matrix names,
//! so the path to the commit is written down once.
//!
//! WI-2 form: the step after the last re-check answer is `Backstop`, and
//! `finish_backstop` answers it `Drafted { 0, 0 }` from every drafting window,
//! so a finished request commits with `BackstopTally::default()` plus whatever
//! it capped.

use super::*;

pub(in super::super) use super::super::coordinator_tests::{
    begin_later, cancelled_by, commit, commit_ids_sorted, discard, ignored,
};

/// The live request. Panics when there is none, naming why.
pub(crate) fn req(c: &QuitCoordinator) -> &Request {
    c.request
        .as_ref()
        .expect("expected a live quit request, found none")
}

pub(crate) fn status(c: &QuitCoordinator, label: &str) -> Status {
    req(c)
        .status_of(label)
        .unwrap_or_else(|| panic!("no window {label} in the request"))
}

pub(crate) fn reprompted(c: &QuitCoordinator, label: &str) -> bool {
    let request = req(c);
    let at = request
        .position_of(label)
        .unwrap_or_else(|| panic!("no window {label} in the request"));
    request.windows[at].reprompted
}

pub(crate) fn round(c: &QuitCoordinator) -> u32 {
    req(c).round
}

/// The labels still owed a re-check answer, in snapshot order.
pub(crate) fn pending_labels(c: &QuitCoordinator) -> Vec<String> {
    req(c)
        .windows
        .iter()
        .filter(|w| w.status == Status::Pending)
        .map(|w| w.label.clone())
        .collect()
}

/// Answer `Clean` from every window of the open re-check round, then run the
/// backstop leg, and return the step that resolves the request.
pub(crate) fn finish_recheck_and_backstop(c: &mut QuitCoordinator, r: u64, now: u64) -> Step {
    let labels = pending_labels(c);
    assert!(!labels.is_empty(), "no re-check round is open to finish");
    let mut step = Step::Wait;
    let mut t = now;
    for label in &labels {
        step = c.on_answer(r, label, Answer::Clean, t);
        t += 1;
    }
    finish_backstop(c, r, step, t)
}

/// `step` must be the `Recheck` the last answer produced; finish from there.
pub(crate) fn through_recheck(c: &mut QuitCoordinator, r: u64, step: Step, now: u64) -> Step {
    assert!(
        matches!(step, Step::Recheck { .. }),
        "ADR-0035: a commit must be preceded by a re-check round, got {step:?}"
    );
    finish_recheck_and_backstop(c, r, now)
}

/// The labels still owed a `Drafted` answer, in snapshot order.
pub(crate) fn drafting_labels(c: &QuitCoordinator) -> Vec<String> {
    req(c)
        .windows
        .iter()
        .filter(|w| w.status == Status::Drafting)
        .map(|w| w.label.clone())
        .collect()
}

/// The commit a request reaches through a clean backstop: nothing drafted,
/// nothing failed, nothing missing, nothing capped.
pub(crate) fn commit_after_backstop(ids: &[&str]) -> Step {
    Step::Commit {
        discard_document_ids: ids.iter().map(|s| (*s).to_string()).collect(),
        backstop: Some(BackstopTally::default()),
    }
}

/// The leg between the last re-check answer and the commit: `step` must be
/// the `Backstop` it produced. Every drafting window answers `Drafted { 0, 0 }`,
/// one ms apart from `now`, and the step that resolves the request is returned.
pub(crate) fn finish_backstop(c: &mut QuitCoordinator, r: u64, step: Step, now: u64) -> Step {
    assert!(
        matches!(step, Step::Backstop { .. }),
        "ADR-0035: the last re-check answer must open the backstop, got {step:?}"
    );
    let mut step = step;
    for (t, label) in (now..).zip(drafting_labels(c)) {
        let drafted = Answer::Drafted {
            drafted: 0,
            failed: 0,
        };
        step = c.on_answer(r, &label, drafted, t);
    }
    assert!(
        matches!(step, Step::Commit { .. }),
        "expected the request to commit after the backstop, got {step:?}"
    );
    step
}
