//! Specification for `QuitCoordinator::on_escape` (ADR-0030, ADR-0036): cases
//! esc1 .. esc14 of `.claude/tdd-guardian/tests-20260925-155408.md`.
//!
//! Law: a Fallback ruling changes exactly one bit (`request.fallback`); a
//! refused ruling changes nothing; neither depends on `deadline_ms`; and once
//! the fallback owns a request, every non-alert input is refused and inert.
//!
//! Registered from `coordinator.rs`. It also registers the phase / ruling
//! specification (ph1 .. ph4, `coordinator_escape_phase_tests.rs`).

use super::coordinator_backstop_tests::{drafted, to_backstop};
use super::coordinator_recheck_tests::fixtures::*;
use super::*;

#[path = "coordinator_escape_phase_tests.rs"]
mod coordinator_escape_phase_tests;

fn native(labels: &[&str]) -> Step {
    Step::NativeFallback {
        timed_out: labels.iter().map(|s| (*s).to_string()).collect(),
    }
}

/// `before` with only `request.fallback` set: the Fallback frame condition.
fn fallback_frame(before: &QuitCoordinator) -> QuitCoordinator {
    let mut want = before.clone();
    want.request.as_mut().expect("a live request").fallback = true;
    want
}

/// Escape must alert over `labels` and change only the fallback bit.
fn escape_alerts(c: &mut QuitCoordinator, labels: &[&str]) {
    let before = c.clone();
    assert_eq!(c.on_escape(), native(labels));
    assert_eq!(*c, fallback_frame(&before));
}

/// Escape must be refused with `why` and change nothing.
fn escape_refused(c: &mut QuitCoordinator, why: IgnoredWhy) {
    let before = c.clone();
    assert_eq!(c.on_escape(), ignored(why));
    assert_eq!(*c, before);
}

/// esc3's state: w0 Prompted, w1 Queued, w2 Settled.
fn esc3_state() -> (QuitCoordinator, u64) {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["w0", "w1", "w2"], 0);
    assert_eq!(c.on_answer(r, "w0", Answer::Dirty, 10), Step::Wait);
    assert_eq!(c.on_answer(r, "w1", Answer::Dirty, 20), Step::Wait);
    assert!(matches!(
        c.on_answer(r, "w2", Answer::Clean, 30),
        Step::Prompt { .. }
    ));
    assert_eq!(status(&c, "w0"), Status::Prompted);
    assert_eq!(status(&c, "w1"), Status::Queued);
    assert_eq!(status(&c, "w2"), Status::Settled);
    (c, r)
}

/// esc4's state: `a` Deciding with no deadline, `b` Settled.
fn esc4_state() -> (QuitCoordinator, u64) {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 10), Step::Wait);
    assert!(matches!(
        c.on_answer(r, "b", Answer::Clean, 20),
        Step::Prompt { .. }
    ));
    assert_eq!(c.on_answer(r, "a", Answer::Delivered, 30), Step::Wait);
    assert_eq!(status(&c, "a"), Status::Deciding);
    assert_eq!(req(&c).deadline_ms, None);
    (c, r)
}

/// esc5's state: re-check round 1, both windows Pending, `d1` discarded.
fn esc5_state() -> (QuitCoordinator, u64) {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 10), Step::Wait);
    assert!(matches!(
        c.on_answer(r, "b", Answer::Clean, 20),
        Step::Prompt { .. }
    ));
    assert_eq!(c.on_answer(r, "a", Answer::Delivered, 30), Step::Wait);
    let step = c.on_answer(r, "a", discard(&["d1"]), 40);
    assert!(matches!(step, Step::Recheck { .. }), "got {step:?}");
    assert_eq!(c.round(), Some(1));
    assert_eq!(pending_labels(&c), vec!["a", "b"]);
    assert_eq!(req(&c).discard_document_ids, vec!["d1".to_string()]);
    (c, r)
}

#[test]
fn esc1_idle_escape_is_stale_request_and_inert() {
    escape_refused(&mut QuitCoordinator::new(), IgnoredWhy::StaleRequest);
}

#[test]
fn esc2_phase1_all_pending_alerts_every_label_in_order() {
    let all = ["w0", "w1", "w2"];
    for n in 1..=3 {
        let mut c = QuitCoordinator::new();
        begin_later(&mut c, &all[..n], 0);
        escape_alerts(&mut c, &all[..n]);
    }
}

#[test]
fn esc3_phase2_prompted_includes_queued_and_excludes_settled() {
    let (mut c, _) = esc3_state();
    escape_alerts(&mut c, &["w0", "w1"]);
}

#[test]
fn esc4_phase2_deciding_without_deadline_still_alerts() {
    let (mut c, _) = esc4_state();
    assert_eq!(
        c.clone().on_tick(u64::MAX),
        Step::Wait,
        "the timer cannot rescue it"
    );
    escape_alerts(&mut c, &["a"]);
    assert!(req(&c).fallback);
    assert_eq!(req(&c).deadline_ms, None);
}

#[test]
fn esc5_recheck_round1_alerts_and_keeps_round() {
    let (mut c, _) = esc5_state();
    escape_alerts(&mut c, &["a", "b"]);
    assert_eq!(c.round(), Some(1));
    assert_eq!(req(&c).discard_document_ids, vec!["d1".to_string()]);
}

#[test]
fn esc6_backstop_escape_is_out_of_phase_and_inert() {
    let (mut c, _) = to_backstop();
    assert!(req(&c).backstop.is_some() && req(&c).deadline_ms.is_some());
    escape_refused(&mut c, IgnoredWhy::OutOfPhase);

    let (mut c, r) = to_backstop();
    assert_eq!(c.on_answer(r, "a", drafted(2, 1), 1200), Step::Wait);
    assert_eq!(req(&c).backstop.map(|t| t.drafted), Some(2));
    escape_refused(&mut c, IgnoredWhy::OutOfPhase);
}

