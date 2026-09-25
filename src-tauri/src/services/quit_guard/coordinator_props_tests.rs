//! WI2-P1: the exhaustive enumeration of the answer domain.
//!
//! N in {1,2,3} windows x 11 answer kinds x every phase-1 arrival permutation x
//! every insertion point of the single tick. Each run is checked against the
//! independent oracle in `coordinator_domain_tests.rs`.

use super::coordinator_domain_tests::*;
use super::*;
use std::collections::BTreeSet;

#[derive(Default)]
struct Counters {
    runs: usize,
    commits: usize,
    aborts: usize,
    fallbacks: usize,
    prompted_three: usize,
    gone_while_queued_rows: [usize; 4],
    gone_after_clean_while_prompted: usize,
    gone_after_dirty_rows: [usize; 4],
    gone_after_dirty_c17_shape: usize,
    gone_after_discard_carried_ids: usize,
}

/// The state of the prompt as the trace is walked: `(before, after)` each step.
fn walk_outstanding(assign: &[Kind], d: &Runner) -> Vec<(Option<usize>, Option<usize>)> {
    let mut outstanding: Option<usize> = None;
    let mut out = Vec::new();
    for rec in &d.trace {
        let before = outstanding;
        let resolves = match rec.tag {
            Tag::Phase2(i) | Tag::Gone(i) => outstanding == Some(i),
            // Exhaustive (WI-5): no `_ =>` on `Tag`.
            Tag::Phase1(_)
            | Tag::Tick
            | Tag::Junk
            | Tag::Delivered(_)
            | Tag::DeliveryTick(_)
            | Tag::LateTick(_)
            | Tag::Recheck(_)
            | Tag::Backstop(_)
            | Tag::Escape => false,
        };
        if resolves {
            outstanding = None;
        }
        if let Step::Prompt { label, .. } = &rec.step {
            assert!(
                outstanding.is_none(),
                "{}: {label} prompted while w{:?} is still outstanding",
                d.row,
                before
            );
            let idx = d.labels.iter().position(|l| l == label).unwrap();
            assert!(
                is_prompted(assign[idx]),
                "{}: {label} was prompted but its kind never is",
                d.row
            );
            outstanding = Some(idx);
        }
        out.push((before, outstanding));
    }
    out
}

