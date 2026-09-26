//! Specification for the ADR-0035 re-check round: cases RC-1 .. RC-12 of the
//! test matrix (`.claude/tdd-guardian/tests-20260924-174706.md`).
//!
//! Registered from `coordinator.rs`. It also registers the shared fixtures, the
//! `Status::Gone` cases (GN-*) and the round-tag cases (RT-*), so the new
//! specification files cost `coordinator.rs` one registration.
//!
//! WI-1 scope: the backstop round (`Step::Backstop`, `Answer::Drafted`) is
//! WI-2. Where a matrix case ends in the backstop, this file pins the WI-1 part
//! and hands the tail to `finish_backstop`.

use super::*;

#[path = "coordinator_recheck_gone_tests.rs"]
mod coordinator_recheck_gone_tests;
#[path = "coordinator_round_tag_tests.rs"]
mod coordinator_round_tag_tests;
#[path = "coordinator_recheck_fixtures.rs"]
pub(super) mod fixtures;

use fixtures::*;

fn recheck(deadline_ms: u64, window_count: usize) -> Step {
    Step::Recheck {
        deadline_ms,
        window_count,
    }
}

fn prompt_at(label: &str, deadline_ms: u64) -> Step {
    Step::Prompt {
        label: label.to_string(),
        deadline_ms,
    }
}

/// RC-1 to its `Recheck`: two windows, clean at 500 and 700.
fn rc1() -> (QuitCoordinator, u64) {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 500), Step::Wait);
    assert_eq!(c.on_answer(r, "b", Answer::Clean, 700), recheck(2700, 2));
    (c, r)
}

/// RC-3 steps 1-6, returning the coordinator after each prefix length asked.
pub(super) fn rc3_to(steps: usize) -> (QuitCoordinator, u64, Vec<Step>) {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    let inputs: Vec<(&str, Answer, u64)> = vec![
        ("a", Answer::Clean, 500),
        ("b", Answer::Clean, 700),
        ("a", Answer::Dirty, 900),
        ("b", Answer::Clean, 1000),
        ("a", Answer::Delivered, 1100),
        ("a", discard(&["x"]), 1500),
    ];
    let trace = inputs
        .into_iter()
        .take(steps)
        .map(|(label, answer, t)| c.on_answer(r, label, answer, t))
        .collect();
    (c, r, trace)
}

// --- RC-1: all-clean phase 1 yields Recheck measured from the round start ---

#[test]
fn rc1_all_clean_phase_one_yields_recheck_from_the_round_start() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 500), Step::Wait);
    assert_eq!(
        c.on_answer(r, "b", Answer::Clean, 700),
        recheck(700 + QUIT_ACK_TIMEOUT_MS, 2)
    );
}

// --- RC-2 (WI-1 part): clean re-answers end the rounds; no second Recheck ---

#[test]
fn rc2_clean_re_answers_do_not_start_a_second_recheck() {
    let (mut c, r) = rc1();
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 900), Step::Wait);
    assert_eq!(round(&c), 1);
    let step = c.on_answer(r, "b", Answer::Clean, 1100);
    assert!(
        !matches!(
            step,
            Step::Recheck { .. } | Step::Prompt { .. } | Step::Wait | Step::Ignored { .. }
        ),
        "a clean re-check with no prompt since must end the rounds: {step:?}"
    );
    let end = finish_backstop(&mut c, r, step, 1200);
    assert_eq!(commit_ids_sorted(&end), Vec::<String>::new());
}

// --- RC-3: clean, then dirty at re-check -> Prompt; Discard -> Recheck again -

#[test]
fn rc3_dirty_at_recheck_is_prompted_then_rechecked_again() {
    let (c, _r, trace) = rc3_to(6);
    assert_eq!(
        trace,
        vec![
            Step::Wait,
            recheck(2700, 2),
            Step::Wait,
            prompt_at("a", 1000 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS),
            Step::Wait,
            recheck(3500, 2),
        ]
    );
    assert!(reprompted(&c, "a"));
    assert_eq!(round(&c), 2);
}

