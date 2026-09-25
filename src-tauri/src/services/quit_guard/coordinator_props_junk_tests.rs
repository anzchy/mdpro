//! WI2-P4 and P5, split out of `coordinator_props_rel_tests.rs` and registered from it.
//!
//! WI2-P2 .. WI2-P5: the relations between runs.
//!
//! P2 permutation invariance and the "gone after any answer" metamorphic
//! pairing, P3 monotonicity toward cancel/timeout, P4 inserted junk is inert,
//! P5 nothing after a terminal produces a second terminal.

use super::*;

/// ADR-0035 (migration M1): the last answer fed before input `k` in the same
/// round. An answer from before a `Recheck` is not junk when replayed after
/// it - the round asks every window again, so the replay is a fresh answer.
fn previous_in_round(canonical: &Runner, k: usize) -> Option<Input> {
    let round_start = canonical.trace[..k]
        .iter()
        .rposition(|r| matches!(r.step, Step::Recheck { .. }))
        .map_or(0, |at| at + 1);
    canonical.inputs[round_start..k]
        .iter()
        .rev()
        .find(|i| matches!(i, Input::Answer { .. }))
        .cloned()
}

// --- WI2-P4: an inserted ignored input is inert -----------------------------

#[test]
fn p4_inserted_junk_inputs_are_inert() {
    let mut rows = 0usize;
    let mut no_unprompted_window = 0usize;
    for assign in assignments(2) {
        let order = senders_of(&assign);
        if !realizable(&assign, &order) {
            continue;
        }
        for tick_at in tick_positions(&assign, &order) {
            let row = format!("assign={assign:?} tick={tick_at:?}");
            let canonical = run(&assign, &order, tick_at, &row);
            let inputs = canonical.inputs.clone();
            let want: Vec<Step> = canonical
                .steps()
                .into_iter()
                .filter(|s| !matches!(s, Step::Ignored { .. }))
                .collect();

            for k in 0..=inputs.len() {
                let mut junks = vec![
                    Input::StaleAnswer {
                        idx: 0,
                        answer: Answer::Clean,
                    },
                    Input::ForeignAnswer(Answer::Clean),
                    Input::ForeignGone,
                ];
                // ADR-0035 changes the spec: commit is now preceded by a re-check round.
                if let Some(previous) = previous_in_round(&canonical, k) {
                    junks.push(previous);
                }
                match (0..2).find(|i| !is_prompted(assign[*i])) {
                    Some(idx) => junks.push(Input::Answer {
                        idx,
                        answer: Answer::Discard(vec!["junk".to_string()]),
                    }),
                    None => no_unprompted_window += 1,
                }

                for junk in junks {
                    let row = format!("{row} junk={junk:?}@{k}");
                    let (d, step) = replay(2, &inputs, Some((k, junk)), &row);
                    assert!(
                        matches!(step, Some(Step::Ignored { .. })),
                        "{row}: junk gave {step:?}"
                    );
                    let got: Vec<Step> = d
                        .steps()
                        .into_iter()
                        .filter(|s| !matches!(s, Step::Ignored { .. }))
                        .collect();
                    assert_eq!(got, want, "{row}: junk changed the trace");
                    if let Some(ids) = d.commit_ids() {
                        assert!(
                            !ids.contains(&"junk".to_string()),
                            "{row}: junk id committed"
                        );
                    }
                    rows += 1;
                }
            }
        }
    }
    assert!(rows > 1_000, "only {rows} junk insertions ran");
    assert!(
        no_unprompted_window > 0,
        "the wrong-phase junk was always available; its skip rule never ran"
    );
}

// --- WI2-P5: nothing after a terminal produces a second terminal ------------

#[test]
fn p5_inputs_after_the_terminal_are_all_ignored_and_the_machine_goes_idle() {
    let mut checked = 0usize;
    for assign in assignments(2) {
        let order = senders_of(&assign);
        if !realizable(&assign, &order) {
            continue;
        }
        for tick_at in tick_positions(&assign, &order) {
            let row = format!("assign={assign:?} tick={tick_at:?}");
            let mut d = run(&assign, &order, tick_at, &row);
            let fallback_owns = matches!(
                d.trace[d.terminal_index()].step,
                Step::NativeFallback { .. }
            );
            let id = d.id;

            for idx in 0..2usize {
                for answer in [
                    Answer::Clean,
                    Answer::Dirty,
                    Answer::Discard(vec!["late".to_string()]),
                    Answer::Cancel,
                ] {
                    let step = d.feed(Tag::Junk, Input::Answer { idx, answer });
                    assert!(matches!(step, Step::Ignored { .. }), "{row}: {step:?}");
                }
                let step = d.feed(Tag::Junk, Input::Gone(idx));
                assert!(matches!(step, Step::Ignored { .. }), "{row}: gone {step:?}");
            }
            let step = d.feed(Tag::Junk, Input::Tick(9_000_000));
            assert!(matches!(step, Step::Ignored { .. }), "{row}: tick {step:?}");

            if fallback_owns {
                assert_eq!(
                    d.c.begin(&["w0", "w1"], 100_000),
                    Begin::AlreadyPending,
                    "{row}: the alert still owns the request"
                );
                assert_eq!(
                    d.feed(Tag::Junk, Input::Fallback(FallbackAnswer::KeepOpen)),
                    Step::Abort {
                        reason: AbortReason::UserKeptOpen
                    },
                    "{row}: only the alert resolves the request"
                );
            }
            match d.c.begin(&["w0", "w1"], 200_000) {
                Begin::Later { request_id } => assert!(request_id > id, "{row}: id did not grow"),
                other => panic!("{row}: the coordinator is stuck: {other:?}"),
            }
            checked += 1;
        }
    }
    assert!(checked > 100, "only {checked} post-terminal rows ran");
}
