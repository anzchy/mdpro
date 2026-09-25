//! The backstop legs of the ADR-0035 re-check cases that WI-1 pinned only up
//! to the backstop: RC-2, RC-4, RC-10, RC-12, GN-3, GN-5 (`Drafting` start),
//! RT-2 (`Drafting` rows) and RT-6 part 1, from the test matrix
//! (`.claude/tdd-guardian/tests-20260924-174706.md`).
//!
//! Registered from `coordinator_backstop_tests.rs`. The WI-1 files stay
//! untouched; these cases extend them rather than rewriting their assertions.

use super::super::coordinator_recheck_tests::rc3_to;
use super::*;

/// RC-1 to its `Recheck`: two windows, clean at 500 and 700.
fn rc1() -> (QuitCoordinator, u64) {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 500), Step::Wait);
    assert!(matches!(
        c.on_answer(r, "b", Answer::Clean, 700),
        Step::Recheck { .. }
    ));
    (c, r)
}

// --- RC-2: clean re-answers go to Backstop, measured from the last answer ---

#[test]
fn rc2_clean_re_answers_open_the_backstop_in_round_one() {
    let (c, _r) = to_backstop();
    assert_eq!(round(&c), 1);
    assert_eq!(drafting_labels(&c), vec!["a", "b"]);
    assert_eq!(status(&c, "a"), Status::Drafting);
    assert_eq!(status(&c, "b"), Status::Drafting);
}

// --- RC-4: the capped count reaches the Commit tally -------------------------

#[test]
fn rc4_the_capped_window_is_counted_in_the_commit_tally() {
    let (mut c, r, _) = rc3_to(6);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1600), Step::Wait);
    assert_eq!(c.on_answer(r, "b", Answer::Clean, 1700), backstop(3700, 2));
    assert_eq!(c.on_answer(r, "a", drafted(1, 0), 1800), Step::Wait);
    let end = c.on_answer(r, "b", drafted(1, 0), 1900);
    assert_eq!(end, committed(&["x"], tally(2, 0, 0, 1)));
}

// --- RC-10: Drafted during a re-check is out of phase ------------------------

#[test]
fn rc10_drafted_during_a_recheck_is_out_of_phase() {
    let (mut c, r) = rc1();
    let before = c.clone();
    assert_eq!(
        c.on_answer(r, "a", drafted(1, 0), 900),
        ignored(IgnoredWhy::OutOfPhase)
    );
    assert_eq!(
        c, before,
        "Drafted: an ignored input must not change the state"
    );
}

// --- RC-12: the per-window cap leaves `capped` at zero -----------------------

#[test]
fn rc12_a_first_re_prompt_is_not_counted_as_capped() {
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
        ("b", Answer::Delivered, 900),
        ("b", discard(&["y"]), 1000),
    ];
    for (label, answer, t) in inputs {
        c.on_answer(r, label, answer, t);
    }
    let end = finish_recheck_and_backstop(&mut c, r, 1100);
    assert_eq!(end, committed(&["x", "y"], tally(0, 0, 0, 0)));
}

// --- GN-3: the last re-check window leaving opens the backstop ---------------

#[test]
fn gn3_gone_during_a_recheck_opens_the_backstop_for_the_rest() {
    let (mut c, r) = rc1();
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 900), Step::Wait);
    assert_eq!(c.on_window_gone("b", 1000), backstop(3000, 1));
}

// --- GN-5 (Drafting start): gone is absorbing and never missing --------------

#[test]
fn gn5_gone_from_drafting_is_absorbing_and_not_missing() {
    let ways: [(&str, Option<Answer>, BackstopTally); 3] = [
        ("drafted", Some(drafted(1, 0)), tally(1, 0, 0, 0)),
        ("failed", Some(drafted(0, 1)), tally(0, 1, 0, 0)),
        ("silent", None, tally(0, 0, 1, 0)),
    ];
    for (name, answer, expected) in ways {
        let ctx = format!("start=drafting b={name}");
        let (mut c, r) = to_backstop();
        assert_eq!(c.on_window_gone("a", 1200), Step::Wait, "{ctx}");
        assert_eq!(status(&c, "a"), Status::Gone, "{ctx}");
        assert!(
            !req(&c)
                .machine_side_outstanding()
                .contains(&"a".to_string()),
            "{ctx}: a gone window is never machine-side outstanding"
        );
        let end = match answer {
            Some(answer) => c.on_answer(r, "b", answer, 1300),
            None => {
                assert_eq!(c.on_tick(3000), Step::Rearm { deadline_ms: 3100 });
                assert_eq!(status(&c, "a"), Status::Gone, "{ctx}");
                c.on_tick(3100)
            }
        };
        assert_eq!(end, committed(&[], expected), "{ctx}");
    }
}

// --- RT-2 (Drafting rows): Drafted is round-checked --------------------------

fn drafting_in_round(current: u32) -> (QuitCoordinator, u64) {
    if current == 1 {
        return to_backstop();
    }
    let (mut c, r, _) = rc3_to(6);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 1600), Step::Wait);
    assert_eq!(c.on_answer(r, "b", Answer::Clean, 1700), backstop(3700, 2));
    (c, r)
}

#[test]
fn rt2_drafted_round_tag_acceptance_in_every_round() {
    for current in [1u32, 2] {
        let (base, r) = drafting_in_round(current);
        assert_eq!(round(&base), current, "the builder reached round {current}");
        assert_eq!(status(&base, "a"), Status::Drafting);
        for sent in [None, Some(0), Some(1), Some(2), Some(3)] {
            let ctx = format!("status=drafting sent={sent:?} current={current}");
            let mut c = base.clone();
            let before = c.clone();
            let step = c.on_answer_in(r, sent, "a", drafted(1, 0), 5000);
            if sent.is_none() || sent == Some(current) {
                assert!(!matches!(step, Step::Ignored { .. }), "{ctx}: {step:?}");
                assert_ne!(c, before, "{ctx}: an accepted answer must transition");
            } else {
                assert_eq!(step, ignored(IgnoredWhy::StaleRound), "{ctx}");
                assert_eq!(c, before, "{ctx}: a refusal must be inert");
            }
        }
    }
}

// --- RT-6 part 1: a Drafted tagged with an earlier round is refused ----------

#[test]
fn rt6_drafted_is_round_checked() {
    let (mut c, r) = to_backstop();
    let before = c.clone();
    assert_eq!(
        c.on_answer_in(r, Some(0), "a", drafted(1, 0), 1200),
        ignored(IgnoredWhy::StaleRound)
    );
    assert_eq!(c, before);
    assert_eq!(
        c.on_answer_in(r, Some(1), "a", drafted(1, 0), 1300),
        Step::Wait
    );
    assert_eq!(status(&c, "a"), Status::Settled);
}
