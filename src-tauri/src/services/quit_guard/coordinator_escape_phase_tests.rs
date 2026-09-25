//! Specification for `escape_phase` / `escape_ruling` and the law tying them to
//! `on_escape`: cases ph1 .. ph4 of `.claude/tdd-guardian/tests-20260925-155408.md`.
//!
//! Law: classification is a total function of the window statuses, the
//! `fallback` bit, `backstop.is_some()` and `round`, by the precedence
//! fallback > backstop > Prompted > Deciding > everything else. It never reads
//! `deadline_ms`, discard ids, `recheck_due` or `capped`.
//!
//! Registered from `coordinator_escape_tests.rs`. The enumeration is exhaustive
//! over N = 1..=3 windows × 7 statuses × fallback × backstop × round (3,192
//! requests), in place of a property library (D4).

use super::super::escape::{escape_phase, escape_ruling, EscapePhase, EscapeRuling};
use super::super::*;

const STATUSES: [Status; 7] = [
    Status::Pending,
    Status::Queued,
    Status::Prompted,
    Status::Deciding,
    Status::Settled,
    Status::Drafting,
    Status::Gone,
];

fn with_statuses(statuses: &[Status]) -> Request {
    let labels: Vec<String> = (0..statuses.len()).map(|i| format!("w{i}")).collect();
    let mut r = Request::open(1, &labels, 0);
    for (w, s) in r.windows.iter_mut().zip(statuses) {
        w.status = *s;
    }
    r
}

/// Every request in the enumerated domain.
fn all_requests() -> Vec<Request> {
    let mut out = Vec::new();
    for n in 1..=3u32 {
        for code in 0..7usize.pow(n) {
            let statuses: Vec<Status> = (0..n)
                .map(|i| STATUSES[(code / 7usize.pow(i)) % 7])
                .collect();
            for fallback in [false, true] {
                for backstop in [None, Some(BackstopTally::default())] {
                    for round in [0, 1] {
                        let mut r = with_statuses(&statuses);
                        r.fallback = fallback;
                        r.backstop = backstop;
                        r.round = round;
                        out.push(r);
                    }
                }
            }
        }
    }
    out
}

/// The plan's precedence table, written literally.
fn oracle(r: &Request) -> EscapePhase {
    let any = |s: Status| r.windows.iter().any(|w| w.status == s);
    if r.fallback {
        EscapePhase::Fallback
    } else if r.backstop.is_some() {
        EscapePhase::Backstop
    } else if any(Status::Prompted) {
        EscapePhase::AwaitingDelivery
    } else if any(Status::Deciding) {
        EscapePhase::Deciding
    } else {
        EscapePhase::Checking { round: r.round }
    }
}

fn slot(phase: EscapePhase) -> usize {
    match phase {
        EscapePhase::Idle => 0,
        EscapePhase::Checking { .. } => 1,
        EscapePhase::AwaitingDelivery => 2,
        EscapePhase::Deciding => 3,
        EscapePhase::Backstop => 4,
        EscapePhase::Fallback => 5,
    }
}

#[test]
fn ph1_escape_phase_matches_precedence_oracle_over_every_status_tuple() {
    assert_eq!(escape_phase(None), EscapePhase::Idle);
    let mut seen = [0usize; 6];
    let requests = all_requests();
    for r in &requests {
        let got = escape_phase(Some(r));
        assert_eq!(got, oracle(r), "{r:?}");
        seen[slot(got)] += 1;
    }
    assert!(requests.len() >= 3_000, "rows {}", requests.len());
    for (i, count) in seen.iter().enumerate().skip(1) {
        assert!(
            *count >= 100,
            "live verdict slot {i} produced only {count} times"
        );
    }
}