// --- RC-4: cap: a re-prompted window dirty again is Settled and counted ------

#[test]
fn rc4_a_re_prompted_window_dirty_again_is_settled_and_capped() {
    let (mut c, r, _) = rc3_to(6);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1600), Step::Wait);
    assert_eq!(status(&c, "a"), Status::Settled);
    assert_eq!(req(&c).capped, 1);
    let step = c.on_answer(r, "b", Answer::Clean, 1700);
    assert!(
        !matches!(
            step,
            Step::Prompt { .. } | Step::Recheck { .. } | Step::Wait
        ),
        "the capped window must be neither prompted nor awaited: {step:?}"
    );
    let end = finish_backstop(&mut c, r, step, 1800);
    assert_eq!(commit_ids_sorted(&end), vec!["x"]);
}

// --- RC-5: a phase-1 prompt does not spend the re-prompt bit -----------------

#[test]
fn rc5_a_phase_one_prompt_does_not_spend_the_re_prompt_bit() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    assert_eq!(
        c.on_answer(r, "a", Answer::Dirty, 500),
        prompt_at("a", 2500)
    );
    assert_eq!(c.on_answer(r, "a", Answer::Delivered, 600), Step::Wait);
    assert_eq!(c.on_answer(r, "a", discard(&["x"]), 800), recheck(2800, 1));
    assert!(
        !reprompted(&c, "a"),
        "a phase-1 prompt must not set the bit"
    );
    assert_eq!(
        c.on_answer(r, "a", Answer::Dirty, 900),
        prompt_at("a", 2900)
    );
    assert!(reprompted(&c, "a"));
}

// --- RC-6: Cancel from a re-prompted window aborts as Cancelled --------------

#[test]
fn rc6_cancel_from_a_re_prompted_window_aborts() {
    let (mut c, r, _) = rc3_to(5);
    assert_eq!(c.on_answer(r, "a", Answer::Cancel, 1500), cancelled_by("a"));
    assert!(c.request.is_none(), "an abort drops the request");
}

// --- RC-7: discards from both prompts merge without duplicates ---------------

#[test]
fn rc7_discards_from_both_prompts_merge_without_duplicates() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    let trace = [
        c.on_answer(r, "a", Answer::Dirty, 500),
        c.on_answer(r, "a", Answer::Delivered, 600),
        c.on_answer(r, "a", discard(&["x", "y"]), 700),
        c.on_answer(r, "a", Answer::Dirty, 800),
        c.on_answer(r, "a", Answer::Delivered, 900),
        c.on_answer(r, "a", discard(&["y", "z"]), 1000),
    ];
    assert_eq!(trace[2], recheck(2700, 1));
    assert_eq!(trace[3], prompt_at("a", 2800));
    assert_eq!(trace[5], recheck(3000, 1));
    let end = finish_recheck_and_backstop(&mut c, r, 1100);
    assert_eq!(commit_ids_sorted(&end), vec!["x", "y", "z"]);
}

// --- RC-8: a silent re-check window -> NativeFallback at the deadline --------

#[test]
fn rc8_a_silent_recheck_window_falls_back_at_the_deadline_only() {
    let (mut c, r) = rc1();
    let steps = vec![
        c.on_answer(r, "a", Answer::Clean, 900),
        c.on_tick(2000),
        c.on_tick(2699),
        c.on_tick(2700),
    ];
    assert_eq!(
        steps,
        vec![
            Step::Wait,
            Step::Rearm { deadline_ms: 2700 },
            Step::Rearm { deadline_ms: 2700 },
            Step::NativeFallback {
                timed_out: vec!["b".to_string()]
            },
        ]
    );
}

// --- RC-9: window_count counts only live windows -----------------------------

#[test]
fn rc9_window_count_counts_only_live_windows() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b", "c"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 500), Step::Wait);
    assert_eq!(c.on_window_gone("c", 600), Step::Wait);
    assert_eq!(c.on_answer(r, "b", Answer::Clean, 700), recheck(2700, 2));
}

