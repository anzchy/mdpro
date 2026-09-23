//! Specification for the ADR-0027 ack-timeout fallback (plan Revision 3).
//!
//! ADR-0027 supersedes ADR-0025 §3: a phase-1 ack timeout no longer counts as
//! `cancel`. It hands the request to a native alert, which owns it exclusively
//! until `on_fallback_answer`, and whose "Quit Without Saving" deletes no
//! drafts.

use super::coordinator_tests::{begin_later, commit, discard, ignored, prompt};
use super::*;

fn fallback(labels: &[&str]) -> Step {
    Step::NativeFallback {
        timed_out: labels.iter().map(|s| (*s).to_string()).collect(),
    }
}

// --- the tick names exactly the silent windows, in snapshot order ------------

#[test]
fn f1_the_fallback_names_every_window_that_never_acked() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b", "c"], 0);
    assert_eq!(c.on_answer(r, "b", Answer::Dirty, 1), Step::Wait);
    assert_eq!(
        c.on_tick(QUIT_ACK_TIMEOUT_MS),
        fallback(&["a", "c"]),
        "b acked, so only a and c are silent"
    );
}

// --- a webview that recovers mid-alert cannot advance the coordinator --------

#[test]
fn f2_a_late_answer_after_the_fallback_is_ignored_and_inert() {
    for late in [Answer::Clean, Answer::Dirty] {
        let mut c = QuitCoordinator::new();
        let r = begin_later(&mut c, &["a", "b"], 0);
        assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
        assert_eq!(c.on_tick(QUIT_ACK_TIMEOUT_MS), fallback(&["b"]));

        let before = c.clone();
        assert_eq!(
            c.on_answer(r, "b", late.clone(), QUIT_ACK_TIMEOUT_MS + 500),
            ignored(IgnoredWhy::FallbackOwns),
            "the alert owns the request; a recovered webview cannot resolve it"
        );
        assert_eq!(
            c, before,
            "a late {late:?} must leave the request byte-for-byte unchanged"
        );

        // The request still resolves, and only through the alert.
        assert_eq!(
            c.on_fallback_answer(r, FallbackAnswer::KeepOpen),
            Step::Abort {
                reason: AbortReason::UserKeptOpen
            }
        );
    }
}

#[test]
fn f2b_no_window_is_prompted_after_the_fallback() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    assert_eq!(c.on_tick(QUIT_ACK_TIMEOUT_MS), fallback(&["b"]));
    // b's dirty would close phase 1 and prompt a, were the request still live.
    assert_eq!(
        c.on_answer(r, "b", Answer::Dirty, 2_500),
        ignored(IgnoredWhy::FallbackOwns)
    );
    assert_eq!(
        c.on_answer(r, "a", discard(&["a1"]), 2_600),
        ignored(IgnoredWhy::FallbackOwns)
    );
    assert_eq!(
        c.on_fallback_answer(r, FallbackAnswer::QuitAnyway),
        commit(&[]),
        "a's discard was never accepted, so it contributes no ids"
    );
}

// --- Quit Without Saving commits, and deletes nothing ------------------------

#[test]
fn f3_quit_anyway_commits_with_an_empty_id_set() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    assert_eq!(c.on_tick(QUIT_ACK_TIMEOUT_MS), fallback(&["b"]));
    assert_eq!(
        c.on_fallback_answer(r, FallbackAnswer::QuitAnyway),
        commit(&[]),
        "drafts are the last copy of the discarded work: the fallback deletes none"
    );
}

#[test]
fn f3b_quit_anyway_carries_no_ids_from_an_accepted_discard() {
    // The literal matrix shape - one window answers `discard(["x1"])` and a
    // *later* tick in the same request times another window out - is not
    // reachable: a discard is only accepted from a prompted window, and a
    // window is only prompted once every window has acked, at which point no
    // window can time out. The reachable form of the same conservation claim is
    // an accepted `discard(["x1"])` in an earlier request of the same
    // coordinator. An implementation that accumulates discard ids anywhere but
    // the live request, or that routes the fallback through the ordinary commit
    // path, fails here.
    let mut c = QuitCoordinator::new();
    let r1 = begin_later(&mut c, &["a"], 0);
    assert_eq!(c.on_answer(r1, "a", Answer::Dirty, 1), prompt("a"));
    assert_eq!(c.on_answer(r1, "a", discard(&["x1"]), 2), commit(&["x1"]));

    let r2 = begin_later(&mut c, &["a", "b"], 100);
    assert_eq!(c.on_answer(r2, "a", Answer::Dirty, 101), Step::Wait);
    assert_eq!(c.on_tick(100 + QUIT_ACK_TIMEOUT_MS), fallback(&["b"]));
    assert_eq!(
        c.on_fallback_answer(r2, FallbackAnswer::QuitAnyway),
        commit(&[]),
        "x1 belonged to a request that is over; the fallback commits nothing"
    );
}

