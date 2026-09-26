//! Specification for `Status::Gone` under ADR-0035: cases GN-1 .. GN-7.
//!
//! Law: `Gone` is absorbing. Once a window is gone, no later transition gives
//! it another status, `machine_side_outstanding()` never lists it, no later
//! `NativeFallback.timed_out` names it, and the discards it sent still reach
//! the commit. The `Drafting` start state of GN-5 is WI-2's.

use super::fixtures::*;
use super::rc3_to;
use super::*;

// --- GN-1: gone after Settled is excluded from the re-check and its timeout --

#[test]
fn gn1_a_window_gone_after_settled_is_excluded_from_the_recheck() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 500), Step::Wait);
    assert_eq!(c.on_window_gone("a", 600), Step::Wait);
    assert_eq!(
        c.on_answer(r, "b", Answer::Clean, 700),
        Step::Recheck {
            deadline_ms: 2700,
            window_count: 1
        }
    );
    assert_eq!(status(&c, "a"), Status::Gone);
    assert_eq!(
        c.on_tick(2700),
        Step::NativeFallback {
            timed_out: vec!["b".to_string()]
        }
    );
}

// --- GN-2: every window gone commits with no Recheck --------------------------

#[test]
fn gn2_every_window_gone_commits_directly() {
    let mut c = QuitCoordinator::new();
    let _r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_window_gone("a", 100), Step::Wait);
    assert_eq!(c.on_window_gone("b", 200), commit(&[]));
}

// --- GN-3: gone during a re-check Pending counts as answered -----------------

#[test]
fn gn3_gone_during_a_recheck_counts_as_answered() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    c.on_answer(r, "a", Answer::Clean, 500);
    c.on_answer(r, "b", Answer::Clean, 700);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 900), Step::Wait);
    let step = c.on_window_gone("b", 1000);
    assert!(
        !matches!(step, Step::Wait | Step::Recheck { .. }),
        "the last outstanding window leaving must end the round: {step:?}"
    );
    let end = finish_backstop(&mut c, r, step, 1100);
    assert_eq!(commit_ids_sorted(&end), Vec::<String>::new());
}

// --- GN-4: discards sent before going still stand -----------------------------

#[test]
fn gn4_discards_sent_before_going_still_stand() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "b", Answer::Clean, 300), Step::Wait);
    assert!(matches!(
        c.on_answer(r, "a", Answer::Dirty, 500),
        Step::Prompt { .. }
    ));
    assert_eq!(c.on_answer(r, "a", Answer::Delivered, 600), Step::Wait);
    let step = c.on_answer(r, "a", discard(&["x"]), 700);
    assert!(matches!(step, Step::Recheck { .. }), "{step:?}");
    assert_eq!(c.on_window_gone("a", 800), Step::Wait);
    let end = finish_recheck_and_backstop(&mut c, r, 900);
    assert_eq!(commit_ids_sorted(&end), vec!["x"]);
}

// --- GN-5: Gone is absorbing from every reachable status ---------------------

#[derive(Clone, Copy, Debug)]
enum BWay {
    Clean,
    DirtyThenDiscard,
    Silent,
}

/// Two windows with `a` driven into `start`, and the time reached.
fn with_a_in(start: &str) -> (QuitCoordinator, u64, u64) {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    let script: Vec<(&str, Answer)> = match start {
        "phase1-pending" => vec![],
        "queued" => vec![("a", Answer::Dirty)],
        "prompted" => vec![("b", Answer::Clean), ("a", Answer::Dirty)],
        "deciding" => vec![
            ("b", Answer::Clean),
            ("a", Answer::Dirty),
            ("a", Answer::Delivered),
        ],
        "settled" => vec![("a", Answer::Clean)],
        "recheck-pending" => vec![("a", Answer::Clean), ("b", Answer::Clean)],
        other => panic!("unknown start {other}"),
    };
    let mut t = 0;
    for (label, answer) in script {
        t += 10;
        c.on_answer(r, label, answer, t);
    }
    (c, r, t)
}

fn check_absorbed(c: &QuitCoordinator, step: &Step, ctx: &str) {
    if let Step::NativeFallback { timed_out } = step {
        assert!(
            !timed_out.contains(&"a".to_string()),
            "{ctx}: {timed_out:?}"
        );
    }
    if let Some(request) = c.request.as_ref() {
        assert_eq!(request.status_of("a"), Some(Status::Gone), "{ctx}");
        assert!(
            !request
                .machine_side_outstanding()
                .contains(&"a".to_string()),
            "{ctx}: a gone window is never machine-side outstanding"
        );
    }
}

#[test]
fn gn5_gone_is_absorbing_from_every_reachable_status() {
    let starts = [
        "phase1-pending",
        "queued",
        "prompted",
        "deciding",
        "settled",
        "recheck-pending",
    ];
    let ways = [BWay::Clean, BWay::DirtyThenDiscard, BWay::Silent];
    for start in starts {
        for way in ways {
            let ctx = format!("start={start} b={way:?}");
            let (mut c, r, mut t) = with_a_in(start);
            t += 10;
            let mut step = c.on_window_gone("a", t);
            check_absorbed(&c, &step, &ctx);
            let mut guard = 0;
            while c.request.is_some() && !matches!(step, Step::NativeFallback { .. }) {
                guard += 1;
                assert!(guard < 20, "{ctx}: no terminal reached");
                t += 10;
                let b = status(&c, "b");
                step = match (b, way) {
                    (_, BWay::Silent) if matches!(b, Status::Pending | Status::Prompted) => {
                        c.on_tick(req(&c).deadline_ms.expect("a deadline is armed"))
                    }
                    (Status::Pending, BWay::Clean) => c.on_answer(r, "b", Answer::Clean, t),
                    (Status::Pending, _) => c.on_answer(r, "b", Answer::Dirty, t),
                    (Status::Prompted, _) => c.on_answer(r, "b", Answer::Delivered, t),
                    (Status::Deciding, BWay::Clean) => c.on_answer(r, "b", Answer::Clean, t),
                    (Status::Deciding, _) => c.on_answer(r, "b", discard(&["y"]), t),
                    // ADR-0035 changes the spec: commit is now preceded by a re-check round (and a backstop round).
                    // b drafts, or stays silent until the backstop deadline commits.
                    (Status::Drafting, BWay::Silent) => {
                        c.on_tick(req(&c).deadline_ms.expect("a deadline is armed"))
                    }
                    (Status::Drafting, _) => c.on_answer(
                        r,
                        "b",
                        Answer::Drafted {
                            drafted: 0,
                            failed: 0,
                        },
                        t,
                    ),
                    (other, _) => panic!("{ctx}: b stuck in {other:?} with {step:?}"),
                };
                check_absorbed(&c, &step, &ctx);
            }
        }
    }
}

// --- GN-6: a second gone for the same label is inert -------------------------

#[test]
fn gn6_a_second_gone_is_inert() {
    let mut c = QuitCoordinator::new();
    let _r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_window_gone("a", 100), Step::Wait);
    let before = c.clone();
    assert_eq!(c.on_window_gone("a", 200), Step::Wait);
    assert_eq!(c, before);
}

// --- GN-7: gone of the re-prompted window advances to the next round ---------

#[test]
fn gn7_gone_of_the_re_prompted_window_starts_the_next_round() {
    let (mut c, _r, trace) = rc3_to(4);
    assert!(matches!(trace[3], Step::Prompt { .. }), "{trace:?}");
    assert_eq!(
        c.on_window_gone("a", 1200),
        Step::Recheck {
            deadline_ms: 3200,
            window_count: 1
        }
    );
}
