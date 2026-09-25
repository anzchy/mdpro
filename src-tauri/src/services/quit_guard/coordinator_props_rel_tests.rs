//! WI2-P2 .. WI2-P5: the relations between runs.
//!
//! P2 permutation invariance and the "gone after any answer" metamorphic
//! pairing, P3 monotonicity toward cancel/timeout, P4 inserted junk is inert,
//! P5 nothing after a terminal produces a second terminal.

use super::coordinator_domain_tests::*;
use super::*;
use std::collections::BTreeSet;

type Outcome = (String, BTreeSet<String>, Vec<String>);

fn outcome(d: &Runner) -> Outcome {
    let variant = match &d.trace[d.terminal_index()].step {
        Step::Commit { .. } => "commit",
        Step::Abort { .. } => "abort",
        Step::NativeFallback { .. } => "fallback",
        other => panic!("{}: {other:?} is not a terminal", d.row),
    };
    let ids: BTreeSet<String> = d.commit_ids().unwrap_or_default().into_iter().collect();
    (variant.to_string(), ids, d.prompted())
}

fn senders_of(assign: &[Kind]) -> Vec<usize> {
    (0..assign.len())
        .filter(|i| sends_phase1(assign[*i]))
        .collect()
}

fn tick_positions(assign: &[Kind], order: &[usize]) -> Vec<Option<usize>> {
    if assign.contains(&Kind::Timeout) {
        (0..=order.len()).map(Some).collect()
    } else {
        vec![None]
    }
}

// --- WI2-P2 (i): the arrival order of phase 1 does not change the outcome ----

#[test]
fn p2_permutation_invariance() {
    let mut groups = 0usize;
    for n in 1..=3usize {
        for assign in assignments(n) {
            let orders: Vec<Vec<usize>> = permutations(&senders_of(&assign))
                .into_iter()
                .filter(|o| realizable(&assign, o))
                .collect();
            if orders.len() < 2 {
                continue;
            }
            for tick_at in tick_positions(&assign, &orders[0]) {
                groups += 1;
                let mut reference: Option<(String, Outcome)> = None;
                for order in &orders {
                    let row = format!("assign={assign:?} order={order:?} tick={tick_at:?}");
                    let got = outcome(&run(&assign, order, tick_at, &row));
                    match &reference {
                        None => reference = Some((row, got)),
                        Some((first_row, first)) => assert_eq!(
                            &got, first,
                            "outcome depends on arrival order: {first_row} vs {row}"
                        ),
                    }
                }
            }
        }
    }
    assert!(groups > 100, "only {groups} permutation groups ran");
}

// --- WI2-P2 (ii): gone after an answer retracts nothing ---------------------

fn pair_of(k: Kind) -> Option<Kind> {
    match k {
        Kind::GoneAfterClean => Some(Kind::Clean),
        Kind::GoneAfterDiscard => Some(Kind::Discard),
        Kind::GoneAfterDirtyPhase1 => Some(Kind::GonePhase1),
        _ => None,
    }
}

/// The trace with the junk tail, window `i`'s gone, and - for the phase-1 dirty
/// pairing - window `i`'s own `Dirty` removed.
fn stripped(d: &Runner, i: usize, drop_phase1: bool) -> Vec<Step> {
    d.trace
        .iter()
        .filter(|r| r.tag != Tag::Junk)
        .filter(|r| r.tag != Tag::Gone(i))
        .filter(|r| !(drop_phase1 && r.tag == Tag::Phase1(i)))
        .map(|r| r.step.clone())
        .collect()
}

/// ADR-0035 (migration M1): `stripped` up to, not including, the first
/// `Recheck` or terminal, plus the terminal outcome. A gone window is not asked
/// in the re-check round, and a request with every window gone commits without
/// one (GN-2), so from that point the two runs legitimately differ in whether a
/// round runs, who answers it and which input resolves the request. What must
/// not differ is everything before it, and the outcome.
fn stripped_to_recheck(d: &Runner, i: usize, drop_phase1: bool) -> (Vec<Step>, Outcome) {
    let steps = stripped(d, i, drop_phase1)
        .into_iter()
        .take_while(|s| !matches!(s, Step::Recheck { .. }) && !is_terminal(s))
        .collect();
    (steps, outcome(d))
}

