//! Q6 .. Q8b, split out of `coordinator_deadline_tests.rs` and registered from it.
//!
//! Specification for the ADR-0029 deadlines: cases WI-BLOCK1-Q1 .. Q8.
//!
//! One law, in two halves:
//!
//! - **The request always has exactly one live deadline, or none on purpose.**
//!   An early tick re-arms it instead of dropping it, and a prompt's deadline is
//!   measured from the instant that prompt was issued.
//! - **A deadline bounds machine progress, never a person.** The webview has
//!   `QUIT_PROMPT_DELIVERY_TIMEOUT_MS` to get the dialog on screen; once it has,
//!   the user has as long as they like to read it.
//!
//! These are the cases the pre-ADR-0029 liveness defect fails: the single ack
//! timer fired once and was never re-armed, so a window that was prompted and
//! never answered left `NSTerminateLater` outstanding for ever — no alert, no
//! log line, and Force Quit as the only way out.

use super::*;

// --- Q6: the ack is refused from every other phase, and is inert -------------

#[test]
fn q6_a_delivered_ack_is_refused_from_every_other_phase_and_changes_nothing() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);

    // Pending: no prompt was ever sent, so no dialog can have been delivered.
    let before = c.clone();
    assert_eq!(
        c.on_answer(r, "a", Answer::Delivered, 1),
        ignored(IgnoredWhy::OutOfPhase)
    );
    assert_eq!(c, before, "a refused ack must not close phase 1");

    // Queued: acked dirty, waiting its turn.
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    let before = c.clone();
    assert_eq!(
        c.on_answer(r, "a", Answer::Delivered, 2),
        ignored(IgnoredWhy::OutOfPhase)
    );
    assert_eq!(c, before);

    // Settled: answered clean in phase 1 and will never be prompted.
    assert_eq!(norm(c.on_answer(r, "b", Answer::Clean, 3)), prompt("a"));
    let before = c.clone();
    assert_eq!(
        c.on_answer(r, "b", Answer::Delivered, 4),
        ignored(IgnoredWhy::OutOfPhase)
    );
    assert_eq!(c, before);

    // Deciding: the same dialog acked twice. It is a duplicate rather than a
    // phase error — the second ack is a retransmission of a true statement, and
    // treating it as an error would make an ordinary double-render look like a
    // protocol fault.
    assert_eq!(c.on_answer(r, "a", Answer::Delivered, 5), Step::Wait);
    let before = c.clone();
    assert_eq!(
        c.on_answer(r, "a", Answer::Delivered, 6),
        ignored(IgnoredWhy::Duplicate)
    );
    assert_eq!(c, before);
}

// --- Q7: a decision is its own delivery confirmation -------------------------

#[test]
fn q7_a_decision_straight_from_prompted_still_settles_the_window() {
    // The ack exists to move the *timeout*, not to gate the answer. A window
    // fast enough to decide before its ack lands must still be heard, or every
    // quick user would be told their dialog never appeared.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    assert_eq!(norm(c.on_answer(r, "a", Answer::Dirty, 1)), prompt("a"));
    let step = c.on_answer(r, "a", discard(&["a1"]), 2);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    let step = through_recheck(&mut c, r, step, 3);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round (and a backstop round).
    assert_eq!(step, commit_after_backstop(&["a1"]));

    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    assert_eq!(norm(c.on_answer(r, "a", Answer::Dirty, 1)), prompt("a"));
    let step = c.on_answer(r, "a", Answer::Clean, 2);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    let step = through_recheck(&mut c, r, step, 3);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round (and a backstop round).
    assert_eq!(step, commit_after_backstop(&[]));

    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    assert_eq!(norm(c.on_answer(r, "a", Answer::Dirty, 1)), prompt("a"));
    assert_eq!(c.on_answer(r, "a", Answer::Cancel, 2), abort_by("a"));
}

// --- Q8: a prompt that could not be delivered at all -------------------------

#[test]
fn q8_a_prompt_that_could_not_be_delivered_hands_the_request_to_the_alert() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    assert_eq!(norm(c.on_answer(r, "b", Answer::Clean, 2)), prompt("a"));

    assert_eq!(
        c.on_delivery_failed(r, "a"),
        fallback(&["a"]),
        "waiting for a dialog that was never sent is the unquittable case"
    );
    assert_eq!(
        c.on_delivery_failed(r, "a"),
        ignored(IgnoredWhy::FallbackOwns),
        "the alert is already up; a repeat failure must not raise a second one"
    );
    assert_eq!(
        c.on_answer(r, "a", discard(&["a1"]), 3),
        ignored(IgnoredWhy::FallbackOwns)
    );
    assert_eq!(
        c.on_fallback_answer(r, FallbackAnswer::KeepOpen),
        Step::Abort {
            reason: AbortReason::UserKeptOpen
        }
    );
}

#[test]
fn q8b_a_delivery_failure_out_of_phase_is_refused_and_changes_nothing() {
    let mut idle = QuitCoordinator::new();
    assert_eq!(
        idle.on_delivery_failed(1, "a"),
        ignored(IgnoredWhy::StaleRequest)
    );

    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);

    // Pending, an unknown label and a stale id are each refused, and inert.
    for (request_id, label, why) in [
        (r, "a", IgnoredWhy::OutOfPhase),
        (r, "z", IgnoredWhy::UnknownLabel),
        (r + 1, "a", IgnoredWhy::StaleRequest),
    ] {
        let before = c.clone();
        assert_eq!(c.on_delivery_failed(request_id, label), ignored(why));
        assert_eq!(c, before, "a refused delivery failure must be inert");
    }

    // Queued: the prompt it is owed has not been sent yet.
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    let before = c.clone();
    assert_eq!(
        c.on_delivery_failed(r, "a"),
        ignored(IgnoredWhy::OutOfPhase)
    );
    assert_eq!(c, before);

    // Settled: b answered clean and is owed nothing.
    assert_eq!(norm(c.on_answer(r, "b", Answer::Clean, 2)), prompt("a"));
    let before = c.clone();
    assert_eq!(
        c.on_delivery_failed(r, "b"),
        ignored(IgnoredWhy::OutOfPhase)
    );
    assert_eq!(c, before);

    // Deciding: the dialog is demonstrably on screen, so a failure report for
    // it is stale and must not take the request away from the user.
    assert_eq!(c.on_answer(r, "a", Answer::Delivered, 3), Step::Wait);
    let before = c.clone();
    assert_eq!(
        c.on_delivery_failed(r, "a"),
        ignored(IgnoredWhy::OutOfPhase)
    );
    assert_eq!(c, before);
}
