//! Specification for `services::quit_guard::coordinator`: example cases
//! WI2-C1 .. WI2-C14 of the D16 test matrix.
//!
//! Wired from `coordinator.rs` with `#[cfg(test)] #[path = ...] mod ...;` so
//! the specification lives in a different file from the code it constrains.
//! The `on_window_gone` cases (C12, C15-C18) are in `coordinator_gone_tests.rs`
//! and the ADR-0027 timeout-fallback cases in `coordinator_fallback_tests.rs`.

use super::*;

pub(super) const EMPTY: &[&str] = &[];

/// `begin` that must hand back a request id.
pub(super) fn begin_later(c: &mut QuitCoordinator, labels: &[&str], now: u64) -> u64 {
    match c.begin(labels, now) {
        Begin::Later { request_id } => request_id,
        other => panic!("expected Begin::Later, got {other:?}"),
    }
}

pub(super) fn discard(ids: &[&str]) -> Answer {
    Answer::Discard(ids.iter().map(|s| (*s).to_string()).collect())
}

/// The expected `Prompt` step for `label`, with its deadline normalised away.
///
/// Compare against `norm(step)`, never a raw step: these cases predate
/// ADR-0029 and pin *which* window is prompted, which is all they ever pinned.
/// The deadline that `Prompt` now carries is pinned by the ADR-0029 cases in
/// `coordinator_deadline_tests.rs`, where it is the subject rather than a
/// detail every unrelated case would have to restate.
pub(super) fn prompt(label: &str) -> Step {
    Step::Prompt {
        label: label.to_string(),
        deadline_ms: 0,
    }
}

/// Drop a `Prompt`'s deadline so a pre-ADR-0029 case can compare it to
/// `prompt(label)`. Identity for every other step.
pub(super) fn norm(step: Step) -> Step {
    match step {
        Step::Prompt { label, .. } => prompt(&label),
        other => other,
    }
}

pub(super) fn commit(ids: &[&str]) -> Step {
    Step::Commit {
        discard_document_ids: ids.iter().map(|s| (*s).to_string()).collect(),
    }
}

pub(super) fn ignored(why: IgnoredWhy) -> Step {
    Step::Ignored { why }
}

pub(super) fn cancelled_by(label: &str) -> Step {
    Step::Abort {
        reason: AbortReason::Cancelled {
            by: label.to_string(),
        },
    }
}

/// The commit's ids, sorted, so a case can compare them as a set.
pub(super) fn commit_ids_sorted(step: &Step) -> Vec<String> {
    match step {
        Step::Commit {
            discard_document_ids,
        } => {
            let mut ids = discard_document_ids.clone();
            ids.sort();
            ids
        }
        other => panic!("expected Step::Commit, got {other:?}"),
    }
}

// --- WI2-C1: zero windows -> TerminateNow, and no request id is consumed ----

#[test]
fn c1_zero_windows_terminates_now_without_consuming_a_request_id() {
    let mut c = QuitCoordinator::new();
    assert_eq!(c.begin(EMPTY, 0), Begin::TerminateNow);
    assert_eq!(c.begin(EMPTY, 0), Begin::TerminateNow);
    // Nothing is pending, so a tick has no request to time out.
    assert_eq!(c.on_tick(10_000), ignored(IgnoredWhy::StaleRequest));

    let after_empty = begin_later(&mut c, &["a"], 0);
    let mut fresh = QuitCoordinator::new();
    let never_empty = begin_later(&mut fresh, &["a"], 0);
    assert_eq!(
        after_empty, never_empty,
        "an empty snapshot must not consume a request id"
    );
}

// --- WI2-C2: one clean window -------------------------------------------------

#[test]
fn c2_one_clean_window_commits_with_no_ids() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 5), commit(&[]));
}

// --- WI2-C3: dirty -> discard -------------------------------------------------

#[test]
fn c3_dirty_then_discard_prompts_then_commits_that_windows_ids() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    assert_eq!(norm(c.on_answer(r, "a", Answer::Dirty, 1)), prompt("a"));
    let step = c.on_answer(r, "a", discard(&["d1", "d2"]), 2);
    assert_eq!(commit_ids_sorted(&step), vec!["d1", "d2"]);
}

// --- WI2-C4: a discard followed by another window's cancel deletes nothing ----

#[test]
fn c4_discard_then_cancel_aborts_and_no_ids_escape() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    let trace = vec![
        norm(c.on_answer(r, "a", Answer::Dirty, 1)),
        norm(c.on_answer(r, "b", Answer::Dirty, 2)),
        norm(c.on_answer(r, "a", discard(&["a1"]), 3)),
        norm(c.on_answer(r, "b", Answer::Cancel, 4)),
    ];
    assert_eq!(
        trace,
        vec![Step::Wait, prompt("a"), prompt("b"), cancelled_by("b")]
    );
    assert!(
        !trace.iter().any(|s| matches!(s, Step::Commit { .. })),
        "a cancel after a discard must never commit: {trace:?}"
    );
}

// --- WI2-C5: the first cancel aborts at once ---------------------------------

