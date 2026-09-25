//! ADR-0035 WI-3: laws R1-R6 over every re-check row.
//!
//! The rows come from `for_each_recheck_row`, the runs from `run_recheck`, and
//! the expectations from the independent oracle `expect`. R7-R12 and RT-4 are
//! in `coordinator_recheck_props_rel_tests.rs`.

use super::*;
use std::collections::BTreeSet;

/// The domain must not quietly shrink.
const MIN_ROWS: usize = 90_000;

fn label_count(labels: &[String], label: &str) -> usize {
    labels.iter().filter(|l| *l == label).count()
}

fn index_of(steps: &[Step], pred: impl Fn(&Step) -> bool) -> Vec<usize> {
    (0..steps.len()).filter(|i| pred(&steps[*i])).collect()
}

#[test]
fn r1_every_row_terminates_once_within_the_prompt_and_round_bounds() {
    let rows = for_each_recheck_row(|row| {
        let d = run_recheck(row, false).d;
        let steps = d.steps();
        let terminals = index_of(&steps, is_terminal);
        assert_eq!(terminals.len(), 1, "{}: {steps:?}", row.name);
        // Only a phase-1 row can see input after its terminal: the arrival
        // order keeps feeding acks after a fallback, and each is refused.
        let after = &steps[terminals[0] + 1..];
        let refused = after.iter().all(|s| matches!(s, Step::Ignored { .. }));
        assert!(
            refused,
            "{}: input acted on after the terminal: {steps:?}",
            row.name
        );
        if expect(row).is_some() {
            assert!(after.is_empty(), "{}: steps after the terminal", row.name);
        }
        let prompted = d.prompted();
        for label in &d.labels {
            assert!(
                label_count(&prompted, label) <= 2,
                "{}: {label} prompted more than twice: {prompted:?}",
                row.name
            );
        }
        let n = row.assign.len();
        assert!(
            rechecks(&steps) <= n + 1,
            "{}: {} re-checks for N={n}",
            row.name,
            rechecks(&steps)
        );
    });
    assert!(rows >= MIN_ROWS, "the domain shrank: {rows} rows");
}

#[test]
fn r2_a_commit_with_a_live_window_follows_recheck_then_backstop() {
    let mut checked = 0usize;
    for_each_recheck_row(|row| {
        let Some(x) = expect(row) else { return };
        if x.end != End::Commit || x.backstop.is_none() {
            return;
        }
        checked += 1;
        let d = run_recheck(row, false).d;
        let steps = d.steps();
        let recheck = index_of(&steps, |s| matches!(s, Step::Recheck { .. }));
        let backstop = index_of(&steps, |s| matches!(s, Step::Backstop { .. }));
        let prompt = index_of(&steps, |s| matches!(s, Step::Prompt { .. }));
        let commit = index_of(&steps, |s| matches!(s, Step::Commit { .. }));
        let name = &row.name;
        assert_eq!(backstop.len(), 1, "{name}: one backstop: {steps:?}");
        assert_eq!(commit.len(), 1, "{name}: one commit: {steps:?}");
        let last_recheck = *recheck.last().expect("no Recheck before the commit");
        assert!(
            last_recheck < backstop[0] && backstop[0] < commit[0],
            "{name}: {steps:?}"
        );
        if let Some(last_prompt) = prompt.last() {
            assert!(
                *last_prompt < last_recheck,
                "{name}: a prompt after the last re-check"
            );
        }
        let (_, tally) = commit_of(&d).expect("committed");
        assert!(
            tally.is_some(),
            "{name}: the commit carries no backstop tally"
        );
    });
    assert!(checked > 0, "no committing row with a live window");
}

#[test]
fn r3_a_dirty_window_with_an_unset_bit_is_prompted_in_that_round() {
    let mut checked = 0usize;
    for_each_recheck_row(|row| {
        let Some(x) = expect(row) else { return };
        let d = run_recheck(row, false).d;
        let steps = d.steps();
        let recheck = index_of(&steps, |s| matches!(s, Step::Recheck { .. }));
        for (i, round) in x.prompt_round.iter().enumerate() {
            let Some(k) = round else { continue };
            checked += 1;
            let from = recheck[k - 1];
            let to = recheck.get(*k).copied().unwrap_or(steps.len());
            let label = &d.labels[i];
            let hit = steps[from..to]
                .iter()
                .any(|s| matches!(s, Step::Prompt { label: l, .. } if l == label));
            assert!(
                hit,
                "{}: {label} not prompted in round {k}: {steps:?}",
                row.name
            );
        }
    });
    assert!(checked > 0, "no row prompted at a re-check");
}

