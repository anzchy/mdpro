//! WI-5: the shared scaffolding of the escape laws (E1-E3 in
//! `coordinator_escape_props_tests.rs`, E4-E6 in
//! `coordinator_escape_props_rel_tests.rs`), split out under rule 50 §6.
//!
//! `for_each_run` walks every canonical run of one exhaustive domain;
//! `states` rebuilds the coordinator before each input with `dispatch`; the
//! two verdict functions derive what an escape must do from the trace prefix
//! and, independently, from the state. None of them calls `on_escape`.
//!
//! Domain size with the escape axis (2026-09-25). The canonical rows are
//! unchanged, because `Input::Escape` is only injected, never generated:
//! - phase 1: 6_351 rows, 63_770 escape injection points;
//! - phase 2: 18_641 rows (× `Delivery`), 225_276 injection points;
//! - re-check: 94_141 rows, 1_481_823 injection points.
//!
//! E3 adds a second escape: every k2 ≥ k1 on phases 1 and 2, and
//! k2 ∈ {k1, terminal} on the re-check domain (matrix D6).
//!
//! Measured runtime (debug build, 10-core Apple Silicon): the 17 escape
//! tests take about 9.9 s wall with the default test threads, and all of
//! `coordinator_domain_tests` about 11.7 s, up from 3.8 s. The re-check
//! E2 and E3 cases dominate, at about 8 s each alone.

use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Dom {
    Phase1,
    Phase2,
    Recheck,
}

pub(super) const RECHECK_MIN_ROWS: usize = 90_000;

/// Every canonical run of `dom`, finished; returns the number of rows.
pub(super) fn for_each_run(dom: Dom, mut f: impl FnMut(&Runner)) -> usize {
    let mut rows = 0usize;
    match dom {
        Dom::Phase1 => {
            for_each_row(|a, o, t, name| {
                rows += 1;
                f(&run(a, o, t, name));
            });
        }
        Dom::Phase2 => for_each_phase2_row(|a, o, t, delivery, name| {
            rows += 1;
            f(&run_with(a, o, t, delivery, name));
        }),
        Dom::Recheck => {
            for_each_recheck_row(|row| {
                rows += 1;
                f(&run_recheck(row, false).d);
            });
        }
    }
    rows
}

/// The coordinator before each canonical input `p` (0..=len), rebuilt from
/// `d.inputs`; asserts the rebuild reproduces the recorded trace.
pub(super) fn states(d: &Runner) -> Vec<QuitCoordinator> {
    let mut c = QuitCoordinator::new();
    match c.begin(&d.labels, 0) {
        Begin::Later { request_id } => assert_eq!(request_id, d.id, "{}", d.row),
        other => panic!("{}: begin gave {other:?}", d.row),
    }
    let mut out = vec![c.clone()];
    for (p, input) in d.inputs.iter().enumerate() {
        let step = dispatch(&mut c, d.id, &d.labels, input);
        assert_eq!(step, d.trace[p].step, "{}: rebuild diverged at {p}", d.row);
        out.push(c.clone());
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Verdict {
    Live,
    Owns,
    OutOfPhase,
    Stale,
}

/// From the trace alone: a terminal (Commit/Abort) makes it stale, else an
/// alert makes it fallback-owned, else a `Backstop` step puts it out of phase.
pub(super) fn trace_verdict(prefix: &[Rec]) -> Verdict {
    let any = |f: fn(&Step) -> bool| prefix.iter().any(|r| f(&r.step));
    if any(|s| matches!(s, Step::Commit { .. } | Step::Abort { .. })) {
        Verdict::Stale
    } else if any(|s| matches!(s, Step::NativeFallback { .. })) {
        Verdict::Owns
    } else if any(|s| matches!(s, Step::Backstop { .. })) {
        Verdict::OutOfPhase
    } else {
        Verdict::Live
    }
}

/// From the state alone, for the cross-check.
pub(super) fn state_verdict(c: &QuitCoordinator) -> Verdict {
    match c.request.as_ref() {
        None => Verdict::Stale,
        Some(q) if q.fallback => Verdict::Owns,
        Some(q) if q.backstop.is_some() => Verdict::OutOfPhase,
        Some(_) => Verdict::Live,
    }
}

/// Labels still owed something (test-local: not Settled, not Gone).
pub(super) fn unresolved_labels(c: &QuitCoordinator) -> Vec<String> {
    let Some(q) = c.request.as_ref() else {
        return vec![];
    };
    q.windows
        .iter()
        .filter(|w| !matches!(w.status, Status::Settled | Status::Gone))
        .map(|w| w.label.clone())
        .collect()
}

pub(super) fn expected(v: Verdict, c: &QuitCoordinator) -> Step {
    let why = match v {
        Verdict::Live => {
            return Step::NativeFallback {
                timed_out: unresolved_labels(c),
            }
        }
        Verdict::Owns => IgnoredWhy::FallbackOwns,
        Verdict::OutOfPhase => IgnoredWhy::OutOfPhase,
        Verdict::Stale => IgnoredWhy::StaleRequest,
    };
    Step::Ignored { why }
}

pub(super) fn alerts(step: &Step) -> usize {
    usize::from(matches!(step, Step::NativeFallback { .. }))
}

pub(super) fn has(c: &QuitCoordinator, status: Status) -> bool {
    c.request
        .as_ref()
        .is_some_and(|q| q.windows.iter().any(|w| w.status == status))
}