#[test]
fn esc7_escape_after_timer_fallback_is_fallback_owns() {
    let mut c = QuitCoordinator::new();
    begin_later(&mut c, &["a"], 0);
    assert_eq!(c.on_tick(QUIT_ACK_TIMEOUT_MS), native(&["a"]));
    escape_refused(&mut c, IgnoredWhy::FallbackOwns);

    let mut c = QuitCoordinator::new();
    begin_later(&mut c, &["a"], 0);
    escape_alerts(&mut c, &["a"]);
    escape_refused(&mut c, IgnoredWhy::FallbackOwns);
}

#[test]
fn esc8_escape_after_commit_is_stale_and_begin_continues() {
    let mut c = QuitCoordinator::new();
    let r1 = begin_later(&mut c, &["a"], 0);
    let step = c.on_answer(r1, "a", Answer::Clean, 10);
    let done = through_recheck(&mut c, r1, step, 20);
    assert!(matches!(done, Step::Commit { .. }), "got {done:?}");
    escape_refused(&mut c, IgnoredWhy::StaleRequest);
    let r2 = begin_later(&mut c, &["a"], 5000);
    assert!(r2 > r1, "the escape must not disturb request numbering");
}

#[test]
fn esc9_release_fallback_then_escape_retries() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    let first = c.on_escape();
    assert_eq!(first, native(&["a", "b"]));
    assert!(c.release_fallback(r));
    let before = c.clone();
    let second = c.on_escape();
    assert_eq!(second, first);
    assert_eq!(c, fallback_frame(&before));
    assert!(req(&c).fallback);
    assert_eq!(req(&c).deadline_ms, None);
}

#[test]
fn esc10_residual_all_settled_or_gone_alerts_with_empty_list() {
    let mut c = QuitCoordinator::new();
    begin_later(&mut c, &["a", "b", "c"], 0);
    let statuses = [Status::Settled, Status::Gone, Status::Settled];
    for (w, s) in c.request.as_mut().unwrap().windows.iter_mut().zip(statuses) {
        w.status = s;
    }
    escape_alerts(&mut c, &[]);
    assert!(req(&c).fallback);
}

#[test]
fn esc11_keep_open_after_escape_aborts_user_kept_open() {
    let (mut c, r) = esc4_state();
    escape_alerts(&mut c, &["a"]);
    let step = c.on_fallback_answer(r, FallbackAnswer::KeepOpen);
    assert_eq!(
        step,
        Step::Abort {
            reason: AbortReason::UserKeptOpen
        }
    );
    assert!(c.request.is_none());
}

#[test]
fn esc12_quit_anyway_after_escape_commits_with_no_discards() {
    let (mut c, r) = esc5_state();
    assert!(!req(&c).discard_document_ids.is_empty(), "not vacuous");
    escape_alerts(&mut c, &["a", "b"]);
    let step = c.on_fallback_answer(r, FallbackAnswer::QuitAnyway);
    assert_eq!(
        step,
        Step::Commit {
            discard_document_ids: vec![],
            backstop: None
        }
    );
}

/// Apply `input` to a fresh clone of `s`: it must be refused with `why`, inert.
fn inert(s: &QuitCoordinator, why: IgnoredWhy, input: impl FnOnce(&mut QuitCoordinator) -> Step) {
    let mut c = s.clone();
    assert_eq!(input(&mut c), ignored(why));
    assert_eq!(c, *s);
}

#[test]
fn esc13_every_input_after_escape_is_refused_and_inert() {
    let (mut s, r) = esc3_state();
    escape_alerts(&mut s, &["w0", "w1"]);
    let answers = [
        Answer::Clean,
        Answer::Dirty,
        discard(&["x"]),
        Answer::Cancel,
        Answer::Delivered,
        drafted(1, 0),
        Answer::DraftedUndiscarding {
            drafted: 1,
            failed: 0,
            undiscarded: vec!["x".to_string()],
        },
    ];
    let owns = IgnoredWhy::FallbackOwns;
    for label in ["w0", "w1", "w2"] {
        for answer in &answers {
            for round in [None, Some(0)] {
                inert(&s, owns, |c| {
                    c.on_answer_in(r, round, label, answer.clone(), 99)
                });
            }
        }
        inert(&s, owns, |c| c.on_window_gone(label, 99));
    }
    inert(&s, owns, |c| c.on_tick(u64::MAX));
    inert(&s, owns, |c| c.on_delivery_failed(r, "w0"));
    inert(&s, owns, |c| c.on_escape());
    inert(&s, IgnoredWhy::StaleRequest, |c| {
        c.on_answer_in(r + 1, Some(0), "w0", Answer::Clean, 99)
    });
}

#[test]
fn esc14_escape_is_independent_of_deadline() {
    let mut esc2 = QuitCoordinator::new();
    begin_later(&mut esc2, &["w0", "w1"], 0);
    for base in [esc3_state().0, esc2] {
        let mut steps = Vec::new();
        for deadline in [None, Some(0), Some(u64::MAX)] {
            let mut c = base.clone();
            c.request.as_mut().unwrap().deadline_ms = deadline;
            let before = c.clone();
            steps.push(c.on_escape());
            assert_eq!(c, fallback_frame(&before), "deadline {deadline:?}");
        }
        assert!(
            matches!(steps[0], Step::NativeFallback { .. }),
            "{:?}",
            steps[0]
        );
        assert_eq!(steps[0], steps[1]);
        assert_eq!(steps[1], steps[2]);
    }
}