#[test]
fn c5_first_cancel_aborts_before_any_other_window_is_prompted() {
    // Variant 1: two clean windows behind the dirty one.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b", "c"], 0);
    let trace = vec![
        norm(c.on_answer(r, "a", Answer::Dirty, 1)),
        norm(c.on_answer(r, "b", Answer::Clean, 2)),
        norm(c.on_answer(r, "c", Answer::Clean, 3)),
        norm(c.on_answer(r, "a", Answer::Cancel, 4)),
    ];
    assert_eq!(
        trace,
        vec![Step::Wait, Step::Wait, prompt("a"), cancelled_by("a")]
    );

    // Variant 2: b is dirty but has never been prompted.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    let trace = vec![
        norm(c.on_answer(r, "a", Answer::Dirty, 1)),
        norm(c.on_answer(r, "b", Answer::Dirty, 2)),
        norm(c.on_answer(r, "a", Answer::Cancel, 3)),
    ];
    assert_eq!(trace, vec![Step::Wait, prompt("a"), cancelled_by("a")]);
    assert!(
        !trace.contains(&prompt("b")),
        "b must never be prompted after the abort: {trace:?}"
    );
}

// --- WI2-C6: wrong-phase and foreign inputs are ignored and state-inert ------

/// Runs `junk` on a clone of `base`, then checks that (i) the step is the
/// expected `Ignored`, (ii) the coordinator state is byte-for-byte unchanged,
/// and (iii) the same continuation yields the same trace as on a clone that
/// never saw the junk input.
fn assert_inert(
    base: &QuitCoordinator,
    why: IgnoredWhy,
    junk: impl Fn(&mut QuitCoordinator) -> Step,
    continuation: impl Fn(&mut QuitCoordinator) -> Vec<Step>,
) {
    let mut junked = base.clone();
    let before = junked.clone();
    assert_eq!(junk(&mut junked), ignored(why));
    assert_eq!(junked, before, "an ignored input must not change the state");

    let mut clean = base.clone();
    assert_eq!(continuation(&mut junked), continuation(&mut clean));
}

#[test]
fn c6_wrong_phase_and_foreign_inputs_are_ignored_and_inert() {
    // Base 0: the request has just begun.
    let mut b0 = QuitCoordinator::new();
    let r = begin_later(&mut b0, &["a", "b"], 0);
    let cont0 = |c: &mut QuitCoordinator| {
        vec![
            c.on_answer(r, "a", Answer::Dirty, 10),
            c.on_answer(r, "b", Answer::Clean, 11),
            c.on_answer(r, "a", discard(&["a1"]), 12),
        ]
    };
    // (i) an unknown request id
    assert_inert(
        &b0,
        IgnoredWhy::StaleRequest,
        |c| c.on_answer(r + 1, "a", Answer::Clean, 1),
        cont0,
    );
    // (ii) a label outside the snapshot
    assert_inert(
        &b0,
        IgnoredWhy::UnknownLabel,
        |c| c.on_answer(r, "z", Answer::Clean, 1),
        cont0,
    );
    // (iii) a discard before any prompt
    assert_inert(
        &b0,
        IgnoredWhy::OutOfPhase,
        |c| c.on_answer(r, "a", Answer::Discard(vec![]), 1),
        cont0,
    );
    // (iv) a cancel before any prompt
    assert_inert(
        &b0,
        IgnoredWhy::OutOfPhase,
        |c| c.on_answer(r, "a", Answer::Cancel, 1),
        cont0,
    );

    // Base 1: phase 1 is closed and "a" is prompted.
    let mut b1 = b0.clone();
    assert_eq!(b1.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    assert_eq!(norm(b1.on_answer(r, "b", Answer::Clean, 2)), prompt("a"));
    let cont1 = |c: &mut QuitCoordinator| vec![c.on_answer(r, "a", discard(&["a1"]), 20)];
    // (v) a phase-1 answer from the prompted window
    assert_inert(
        &b1,
        IgnoredWhy::OutOfPhase,
        |c| c.on_answer(r, "a", Answer::Dirty, 3),
        cont1,
    );
    // (vii) a phase-2 answer from a window that was not prompted
    assert_inert(
        &b1,
        IgnoredWhy::OutOfPhase,
        |c| c.on_answer(r, "b", discard(&["x"]), 3),
        cont1,
    );

    // Base 2: "a" has answered clean, "b" has not answered.
    let mut b2 = b0.clone();
    assert_eq!(b2.on_answer(r, "a", Answer::Clean, 1), Step::Wait);
    let cont2 = |c: &mut QuitCoordinator| vec![c.on_answer(r, "b", Answer::Clean, 20)];
    // (vi) a duplicate phase-1 answer
    assert_inert(
        &b2,
        IgnoredWhy::Duplicate,
        |c| c.on_answer(r, "a", Answer::Clean, 3),
        cont2,
    );
}

// --- WI2-C7: the stale id from the previous request (the spike race) ---------

#[test]
fn c7_a_stale_request_id_from_the_previous_request_is_ignored() {
    let mut c = QuitCoordinator::new();
    let r1 = begin_later(&mut c, &["a"], 0);
    assert_eq!(norm(c.on_answer(r1, "a", Answer::Dirty, 1)), prompt("a"));
    assert_eq!(c.on_answer(r1, "a", Answer::Cancel, 2), cancelled_by("a"));

    let r2 = begin_later(&mut c, &["a"], 100);
    assert!(r2 > r1, "request ids must increase: {r1} -> {r2}");

    assert_eq!(
        c.on_answer(r1, "a", discard(&["old"]), 101),
        ignored(IgnoredWhy::StaleRequest)
    );
    let step = c.on_answer(r2, "a", Answer::Clean, 102);
    assert_eq!(step, commit(&[]));
    assert!(
        !commit_ids_sorted(&step).contains(&"old".to_string()),
        "the stale request's ids must not reach the commit"
    );
}

#[path = "coordinator_request_tests.rs"]
mod coordinator_request_tests;