#[test]
fn r4_edited_every_round_is_capped_after_two_prompts_and_still_commits() {
    let mut checked = 0usize;
    for_each_recheck_row(|row| {
        let every = row
            .re
            .iter()
            .enumerate()
            .filter(|(i, r)| live_after_phase2(row.assign[*i]) && **r == Re::EditedEveryRound)
            .count();
        let blocked = row.re.iter().enumerate().any(|(i, r)| {
            live_after_phase2(row.assign[i])
                && matches!(r, Re::EditedOnce(Then::Cancel) | Re::RecheckTimeout)
        });
        if every == 0 || blocked || !expected_commit(&row.assign) {
            return;
        }
        checked += 1;
        let d = run_recheck(row, false).d;
        let (_, tally) =
            commit_of(&d).unwrap_or_else(|| panic!("{}: no commit: {:?}", row.name, d.steps()));
        let tally = tally.expect("a live window means a backstop ran");
        assert_eq!(
            tally.capped, every as u32,
            "{}: capped must count the EditedEveryRound windows",
            row.name
        );
        let prompted = d.prompted();
        for (i, r) in row.re.iter().enumerate() {
            if *r == Re::EditedEveryRound {
                let c = label_count(&prompted, &d.labels[i]);
                assert!(c <= 2, "{}: w{i} prompted {c} times", row.name);
            }
        }
    });
    assert!(checked > 0, "no EditedEveryRound row");
}

#[test]
fn r5_the_commit_ids_are_the_union_of_every_discard_fed() {
    let mut checked = 0usize;
    for_each_recheck_row(|row| {
        let Some(x) = expect(row) else { return };
        if x.end != End::Commit {
            return;
        }
        checked += 1;
        let d = run_recheck(row, false).d;
        let mut fed = BTreeSet::new();
        for input in &d.inputs {
            if let Input::Answer {
                answer: Answer::Discard(ids),
                ..
            } = input
            {
                fed.extend(ids.iter().cloned());
            }
        }
        let (ids, _) =
            commit_of(&d).unwrap_or_else(|| panic!("{}: no commit: {:?}", row.name, d.steps()));
        let got: BTreeSet<String> = ids.iter().cloned().collect();
        assert_eq!(got, fed, "{}: commit ids vs discards fed", row.name);
        assert_eq!(ids.len(), fed.len(), "{}: duplicate ids {ids:?}", row.name);
        assert_eq!(got, x.ids, "{}: commit ids vs the oracle", row.name);
    });
    assert!(checked > 0, "no committing row");
}

#[test]
fn r6_a_window_gone_before_its_recheck_never_times_out() {
    let mut checked = 0usize;
    for_each_recheck_row(|row| {
        if !row.re.contains(&Re::GoneBeforeRecheck) || !expected_commit(&row.assign) {
            return;
        }
        checked += 1;
        let d = run_recheck(row, false).d;
        let mut gone: Vec<String> = Vec::new();
        for rec in &d.trace {
            if let Tag::Gone(i) = rec.tag {
                gone.push(d.labels[i].clone());
            }
            if let Step::NativeFallback { timed_out } = &rec.step {
                for label in &gone {
                    assert!(
                        !timed_out.contains(label),
                        "{}: gone {label} reported as timed out",
                        row.name
                    );
                }
            }
        }
    });
    assert!(checked > 0, "no GoneBeforeRecheck row");
}

/// R6, widened: over every row, a window gone at any point before a fallback
/// (phase 1, phase 2 or its re-check) is never among its `timed_out`. This is
/// the case that sees a round resetting `Gone` to `Pending`.
#[test]
fn r6_no_window_gone_earlier_is_ever_reported_timed_out() {
    let mut fallbacks = 0usize;
    for_each_recheck_row(|row| {
        let d = run_recheck(row, false).d;
        let mut gone: Vec<&String> = Vec::new();
        for rec in &d.trace {
            if let Tag::Gone(i) = rec.tag {
                gone.push(&d.labels[i]);
            }
            if let Step::NativeFallback { timed_out } = &rec.step {
                fallbacks += 1;
                let bad: Vec<_> = gone.iter().filter(|l| timed_out.contains(l)).collect();
                assert!(bad.is_empty(), "{}: gone {bad:?} timed out", row.name);
            }
        }
    });
    assert!(fallbacks > 0, "no row fell back");
}