// --- RC-10: ignored inputs during a re-check leave the state untouched -------

#[test]
fn rc10_ignored_inputs_during_a_recheck_are_inert() {
    let (base, r) = rc1();
    let rows: Vec<(&str, u64, &str, Answer, IgnoredWhy)> = vec![
        (
            "delivered",
            r,
            "a",
            Answer::Delivered,
            IgnoredWhy::OutOfPhase,
        ),
        ("discard", r, "a", discard(&["x"]), IgnoredWhy::OutOfPhase),
        ("cancel", r, "a", Answer::Cancel, IgnoredWhy::OutOfPhase),
        (
            "unknown label",
            r,
            "zz",
            Answer::Clean,
            IgnoredWhy::UnknownLabel,
        ),
        (
            "stale request",
            r + 1,
            "a",
            Answer::Clean,
            IgnoredWhy::StaleRequest,
        ),
    ];
    for (name, id, label, answer, why) in rows {
        let mut c = base.clone();
        let before = c.clone();
        assert_eq!(c.on_answer(id, label, answer, 900), ignored(why), "{name}");
        assert_eq!(
            c, before,
            "{name}: an ignored input must not change the state"
        );
    }
    // A duplicate: the second clean from a window that already re-answered.
    let mut c = base.clone();
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 900), Step::Wait);
    let before = c.clone();
    assert_eq!(
        c.on_answer(r, "a", Answer::Clean, 950),
        ignored(IgnoredWhy::Duplicate)
    );
    assert_eq!(c, before, "duplicate: the state must not change");
}

// --- RC-11: an abort during phase 2 never reaches a re-check -----------------

#[test]
fn rc11_an_abort_before_the_queue_drains_starts_no_recheck() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    let trace = vec![
        c.on_answer(r, "a", Answer::Dirty, 500),
        c.on_answer(r, "b", Answer::Dirty, 600),
        c.on_answer(r, "a", Answer::Delivered, 700),
        c.on_answer(r, "a", discard(&["x"]), 800),
        c.on_answer(r, "b", Answer::Delivered, 900),
        c.on_answer(r, "b", Answer::Cancel, 1000),
    ];
    assert!(
        !trace.iter().any(|s| matches!(s, Step::Recheck { .. })),
        "no re-check may start before the queue drains: {trace:?}"
    );
    assert_eq!(trace.last(), Some(&cancelled_by("b")));
}

// --- RC-12: a window's first dirty answer in round 2 is prompted, not capped -

#[test]
fn rc12_the_cap_is_per_window() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    let inputs: Vec<(&str, Answer, u64)> = vec![
        ("a", Answer::Clean, 100),
        ("b", Answer::Clean, 200),
        ("a", Answer::Dirty, 300),
        ("b", Answer::Clean, 400),
        ("a", Answer::Delivered, 500),
        ("a", discard(&["x"]), 600),
        ("a", Answer::Clean, 700),
        ("b", Answer::Dirty, 800),
    ];
    let mut trace: Vec<Step> = inputs
        .into_iter()
        .map(|(label, answer, t)| c.on_answer(r, label, answer, t))
        .collect();
    assert!(reprompted(&c, "a"));
    assert!(reprompted(&c, "b"));
    assert_eq!(round(&c), 2);
    trace.push(c.on_answer(r, "b", Answer::Delivered, 900));
    trace.push(c.on_answer(r, "b", discard(&["y"]), 1000));
    assert_eq!(
        trace,
        vec![
            Step::Wait,
            recheck(2200, 2),
            Step::Wait,
            prompt_at("a", 2400),
            Step::Wait,
            recheck(2600, 2),
            Step::Wait,
            prompt_at("b", 2800),
            Step::Wait,
            recheck(3000, 2),
        ]
    );
    assert_eq!(req(&c).capped, 0);
    let end = finish_recheck_and_backstop(&mut c, r, 1100);
    assert_eq!(commit_ids_sorted(&end), vec!["x", "y"]);
}
