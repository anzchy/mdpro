//! WI2-C8 .. C18, split out of `coordinator_tests.rs` and registered from it.
//!
//! Specification for `services::quit_guard::coordinator`: example cases
//! WI2-C1 .. WI2-C14 of the D16 test matrix.
//!
//! Wired from `coordinator.rs` with `#[cfg(test)] #[path = ...] mod ...;` so
//! the specification lives in a different file from the code it constrains.
//! The `on_window_gone` cases (C12, C15-C18) are in `coordinator_gone_tests.rs`
//! and the ADR-0027 timeout-fallback cases in `coordinator_fallback_tests.rs`.

use super::*;

// --- WI2-C8: the timeout boundary (ADR-0027: the fallback, not an abort) -----

#[test]
fn c8_the_ack_timeout_fires_at_the_deadline_and_not_one_ms_before() {
    assert_eq!(QUIT_ACK_TIMEOUT_MS, 2_000);

    // One ms before the deadline: still waiting.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 1_000);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 1_500), Step::Wait);
    // ADR-0029 §5: an early tick hands the deadline back rather than spending
    // the request's only wake-up on a `Wait`.
    assert_eq!(
        c.on_tick(1_000 + QUIT_ACK_TIMEOUT_MS - 1),
        Step::Rearm {
            deadline_ms: 1_000 + QUIT_ACK_TIMEOUT_MS
        }
    );

    // At the deadline: the native alert takes over, naming the silent window.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 1_000);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 1_500), Step::Wait);
    assert_eq!(
        c.on_tick(1_000 + QUIT_ACK_TIMEOUT_MS),
        Step::NativeFallback {
            timed_out: vec!["b".to_string()]
        }
    );

    // An ack that lands one ms before the deadline takes b out of the tick.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 1_000);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 1_500), Step::Wait);
    assert_eq!(
        norm(c.on_answer(r, "b", Answer::Dirty, 1_000 + QUIT_ACK_TIMEOUT_MS - 1)),
        prompt("b")
    );
    // b is prompted now, so the live deadline is its delivery deadline, measured
    // from 2_999 — the request's own phase-1 deadline no longer applies.
    assert_eq!(
        c.on_tick(1_000 + QUIT_ACK_TIMEOUT_MS),
        Step::Rearm {
            deadline_ms: 2_999 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS
        }
    );
}

// --- WI2-C9: a clock that goes backwards -------------------------------------

#[test]
fn c9_a_backwards_clock_neither_panics_nor_times_out() {
    let mut c = QuitCoordinator::new();
    let _r = begin_later(&mut c, &["a"], 5_000);
    assert_eq!(
        c.on_tick(0),
        Step::Rearm {
            deadline_ms: 5_000 + QUIT_ACK_TIMEOUT_MS
        },
        "a clock that went backwards is early, and early re-arms"
    );
}

// --- WI2-C10: a window that is deciding never times out ----------------------

#[test]
fn c10_a_window_that_acked_dirty_never_times_out() {
    // ADR-0029: the delivery ack is what ends the bounded part of phase 2. Once
    // a window has confirmed its dialog is up, the time the user spends reading
    // it is not a machine failing to make progress, and an hour is as valid as a
    // second. The queued window behind it is not on any deadline either.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    assert_eq!(norm(c.on_answer(r, "b", Answer::Dirty, 2)), prompt("a"));
    assert_eq!(c.on_answer(r, "a", Answer::Delivered, 3), Step::Wait);
    assert_eq!(c.on_tick(3_600_000), Step::Wait);
    assert_eq!(norm(c.on_answer(r, "a", discard(&["a1"]), 10)), prompt("b"));
    assert_eq!(c.on_answer(r, "b", Answer::Delivered, 11), Step::Wait);
    assert_eq!(c.on_tick(7_200_000), Step::Wait);
    let step = c.on_answer(r, "b", discard(&["b1"]), 11);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    let step = through_recheck(&mut c, r, step, 12);
    assert_eq!(commit_ids_sorted(&step), vec!["a1", "b1"]);
}

// --- WI2-C11: a nested begin ------------------------------------------------

#[test]
fn c11_a_second_begin_is_already_pending_and_changes_nothing() {
    // The nested begin must not push the deadline out to 1_500 + 2_000.
    let mut c = QuitCoordinator::new();
    let _r = begin_later(&mut c, &["a"], 0);
    assert_eq!(c.begin(&["a", "b"], 1_500), Begin::AlreadyPending);
    assert_eq!(
        c.on_tick(2_000),
        Step::NativeFallback {
            timed_out: vec!["a".to_string()]
        }
    );

    // The nested snapshot's extra window is not added to the request.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    assert_eq!(c.begin(&["a", "b"], 1_500), Begin::AlreadyPending);
    let step = c.on_answer(r, "a", Answer::Clean, 1_600);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    let step = through_recheck(&mut c, r, step, 1_601);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round (and a backstop round).
    assert_eq!(step, commit_after_backstop(&[]));
}

