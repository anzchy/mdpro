//! Specification for the ADR-0035 commit-phase draft backstop (decisions 4
//! and 5, plan amendments A2 and A4): cases BS-1 .. BS-9 of the test matrix
//! (`.claude/tdd-guardian/tests-20260924-174706.md`).
//!
//! Law: at `Commit` after a backstop, `drafted` and `failed` are the sums over
//! the accepted `Drafted` answers, `missing` is the number of windows still
//! `Drafting` at the deadline, and accepted + missing + gone == `window_count`.
//! The delete list is carried through unchanged. A backstop-deadline tick
//! always commits: never `NativeFallback`, never `Wait`.
//!
//! Registered from `coordinator.rs`. It also registers the backstop legs of
//! the WI-1 cases (`coordinator_backstop_rounds_tests.rs`) and the BS-8
//! enumeration (`coordinator_backstop_props_tests.rs`).

use super::coordinator_recheck_tests::fixtures::*;
use super::*;

#[path = "coordinator_backstop_props_tests.rs"]
mod coordinator_backstop_props_tests;
#[path = "coordinator_backstop_rounds_tests.rs"]
mod coordinator_backstop_rounds_tests;

pub(super) fn drafted(drafted: u32, failed: u32) -> Answer {
    Answer::Drafted { drafted, failed }
}

pub(super) fn backstop(deadline_ms: u64, window_count: usize) -> Step {
    Step::Backstop {
        deadline_ms,
        window_count,
    }
}

pub(super) fn committed(ids: &[&str], tally: BackstopTally) -> Step {
    Step::Commit {
        discard_document_ids: ids.iter().map(|s| (*s).to_string()).collect(),
        backstop: Some(tally),
    }
}

pub(super) fn tally(drafted: u32, failed: u32, missing: u32, capped: u32) -> BackstopTally {
    BackstopTally {
        drafted,
        failed,
        missing,
        capped,
        // ADR-0035 review M-1: compile-only — the tally gained an `undiscarded` count; no redraft here.
        undiscarded: 0,
    }
}

/// RC-2 to its `Backstop`: two windows, clean at 500/700, re-check clean at
/// 900/1100. The backstop is issued at 1100, so its deadline is 3100.
pub(super) fn to_backstop() -> (QuitCoordinator, u64) {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 500), Step::Wait);
    assert!(matches!(
        c.on_answer(r, "b", Answer::Clean, 700),
        Step::Recheck { .. }
    ));
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 900), Step::Wait);
    assert_eq!(
        c.on_answer(r, "b", Answer::Clean, 1100),
        backstop(1100 + QUIT_BACKSTOP_TIMEOUT_MS, 2)
    );
    (c, r)
}

// --- BS-1: two windows draft; Commit carries the summed tally and the ids ----

#[test]
fn bs1_two_windows_draft_and_the_commit_carries_the_summed_tally() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    let trace = vec![
        c.on_answer(r, "b", Answer::Clean, 400),
        c.on_answer(r, "a", Answer::Dirty, 500),
        c.on_answer(r, "a", Answer::Delivered, 600),
        c.on_answer(r, "a", discard(&["x", "y"]), 700),
        c.on_answer(r, "a", Answer::Clean, 900),
        c.on_answer(r, "b", Answer::Clean, 1000),
        c.on_answer(r, "a", drafted(2, 0), 1100),
        c.on_answer(r, "b", drafted(1, 1), 1200),
    ];
    assert_eq!(trace[5], backstop(3000, 2), "{trace:?}");
    assert_eq!(trace[6], Step::Wait, "{trace:?}");
    let end = trace.last().expect("the trace has a last step");
    assert_eq!(commit_ids_sorted(end), vec!["x", "y"]);
    assert!(
        matches!(end, Step::Commit { backstop: Some(t), .. } if *t == tally(3, 1, 0, 0)),
        "the tally must be the sum of both answers: {end:?}"
    );
    assert!(c.request.is_none(), "the commit drops the request");
}

// --- BS-2: a silent window at the backstop deadline commits, missing == 1 ----

#[test]
fn bs2_a_silent_window_at_the_backstop_deadline_is_missing_and_commits() {
    let (mut c, r) = to_backstop();
    assert_eq!(c.on_answer(r, "a", drafted(1, 0), 1200), Step::Wait);
    let step = c.on_tick(3100);
    assert!(
        !matches!(step, Step::NativeFallback { .. }),
        "a backstop deadline must never reach the ADR-0027 alert: {step:?}"
    );
    assert_eq!(step, committed(&[], tally(1, 0, 1, 0)));
}

// --- BS-3 (A4): a deadline tick with every live window Drafting commits ------

