//! Specification for `on_window_gone`: cases WI2-C12 and WI2-C15 .. WI2-C18.
//!
//! The six positions a window can disappear from: pending in phase 1, currently
//! prompted, queued behind another prompt, after answering clean, after
//! answering dirty while phase 1 is still open, and after its discard.

use super::coordinator_tests::{begin_later, commit, commit_ids_sorted, discard, ignored, prompt};
use super::*;

// --- WI2-C12: gone in phase 1, gone while prompted, and the two no-ops -------

#[test]
fn c12_gone_in_phase_one_counts_as_answered() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 1), Step::Wait);
    assert_eq!(c.on_window_gone("b"), commit(&[]));
}

#[test]
fn c12_gone_while_prompted_moves_the_prompt_on_without_its_ids() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    assert_eq!(c.on_answer(r, "b", Answer::Dirty, 2), prompt("a"));
    assert_eq!(c.on_window_gone("a"), prompt("b"));
    assert_eq!(c.on_answer(r, "b", discard(&["b1"]), 3), commit(&["b1"]));
}

#[test]
fn c12_gone_for_an_unknown_label_or_with_no_request_is_ignored() {
    let mut c = QuitCoordinator::new();
    let _r = begin_later(&mut c, &["a", "b"], 0);
    let before = c.clone();
    assert_eq!(c.on_window_gone("z"), ignored(IgnoredWhy::UnknownLabel));
    assert_eq!(c, before);

    let mut idle = QuitCoordinator::new();
    assert_eq!(
        idle.on_window_gone("a"),
        ignored(IgnoredWhy::StaleRequest),
        "with no request pending there is nothing for a gone window to change"
    );
}

// --- WI2-C15: a queued dirty window that disappears --------------------------

#[test]
fn c15_a_queued_dirty_window_that_disappears_is_dropped_from_the_queue() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b", "c"], 0);
    let trace = vec![
        c.on_answer(r, "a", Answer::Dirty, 1),
        c.on_answer(r, "b", Answer::Dirty, 2),
        c.on_answer(r, "c", Answer::Dirty, 3),
        c.on_window_gone("b"),
        c.on_answer(r, "a", discard(&["a1"]), 4),
        c.on_answer(r, "c", discard(&["c1"]), 5),
    ];
    assert_eq!(
        trace,
        vec![
            Step::Wait,
            Step::Wait,
            prompt("a"),
            Step::Wait,
            prompt("c"),
            commit(&["a1", "c1"]),
        ]
    );
    assert!(
        !trace.contains(&prompt("b")),
        "a window that is gone must never be prompted: {trace:?}"
    );
    assert_eq!(commit_ids_sorted(trace.last().unwrap()), vec!["a1", "c1"]);
}

// --- WI2-C16: a window that answered clean and then disappears ---------------

#[test]
fn c16_a_clean_window_that_disappears_is_not_counted_twice() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b", "c"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 1), Step::Wait);
    assert_eq!(c.on_window_gone("a"), Step::Wait);
    assert_eq!(
        c.on_answer(r, "b", Answer::Clean, 2),
        Step::Wait,
        "c has not answered, so two answers must not commit"
    );
    assert_eq!(c.on_answer(r, "c", Answer::Clean, 3), commit(&[]));
}

#[test]
fn c16_the_window_that_never_answered_is_still_awaited_at_the_deadline() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b", "c"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 1), Step::Wait);
    assert_eq!(c.on_window_gone("a"), Step::Wait);
    assert_eq!(c.on_answer(r, "b", Answer::Clean, 2), Step::Wait);
    assert_eq!(
        c.on_tick(QUIT_ACK_TIMEOUT_MS),
        Step::NativeFallback {
            timed_out: vec!["c".to_string()]
        }
    );
}

// --- WI2-C17: dirty in phase 1, then gone ------------------------------------

#[test]
fn c17_a_window_gone_after_a_phase_one_dirty_is_never_prompted() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b", "c"], 0);
    let trace = vec![
        c.on_answer(r, "a", Answer::Dirty, 1),
        c.on_answer(r, "b", Answer::Dirty, 2),
        c.on_window_gone("a"),
        c.on_answer(r, "c", Answer::Clean, 3),
        c.on_answer(r, "b", discard(&["b1"]), 4),
    ];
    assert_eq!(
        trace,
        vec![
            Step::Wait,
            Step::Wait,
            Step::Wait,
            prompt("b"),
            commit(&["b1"]),
        ]
    );
    assert!(
        !trace.contains(&prompt("a")),
        "the prompt a was owed is withdrawn, not issued: {trace:?}"
    );
}

// --- WI2-C18: discard, then gone: the ids stand ------------------------------

#[test]
fn c18_a_window_that_disappears_after_its_discard_keeps_its_ids() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    let trace = vec![
        c.on_answer(r, "a", Answer::Dirty, 1),
        c.on_answer(r, "b", Answer::Dirty, 2),
        c.on_answer(r, "a", discard(&["a1"]), 3),
        c.on_window_gone("a"),
        c.on_answer(r, "b", discard(&["b1"]), 4),
    ];
    assert_eq!(
        trace,
        vec![
            Step::Wait,
            prompt("a"),
            prompt("b"),
            Step::Wait,
            commit(&["a1", "b1"]),
        ]
    );
    assert_eq!(
        trace.iter().filter(|s| **s == prompt("b")).count(),
        1,
        "b must be prompted exactly once: {trace:?}"
    );
    assert_eq!(commit_ids_sorted(trace.last().unwrap()), vec!["a1", "b1"]);
}