fn check_row(
    assign: &[Kind],
    order: &[usize],
    tick_at: Option<usize>,
    row: &str,
    k: &mut Counters,
) {
    let n = assign.len();
    let d = run(assign, order, tick_at, row);
    let steps = d.steps();
    let terminal = d.terminal_index();
    k.runs += 1;

    // (a) the terminal kind follows the oracle.
    let committed = matches!(d.trace[terminal].step, Step::Commit { .. });
    assert_eq!(
        committed,
        expected_commit(assign),
        "{row}: terminal {:?} disagrees with the oracle; trace {steps:?}",
        d.trace[terminal].step
    );
    match &d.trace[terminal].step {
        Step::Commit { .. } => k.commits += 1,
        Step::Abort { .. } => {
            assert!(
                assign.contains(&Kind::Cancel),
                "{row}: aborted with no cancelling window"
            );
            k.aborts += 1;
        }
        Step::NativeFallback { timed_out } => {
            assert!(
                assign.contains(&Kind::Timeout),
                "{row}: the alert went up with no silent window"
            );
            // Every window that had not yet sent a phase-1 input when the tick
            // landed is silent, not only the ones assigned `Timeout`.
            let fed = &order[..tick_at.expect("a fallback needs a tick")];
            let expected: Vec<String> = (0..n)
                .filter(|i| !fed.contains(i))
                .map(|i| format!("w{i}"))
                .collect();
            assert_eq!(
                timed_out, &expected,
                "{row}: the alert named the wrong windows"
            );
            k.fallbacks += 1;
        }
        other => panic!("{row}: {other:?} is not a terminal"),
    }

    // (b) id conservation.
    if let Some(ids) = d.commit_ids() {
        let set: BTreeSet<String> = ids.iter().cloned().collect();
        assert_eq!(set, expected_ids(assign), "{row}: wrong discard ids");
        assert_eq!(set.len(), ids.len(), "{row}: duplicate ids in {ids:?}");
    }

    // (c) exactly one terminal, and everything after it is ignored.
    assert_eq!(
        steps.iter().filter(|s| is_terminal(s)).count(),
        1,
        "{row}: more than one terminal in {steps:?}"
    );
    for (i, step) in steps.iter().enumerate().skip(terminal + 1) {
        assert!(
            matches!(step, Step::Ignored { .. }),
            "{row}: step {i} after the terminal is {step:?}"
        );
    }

    // (d) serial prompting, checked by an independent walk of the trace.
    let outs = walk_outstanding(assign, &d);

    // (e) the prompted labels are a prefix of the dirty windows in snapshot
    //     order, and the whole list when the request commits.
    let expected_order: Vec<String> = dirty_windows_in_snapshot_order(assign)
        .into_iter()
        .map(|i| format!("w{i}"))
        .collect();
    let prompted = d.prompted();
    assert!(
        expected_order.starts_with(&prompted),
        "{row}: prompted {prompted:?} is not a prefix of {expected_order:?}"
    );
    if committed {
        assert_eq!(
            prompted, expected_order,
            "{row}: a commit must prompt them all"
        );
    }
    if n == 3 && prompted.len() == 3 {
        k.prompted_three += 1;
    }

    // (f) nothing is prompted after the terminal.
    for (i, step) in steps.iter().enumerate() {
        if i > terminal {
            assert!(
                !matches!(step, Step::Prompt { .. }),
                "{row}: prompt after terminal"
            );
        }
    }

    // (h) (i) (j) (k): the per-kind positions.
    for q in 0..n {
        let label = format!("w{q}");
        match assign[q] {
            Kind::GoneWhileQueued => {
                k.gone_while_queued_rows[n] += 1;
                assert!(
                    !prompted.contains(&label),
                    "{row}: a window gone from the queue was prompted"
                );
            }
            Kind::GoneAfterClean => {
                for (i, rec) in d.trace.iter().enumerate() {
                    if rec.tag == Tag::Gone(q) && i < terminal {
                        assert!(
                            !is_terminal(&rec.step) && !matches!(rec.step, Step::Prompt { .. }),
                            "{row}: the gone of a clean window gave {:?}",
                            rec.step
                        );
                        if outs[i].0.is_some() {
                            k.gone_after_clean_while_prompted += 1;
                        }
                    }
                }
            }
            Kind::GoneAfterDirtyPhase1 => {
                k.gone_after_dirty_rows[n] += 1;
                assert!(
                    !prompted.contains(&label),
                    "{row}: the prompt w{q} was owed must be withdrawn"
                );
                for (i, rec) in d.trace.iter().enumerate() {
                    if rec.tag == Tag::Gone(q) && i < terminal {
                        assert_eq!(rec.step, Step::Wait, "{row}: w{q}'s gone is a plain wait");
                        let preceded_by_other_dirty = d.trace[..i].iter().any(|r| {
                            matches!(r.tag, Tag::Phase1(j) if j != q && !matches!(assign[j], Kind::Clean | Kind::GoneAfterClean))
                        });
                        if n == 3 && committed && preceded_by_other_dirty {
                            k.gone_after_dirty_c17_shape += 1;
                        }
                    }
                }
            }
            Kind::GoneAfterDiscard => {
                for (i, rec) in d.trace.iter().enumerate() {
                    if rec.tag == Tag::Gone(q) && i < terminal {
                        assert!(
                            !is_terminal(&rec.step) && !matches!(rec.step, Step::Prompt { .. }),
                            "{row}: the gone of a discarded window gave {:?}",
                            rec.step
                        );
                        assert_eq!(
                            outs[i].0, outs[i].1,
                            "{row}: w{q}'s gone moved the outstanding prompt"
                        );
                        if let Some(ids) = d.commit_ids() {
                            for id in ids_of(q) {
                                assert!(ids.contains(&id), "{row}: w{q}'s id {id} was dropped");
                            }
                        }
                        if q >= 1 && committed && outs[i].0.is_some() {
                            k.gone_after_discard_carried_ids += 1;
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

#[test]
fn p1_exhaustive_over_the_answer_domain() {
    let mut k = Counters::default();
    let skipped = for_each_row(|assign, order, tick_at, row| {
        check_row(assign, order, tick_at, row, &mut k);
    });

    // (g) plus the Rev 1 / Rev 2 non-vacuity counters.
    assert!(k.runs > 5_000, "the domain shrank: {} runs", k.runs);
    assert!(skipped > 0, "the realizability predicate filtered nothing");
    assert!(
        k.commits > 0 && k.aborts > 0 && k.fallbacks > 0,
        "{:?}",
        (k.commits, k.aborts, k.fallbacks)
    );
    assert!(k.prompted_three > 0, "no run ever prompted three windows");
    assert!(
        k.gone_while_queued_rows[2] > 0 && k.gone_while_queued_rows[3] > 0,
        "gone-while-queued never ran: {:?}",
        k.gone_while_queued_rows
    );
    assert!(
        k.gone_after_clean_while_prompted > 0,
        "no clean-then-gone landed while a prompt was outstanding"
    );
    assert!(
        k.gone_after_dirty_rows[2] > 0 && k.gone_after_dirty_rows[3] > 0,
        "dirty-then-gone-in-phase-1 never ran: {:?}",
        k.gone_after_dirty_rows
    );
    assert!(
        k.gone_after_dirty_c17_shape > 0,
        "no committing N=3 run had the C17 shape"
    );
    assert!(
        k.gone_after_discard_carried_ids > 0,
        "no discard-then-gone with real ids committed while another window was prompted"
    );
}