#[test]
fn bs3_a_deadline_tick_with_every_window_drafting_commits_not_waits() {
    let (mut c, _r) = to_backstop();
    assert_eq!(c.on_tick(3100), committed(&[], tally(0, 0, 2, 0)));
    assert!(
        c.request.is_none(),
        "the backstop deadline resolves the request"
    );
}

// --- BS-4: an early tick rearms at the backstop deadline --------------------

#[test]
fn bs4_an_early_tick_rearms_at_the_deadline_measured_from_the_issue() {
    let (mut c, _r) = to_backstop();
    // 2700 is the stale re-check timer; 3099 is one ms short.
    assert_eq!(c.on_tick(2700), Step::Rearm { deadline_ms: 3100 });
    assert_eq!(c.on_tick(3099), Step::Rearm { deadline_ms: 3100 });
}

// --- BS-5: a window gone during Drafting is not missing ----------------------

#[test]
fn bs5_a_window_gone_during_drafting_is_not_missing() {
    let (mut c, r) = to_backstop();
    assert_eq!(c.on_answer(r, "a", drafted(2, 0), 1200), Step::Wait);
    assert_eq!(
        c.on_window_gone("b", 1300),
        committed(&[], tally(2, 0, 0, 0))
    );
}

// --- BS-6: out-of-phase and duplicate matrix --------------------------------

/// Two windows `a`, `b` with `a` driven into the named status.
fn a_in(status_name: &str) -> (QuitCoordinator, u64) {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    let script: Vec<(&str, Answer)> = match status_name {
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
        "drafting" => return to_backstop(),
        other => panic!("unknown status {other}"),
    };
    for (t, (label, answer)) in (10u64..).step_by(10).zip(script) {
        c.on_answer(r, label, answer, t);
    }
    (c, r)
}

fn assert_refused(c: &mut QuitCoordinator, r: u64, answer: Answer, why: IgnoredWhy, ctx: &str) {
    let before = c.clone();
    assert_eq!(c.on_answer(r, "a", answer, 5_000), ignored(why), "{ctx}");
    assert_eq!(
        *c, before,
        "{ctx}: a refused answer must not change the state"
    );
}

#[test]
fn bs6_drafted_out_of_phase_duplicate_and_other_answers_while_drafting() {
    for name in [
        "phase1-pending",
        "queued",
        "prompted",
        "deciding",
        "settled",
        "recheck-pending",
    ] {
        let (mut c, r) = a_in(name);
        let ctx = format!("Drafted from {name}");
        assert_refused(&mut c, r, drafted(1, 0), IgnoredWhy::OutOfPhase, &ctx);
    }

    let (mut c, r) = a_in("drafting");
    assert_eq!(c.on_answer(r, "a", drafted(1, 0), 1200), Step::Wait);
    assert_refused(
        &mut c,
        r,
        drafted(1, 0),
        IgnoredWhy::Duplicate,
        "a second Drafted",
    );

    let others = [
        Answer::Clean,
        Answer::Dirty,
        discard(&["x"]),
        Answer::Cancel,
        Answer::Delivered,
    ];
    for answer in others {
        let (mut c, r) = a_in("drafting");
        let ctx = format!("{answer:?} while Drafting");
        assert_refused(&mut c, r, answer, IgnoredWhy::OutOfPhase, &ctx);
    }
}

// --- BS-7: the fallback QuitAnyway commits no ids and no backstop -----------

#[test]
fn bs7_quit_anyway_commits_no_ids_and_no_backstop() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    c.on_answer(r, "a", Answer::Clean, 500);
    c.on_answer(r, "b", Answer::Clean, 700);
    assert_eq!(c.on_answer(r, "a", Answer::Clean, 900), Step::Wait);
    assert_eq!(
        c.on_tick(2700),
        Step::NativeFallback {
            timed_out: vec!["b".to_string()]
        }
    );
    assert_eq!(
        c.on_fallback_answer(r, FallbackAnswer::QuitAnyway),
        Step::Commit {
            discard_document_ids: vec![],
            backstop: None,
        }
    );
}

// --- BS-9: a tick after the commit changes nothing ---------------------------

#[test]
fn bs9_a_tick_after_the_commit_is_inert() {
    let (mut c, r) = to_backstop();
    c.on_answer(r, "a", drafted(0, 0), 1200);
    assert!(matches!(
        c.on_answer(r, "b", drafted(0, 0), 1300),
        Step::Commit { .. }
    ));
    let before = c.clone();
    // The matrix wrote `Wait`; the recorded WI2-C1 spec (`coordinator_tests.rs`)
    // pins a request-less tick as `Ignored { StaleRequest }`. What BS-9 guards
    // is that no stale backstop timer commits a second time.
    assert_eq!(c.on_tick(99_999), ignored(IgnoredWhy::StaleRequest));
    assert_eq!(c, before);
}