// --- WI2-C13: the prompted window answers clean ------------------------------

#[test]
fn c13_clean_when_prompted_counts_as_a_discard_with_no_ids() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    assert_eq!(norm(c.on_answer(r, "b", Answer::Dirty, 2)), prompt("a"));
    assert_eq!(norm(c.on_answer(r, "a", Answer::Clean, 3)), prompt("b"));
    let step = c.on_answer(r, "b", discard(&["b1"]), 4);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    let step = through_recheck(&mut c, r, step, 5);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round (and a backstop round).
    assert_eq!(step, commit_after_backstop(&["b1"]));
}

// --- WI2-C14: request ids strictly increase ----------------------------------

#[test]
fn c14_request_ids_strictly_increase_across_requests() {
    let mut c = QuitCoordinator::new();
    let mut ids: Vec<u64> = Vec::new();
    for k in 0..20u64 {
        let r = begin_later(&mut c, &["a"], k * 10_000);
        if let Some(previous) = ids.last() {
            assert_eq!(
                c.on_answer(*previous, "a", Answer::Clean, k * 10_000),
                ignored(IgnoredWhy::StaleRequest)
            );
        }
        ids.push(r);
        if k % 2 == 0 {
            let step = c.on_answer(r, "a", Answer::Clean, k * 10_000 + 1);
            // ADR-0035 changes the spec: commit is now preceded by a re-check round.
            let step = through_recheck(&mut c, r, step, k * 10_000 + 2);
            // ADR-0035 changes the spec: commit is now preceded by a re-check round (and a backstop round).
            assert_eq!(step, commit_after_backstop(&[]));
        } else {
            assert_eq!(
                norm(c.on_answer(r, "a", Answer::Dirty, k * 10_000 + 1)),
                prompt("a")
            );
            assert_eq!(
                c.on_answer(r, "a", Answer::Cancel, k * 10_000 + 2),
                cancelled_by("a")
            );
        }
    }
    assert!(
        ids.windows(2).all(|w| w[1] > w[0]),
        "request ids must strictly increase: {ids:?}"
    );
}

// --- an empty snapshot must not outrank a live request -----------------------

#[test]
fn c17_an_empty_snapshot_while_a_request_is_live_is_still_already_pending() {
    // ADR-0025 §2: "A second `terminate:` while a request is pending gets
    // `NSTerminateCancel` and leaves the pending request intact." An empty
    // window list is not an exception: answering `TerminateNow` here would quit
    // straight past a request that is still owed an answer.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    let before = c.clone();
    let empty: [&str; 0] = [];
    assert_eq!(c.begin(&empty, 1), Begin::AlreadyPending);
    assert_eq!(c, before, "a refused begin must not disturb the request");

    // The live request still resolves normally afterwards.
    assert_eq!(norm(c.on_answer(r, "a", Answer::Dirty, 2)), prompt("a"));
    let step = c.on_answer(r, "a", discard(&["a1"]), 3);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    let step = through_recheck(&mut c, r, step, 4);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round (and a backstop round).
    assert_eq!(step, commit_after_backstop(&["a1"]));
    assert_eq!(c.begin(&empty, 4), Begin::TerminateNow);
}

#[test]
fn c18_an_empty_snapshot_cannot_quit_past_an_outstanding_native_alert() {
    // The sharpest form: `on_window_gone` is refused while the alert owns the
    // request, so every window can be gone with the alert still on screen. If
    // the emptiness check came first, this would terminate without the user
    // ever answering it.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(
        c.on_tick(QUIT_ACK_TIMEOUT_MS),
        Step::NativeFallback {
            timed_out: vec!["a".to_string(), "b".to_string()]
        }
    );
    assert_eq!(
        c.on_window_gone("a", QUIT_ACK_TIMEOUT_MS),
        ignored(IgnoredWhy::FallbackOwns)
    );
    assert_eq!(
        c.on_window_gone("b", QUIT_ACK_TIMEOUT_MS),
        ignored(IgnoredWhy::FallbackOwns)
    );

    let empty: [&str; 0] = [];
    assert_eq!(
        c.begin(&empty, 9_000),
        Begin::AlreadyPending,
        "the alert is still unanswered; the quit is not ours to grant"
    );
    assert_eq!(
        c.on_fallback_answer(r, FallbackAnswer::KeepOpen),
        Step::Abort {
            reason: AbortReason::UserKeptOpen
        }
    );
    assert_eq!(c.begin(&empty, 9_100), Begin::TerminateNow);
}
