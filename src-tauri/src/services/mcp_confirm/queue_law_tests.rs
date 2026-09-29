//! Law specification for `PendingTable` (matrix Q-12, Q-13, Q-14, and law
//! 5 "closed is absorbing"), hand-enumerated (no proptest): every sequence
//! over the 27-op alphabet Σ of length ≤ 4, plus every sequence over the
//! 8-op Σ′ of length 5–6, over 2 windows × at most 3 requests.

use super::law_fixtures::{b_effects, enumerate_all, project_to_b, run_checked, sigma};
use super::*;

const SHORT_RUNS: usize = 1 + 27 + 27 * 27 + 27 * 27 * 27 + 27 * 27 * 27 * 27;
const LONG_RUNS: usize = 8 * 8 * 8 * 8 * 8 + 8 * 8 * 8 * 8 * 8 * 8;

#[test]
fn alphabet_and_enumeration_sizes_are_as_specified() {
    assert_eq!(sigma().len(), 27);
    assert_eq!(SHORT_RUNS, 551_881);
    assert_eq!(LONG_RUNS, 294_912);
}

/// Q-12 + Q-13 (+ law 5): conservation, exactly-once, reply acceptance,
/// FIFO, one shown per window, one end signal per shown id — checked after
/// every step of every enumerated run.
#[test]
fn q12_q13_conservation_fifo_and_one_end_signal_per_shown_id() {
    let mut seen = [0usize; 5]; // Show, Approved, Rejected, Dismiss, AppExit-on-enqueue
    let counts = enumerate_all(&mut |ops| {
        for step in run_checked(ops) {
            for fx in &step.effects {
                match fx {
                    Effect::Show { .. } => seen[0] += 1,
                    Effect::Resolve {
                        outcome: Outcome::Approved,
                        ..
                    } => seen[1] += 1,
                    Effect::Resolve {
                        outcome: Outcome::Rejected,
                        ..
                    } => seen[2] += 1,
                    Effect::Dismiss { .. } => seen[3] += 1,
                    Effect::Resolve {
                        outcome: Outcome::Cancelled(Cause::AppExit),
                        ..
                    } if matches!(step.op, super::law_fixtures::Op::Enq(_)) => seen[4] += 1,
                    Effect::Resolve { .. } => {}
                }
            }
        }
    });
    assert_eq!(
        counts,
        (SHORT_RUNS, LONG_RUNS),
        "the enumeration must cover every run"
    );
    for (i, n) in seen.iter().enumerate() {
        assert!(
            *n > 0,
            "effect kind #{i} never occurred: the laws were checked vacuously"
        );
    }
}

/// Q-14: window B's effects are the same with or without window A's ops.
#[test]
fn q14_window_independence() {
    let mut nonempty = 0usize;
    let counts = enumerate_all(&mut |ops| {
        let full = run_checked(ops);
        let projected_ops = project_to_b(&full);
        let alone = run_checked(&projected_ops);
        let (got, want) = (b_effects(&full), b_effects(&alone));
        assert_eq!(
            got, want,
            "B diverged for {ops:?} (projection {projected_ops:?})"
        );
        if !got.is_empty() && projected_ops.len() < ops.len() {
            nonempty += 1;
        }
    });
    assert_eq!(
        counts,
        (SHORT_RUNS, LONG_RUNS),
        "the enumeration must cover every run"
    );
    assert!(
        nonempty > 0,
        "no interleaved run produced B effects: vacuous"
    );
}
