//! WI-5: the escape laws E4-E6, relational and state laws over the same three
//! exhaustive domains as E1-E3 (`coordinator_escape_props_tests.rs`). The
//! shared domain walk and state rebuild live in
//! `coordinator_escape_props_fixtures.rs`.
//!
//! - E4: an escape where it is refused (the backstop window, and every point
//!   after the terminal step) is inert: a metamorphic twin of P4.
//! - E5: every live escape resolves through the ADR-0027 alert exactly as a
//!   timer fallback does, and the next `begin` opens a fresh request.
//! - E6: escapes on an idle coordinator change nothing, however many.

use super::coordinator_escape_props_fixtures::{for_each_run, states, Dom, RECHECK_MIN_ROWS};
use super::*;

fn effective(d: &Runner) -> Vec<Step> {
    d.steps()
        .into_iter()
        .filter(|s| !matches!(s, Step::Ignored { .. }))
        .collect()
}

/// E4: `(rows, backstop-window insertions, post-terminal insertions)`.
fn e4(dom: Dom) -> (usize, usize, usize) {
    let (mut in_backstop, mut post_terminal) = (0usize, 0usize);
    let rows = for_each_run(dom, |d| {
        let st = states(d);
        let len = d.inputs.len();
        let t = d.trace.iter().position(|r| is_terminal(&r.step));
        let b = d
            .trace
            .iter()
            .position(|r| matches!(r.step, Step::Backstop { .. }));
        let mut at: Vec<(usize, bool)> = Vec::new();
        if let (Some(b), Some(t)) = (b, t) {
            at.extend((b + 1..=t.max(b)).map(|p| (p, true)));
        }
        if let Some(t) = t {
            at.extend((t + 1..=len).map(|p| (p, false)));
        }
        for (p, backstop) in at {
            let mut after = st[p].clone();
            let step = after.on_escape();
            assert!(
                matches!(step, Step::Ignored { .. }),
                "{} @{p}: {step:?}",
                d.row
            );
            assert!(after == st[p], "{} @{p}: a refused escape moved it", d.row);
            let n = d.labels.len();
            let (r, js) = replay(n, &d.inputs, Some((p, Input::Escape)), &d.row);
            assert_eq!(js, Some(step), "{} @{p}", d.row);
            assert_eq!(effective(&r), effective(d), "{} @{p}", d.row);
            assert_eq!(r.commit_ids(), d.commit_ids(), "{} @{p}", d.row);
            if backstop {
                in_backstop += 1;
            } else {
                post_terminal += 1;
            }
        }
    });
    (rows, in_backstop, post_terminal)
}

#[test]
fn e4_refused_escape_is_inert_phase1() {
    let (rows, b, post) = e4(Dom::Phase1);
    assert!(rows > 1_000 && b > 0 && post >= rows, "{rows} {b} {post}");
}

#[test]
fn e4_refused_escape_is_inert_phase2() {
    let (rows, b, post) = e4(Dom::Phase2);
    assert!(rows > 5_000 && b > 0 && post >= rows, "{rows} {b} {post}");
}

#[test]
fn e4_refused_escape_is_inert_recheck() {
    let (rows, b, post) = e4(Dom::Recheck);
    assert!(
        rows >= RECHECK_MIN_ROWS && b > 0 && post >= rows,
        "{b} {post}"
    );
}

/// E5: `(rows, live points, live points with accepted discards)`.
fn e5(dom: Dom) -> (usize, usize, usize) {
    let (mut points, mut with_ids) = (0usize, 0usize);
    let rows = for_each_run(dom, |d| {
        for (k, c) in states(d).iter().enumerate() {
            let mut s = c.clone();
            if !matches!(s.on_escape(), Step::NativeFallback { .. }) {
                continue;
            }
            points += 1;
            let ids = c.request.as_ref().map(|q| q.discard_document_ids.len());
            with_ids += usize::from(ids.unwrap_or(0) > 0);
            let resolutions = [
                (
                    FallbackAnswer::KeepOpen,
                    Step::Abort {
                        reason: AbortReason::UserKeptOpen,
                    },
                ),
                (
                    FallbackAnswer::QuitAnyway,
                    Step::Commit {
                        discard_document_ids: vec![],
                        backstop: None,
                    },
                ),
            ];
            for (answer, want) in resolutions {
                let mut e = s.clone();
                let step = e.on_fallback_answer(d.id, answer);
                assert_eq!(step, want, "{} @{k}: {answer:?}", d.row);
                assert!(e.request.is_none(), "{} @{k}: {answer:?}", d.row);
                match e.begin(&d.labels, 2) {
                    Begin::Later { request_id } => {
                        assert!(request_id > d.id, "{} @{k}: id {request_id}", d.row)
                    }
                    other => panic!("{} @{k}: begin after {answer:?}: {other:?}", d.row),
                }
            }
        }
    });
    (rows, points, with_ids)
}

#[test]
fn e5_escape_then_alert_resolution_phase1() {
    let (rows, points, with_ids) = e5(Dom::Phase1);
    assert!(
        rows > 1_000 && points > rows && with_ids > 0,
        "{points} {with_ids}"
    );
}

#[test]
fn e5_escape_then_alert_resolution_phase2() {
    let (rows, points, with_ids) = e5(Dom::Phase2);
    assert!(
        rows > 5_000 && points > rows && with_ids > 0,
        "{points} {with_ids}"
    );
}

#[test]
fn e5_escape_then_alert_resolution_recheck() {
    let (rows, points, with_ids) = e5(Dom::Recheck);
    assert!(rows >= RECHECK_MIN_ROWS && points > rows && with_ids > 0);
}

#[test]
fn e6_idle_escapes_are_idempotent() {
    let mut after_begin = Vec::new();
    for n in [0usize, 1, 2, 5] {
        let mut c = QuitCoordinator::new();
        for _ in 0..n {
            let why = IgnoredWhy::StaleRequest;
            assert_eq!(c.on_escape(), Step::Ignored { why }, "n={n}");
        }
        assert!(c == QuitCoordinator::new(), "n={n}: idle escapes moved it");
        match c.begin(&["a", "b"][..], 0) {
            Begin::Later { request_id } => assert_eq!(request_id, 1, "n={n}"),
            other => panic!("n={n}: begin gave {other:?}"),
        }
        after_begin.push(c);
    }
    assert!(after_begin.windows(2).all(|w| w[0] == w[1]));
}