// --- Keep Open ends the request, so the next quit starts a fresh one ---------

#[test]
fn f4_keep_open_aborts_and_the_next_begin_gets_a_new_request_id() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    assert_eq!(c.on_tick(QUIT_ACK_TIMEOUT_MS), fallback(&["a"]));
    assert_eq!(
        c.on_fallback_answer(r, FallbackAnswer::KeepOpen),
        Step::Abort {
            reason: AbortReason::UserKeptOpen
        }
    );
    let r2 = begin_later(&mut c, &["a"], 10_000);
    assert!(
        r2 > r,
        "a request resolved by the alert is over: {r} -> {r2}"
    );
    assert_eq!(c.on_answer(r2, "a", Answer::Clean, 10_001), commit(&[]));
}

#[test]
fn f4b_quit_anyway_also_ends_the_request() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    assert_eq!(c.on_tick(QUIT_ACK_TIMEOUT_MS), fallback(&["a"]));
    assert_eq!(
        c.on_fallback_answer(r, FallbackAnswer::QuitAnyway),
        commit(&[])
    );
    let r2 = begin_later(&mut c, &["a"], 10_000);
    assert!(r2 > r);
}

// --- a fallback answer nobody asked for --------------------------------------

#[test]
fn f5_a_fallback_answer_with_no_outstanding_alert_is_ignored() {
    // No request at all.
    let mut idle = QuitCoordinator::new();
    assert_eq!(
        idle.on_fallback_answer(1, FallbackAnswer::QuitAnyway),
        ignored(IgnoredWhy::StaleRequest)
    );

    // A live request that has not timed out.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    let before = c.clone();
    assert_eq!(
        c.on_fallback_answer(r, FallbackAnswer::QuitAnyway),
        ignored(IgnoredWhy::OutOfPhase),
        "the alert never went up, so it cannot answer"
    );
    assert_eq!(c, before);

    // A stale id while an alert is outstanding.
    assert_eq!(c.on_tick(QUIT_ACK_TIMEOUT_MS), fallback(&["a"]));
    let before = c.clone();
    assert_eq!(
        c.on_fallback_answer(r + 1, FallbackAnswer::QuitAnyway),
        ignored(IgnoredWhy::StaleRequest)
    );
    assert_eq!(c, before);

    // The alert answered twice resolves once.
    assert_eq!(
        c.on_fallback_answer(r, FallbackAnswer::KeepOpen),
        Step::Abort {
            reason: AbortReason::UserKeptOpen
        }
    );
    assert_eq!(
        c.on_fallback_answer(r, FallbackAnswer::QuitAnyway),
        ignored(IgnoredWhy::StaleRequest)
    );
}

// --- the alert goes up once, and owns everything until it is answered --------

#[test]
fn f6_the_fallback_is_issued_at_most_once_per_request() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 1), Step::Wait);
    assert_eq!(c.on_tick(QUIT_ACK_TIMEOUT_MS), fallback(&["b"]));

    let before = c.clone();
    assert_eq!(
        c.on_tick(QUIT_ACK_TIMEOUT_MS + 5_000),
        ignored(IgnoredWhy::FallbackOwns),
        "a second tick must not put a second alert on screen"
    );
    assert_eq!(c, before);

    assert_eq!(
        c.on_window_gone("b"),
        ignored(IgnoredWhy::FallbackOwns),
        "the alert owns the request even if the stuck window is torn down"
    );
    assert_eq!(c, before);

    assert_eq!(
        c.begin(&["a", "b"], 9_000),
        Begin::AlreadyPending,
        "the request is still in flight while the alert is on screen"
    );
    assert_eq!(c, before);
}