#[test]
fn ph2_named_overlaps_classify_by_documented_precedence() {
    use Status::*;
    let tally = Some(BackstopTally::default());
    let row = |s: &[Status], fallback: bool, backstop: Option<BackstopTally>, round: u32| {
        let mut r = with_statuses(s);
        r.fallback = fallback;
        r.backstop = backstop;
        r.round = round;
        escape_phase(Some(&r))
    };
    assert_eq!(
        row(&[Drafting, Pending], true, tally, 0),
        EscapePhase::Fallback
    );
    assert_eq!(
        row(&[Prompted, Deciding], false, None, 0),
        EscapePhase::AwaitingDelivery
    );
    assert_eq!(
        row(&[Pending, Drafting], false, tally, 0),
        EscapePhase::Backstop
    );
    assert_eq!(
        row(&[Deciding, Pending], false, None, 0),
        EscapePhase::Deciding
    );
    assert_eq!(
        row(&[Settled, Gone], false, None, 1),
        EscapePhase::Checking { round: 1 }
    );
    assert_eq!(
        row(&[Queued, Settled], false, None, 0),
        EscapePhase::Checking { round: 0 }
    );
}

/// One arm per `EscapePhase`, no `_`: a new variant fails compilation here.
fn table(phase: EscapePhase) -> EscapeRuling {
    match phase {
        EscapePhase::Idle => EscapeRuling::Noop,
        EscapePhase::Checking { .. } => EscapeRuling::Fallback,
        EscapePhase::AwaitingDelivery => EscapeRuling::Fallback,
        EscapePhase::Deciding => EscapeRuling::Fallback,
        EscapePhase::Backstop => EscapeRuling::Ignored(IgnoredWhy::OutOfPhase),
        EscapePhase::Fallback => EscapeRuling::Ignored(IgnoredWhy::FallbackOwns),
    }
}

#[test]
fn ph3_escape_ruling_is_total_one_row_per_phase() {
    let rows = [
        (EscapePhase::Idle, EscapeRuling::Noop),
        (EscapePhase::Checking { round: 0 }, EscapeRuling::Fallback),
        (EscapePhase::Checking { round: 7 }, EscapeRuling::Fallback),
        (EscapePhase::AwaitingDelivery, EscapeRuling::Fallback),
        (EscapePhase::Deciding, EscapeRuling::Fallback),
        (
            EscapePhase::Backstop,
            EscapeRuling::Ignored(IgnoredWhy::OutOfPhase),
        ),
        (
            EscapePhase::Fallback,
            EscapeRuling::Ignored(IgnoredWhy::FallbackOwns),
        ),
    ];
    for (phase, want) in rows {
        assert_eq!(escape_ruling(phase), want, "{phase:?}");
        assert_eq!(table(phase), want, "{phase:?}");
    }
}

#[test]
fn ph4_on_escape_agrees_with_phase_ruling_over_every_status_tuple() {
    let mut idle = QuitCoordinator::new();
    let before = idle.clone();
    assert_eq!(
        idle.on_escape(),
        Step::Ignored {
            why: IgnoredWhy::StaleRequest
        }
    );
    assert_eq!(idle, before);

    let (mut rows, mut saw_queued, mut saw_deciding) = (0usize, false, false);
    for r in all_requests() {
        let mut c = QuitCoordinator::new();
        c.request = Some(r);
        let before = c.clone();
        let want = escape_ruling(escape_phase(c.request.as_ref()));
        let step = c.on_escape();
        match want {
            EscapeRuling::Fallback => {
                let windows = &before.request.as_ref().unwrap().windows;
                let unresolved: Vec<_> = windows
                    .iter()
                    .filter(|w| w.status != Status::Settled && w.status != Status::Gone)
                    .collect();
                saw_queued |= unresolved.iter().any(|w| w.status == Status::Queued);
                saw_deciding |= unresolved.iter().any(|w| w.status == Status::Deciding);
                let timed_out = unresolved.iter().map(|w| w.label.clone()).collect();
                assert_eq!(step, Step::NativeFallback { timed_out }, "{before:?}");
                let mut frame = before.clone();
                frame.request.as_mut().unwrap().fallback = true;
                assert_eq!(c, frame);
            }
            EscapeRuling::Ignored(why) => {
                assert_eq!(step, Step::Ignored { why }, "{before:?}");
                assert_eq!(c, before);
            }
            EscapeRuling::Noop => {
                assert_eq!(
                    step,
                    Step::Ignored {
                        why: IgnoredWhy::StaleRequest
                    }
                );
                assert_eq!(c, before);
            }
        }
        rows += 1;
    }
    assert!(rows >= 3_000, "rows {rows}");
    assert!(
        saw_queued && saw_deciding,
        "queued {saw_queued}, deciding {saw_deciding}"
    );
}