#[test]
fn p2_gone_after_any_answer_equals_the_answer_without_it() {
    let mut pairs = 0usize;
    let skipped = for_each_row(|assign, order, tick_at, row| {
        for i in 0..assign.len() {
            let Some(paired) = pair_of(assign[i]) else {
                continue;
            };
            let mut other = assign.to_vec();
            other[i] = paired;
            assert!(
                realizable(&other, order),
                "{row}: the paired assignment must stay realizable"
            );
            assert_eq!(expected_commit(assign), expected_commit(&other), "{row}");
            assert_eq!(expected_ids(assign), expected_ids(&other), "{row}");

            let drop_phase1 = paired == Kind::GonePhase1;
            let a = run(assign, order, tick_at, row);
            let b = run(&other, order, tick_at, row);
            // ADR-0035 changes the spec: commit is now preceded by a re-check round.
            assert_eq!(
                stripped_to_recheck(&a, i, drop_phase1),
                stripped_to_recheck(&b, i, false),
                "{row}: w{i} gone after {:?} is not equal to {paired:?}",
                assign[i]
            );
            pairs += 1;
        }
    });
    assert!(skipped > 0, "the realizability predicate filtered nothing");
    assert!(pairs > 1_000, "only {pairs} pairings ran");
}

// --- WI2-P3: monotonicity toward cancel and timeout -------------------------

/// Run an assignment in identity arrival order, with the tick (if any) last.
fn run_identity(assign: &[Kind], row: &str) -> Option<Runner> {
    let order = senders_of(assign);
    if !realizable(assign, &order) {
        return None;
    }
    let tick_at = if assign.contains(&Kind::Timeout) {
        Some(order.len())
    } else {
        None
    };
    Some(run(assign, &order, tick_at, row))
}

#[test]
fn p3_moving_a_window_toward_cancel_or_timeout_never_commits() {
    let mut moved = 0usize;
    for n in 1..=3usize {
        for assign in assignments(n) {
            let Some(base) = run_identity(&assign, "base") else {
                continue;
            };
            let base_commits =
                matches!(base.trace[base.terminal_index()].step, Step::Commit { .. });
            for i in 0..n {
                for x in [Kind::Cancel, Kind::Timeout] {
                    let mut worse = assign.clone();
                    worse[i] = x;
                    let row = format!("{assign:?} [{i}:={x:?}]");
                    let Some(d) = run_identity(&worse, &row) else {
                        continue;
                    };
                    assert!(
                        !matches!(d.trace[d.terminal_index()].step, Step::Commit { .. }),
                        "{row}: moving a window toward {x:?} still committed"
                    );
                    moved += 1;
                }
            }
            // Dual: dropping a discard shrinks the id set by exactly its ids.
            if !base_commits {
                continue;
            }
            for i in 0..n {
                let paired = match assign[i] {
                    Kind::Discard => Kind::Clean,
                    Kind::GoneAfterDiscard => Kind::GoneAfterClean,
                    _ => continue,
                };
                let mut lighter = assign.clone();
                lighter[i] = paired;
                let row = format!("{assign:?} [{i}:={paired:?}]");
                let Some(d) = run_identity(&lighter, &row) else {
                    continue;
                };
                let ids: BTreeSet<String> =
                    d.commit_ids().unwrap_or_default().into_iter().collect();
                let mut expected = expected_ids(&assign);
                for id in ids_of(i) {
                    expected.remove(&id);
                }
                assert_eq!(ids, expected, "{row}: removing a discard changed other ids");
            }
        }
    }
    assert!(moved > 1_000, "only {moved} monotonicity rows ran");
}

#[path = "coordinator_props_junk_tests.rs"]
mod coordinator_props_junk_tests;
