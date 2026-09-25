//! ADR-0035 WI-3: laws R7-R12 and RT-4 over every re-check row.
//!
//! R8 is metamorphic (a row against its transform) and R9 compares a run with
//! stale-round junk against the same run without it. R12's reachability is
//! computed from the row, never from the observed steps (matrix revision 3).

use super::*;

fn prompts_of(d: &Runner, i: usize) -> usize {
    let label = &d.labels[i];
    prompted_after_phase1(d)
        .iter()
        .filter(|l| *l == label)
        .count()
}

fn is_live(row: &Row, i: usize) -> bool {
    live_after_phase2(row.assign[i])
}

#[test]
fn r7_backstop_deadline_commits_and_recheck_deadline_falls_back() {
    let (mut misses, mut timeouts) = (0usize, 0usize);
    for_each_recheck_row(|row| {
        let Some(x) = expect(row) else { return };
        let d = run_recheck(row, false).d;
        let steps = d.steps();
        let last = steps.last().expect("a run has steps");
        if row.bk == Bk::OneMisses && x.backstop.is_some() {
            misses += 1;
            let (_, tally) = commit_of(&d).unwrap_or_else(|| panic!("{}: {steps:?}", row.name));
            assert_eq!(tally.map(|t| t.missing), Some(1), "{}", row.name);
            let fallback = steps
                .iter()
                .any(|s| matches!(s, Step::NativeFallback { .. }));
            assert!(!fallback, "{}: a backstop miss fell back", row.name);
        }
        for i in (0..d.labels.len()).filter(|i| is_live(row, *i)) {
            if row.re[i] == Re::RecheckTimeout {
                timeouts += 1;
                let Step::NativeFallback { timed_out } = last else {
                    panic!("{}: a silent re-check ended in {last:?}", row.name)
                };
                assert!(timed_out.contains(&d.labels[i]), "{}", row.name);
            }
        }
    });
    assert!(
        misses > 0 && timeouts > 0,
        "{misses} misses, {timeouts} timeouts"
    );
}

#[test]
fn r8_one_edited_once_cancel_turns_a_commit_into_an_abort() {
    let mut pairs = 0usize;
    for_each_recheck_row(|row| {
        if expect(row).map(|x| x.end) != Some(End::Commit) {
            return;
        }
        for i in (0..row.assign.len()).filter(|i| is_live(row, *i)) {
            if row.re[i] == Re::EditedOnce(Then::Cancel) {
                continue;
            }
            pairs += 1;
            let mut t = row.clone();
            t.re[i] = Re::EditedOnce(Then::Cancel);
            t.name = format!("{} with w{i}:=EditedOnce(Cancel)", row.name);
            let d = run_recheck(&t, false).d;
            let last = d.steps().last().cloned();
            let want = Step::Abort {
                reason: AbortReason::Cancelled {
                    by: d.labels[i].clone(),
                },
            };
            assert_eq!(last, Some(want), "{}", t.name);
        }
    });
    assert!(pairs > 0, "no committing row to transform");
}

#[test]
fn r9_stale_round_junk_is_inert_throughout() {
    let mut junk = 0usize;
    for_each_recheck_row(|row| {
        let plain = run_recheck(row, false).d.steps();
        let r = run_recheck(row, true);
        for (step, unchanged) in &r.junk {
            let want = Step::Ignored {
                why: IgnoredWhy::StaleRound,
            };
            assert_eq!(step, &want, "{}", row.name);
            assert!(
                unchanged,
                "{}: a stale-round reply changed the state",
                row.name
            );
        }
        junk += r.junk.len();
        assert_eq!(r.d.steps(), plain, "{}: junk changed the trace", row.name);
    });
    assert!(junk > 0, "no junk was fed");
}

#[test]
fn r10_saved_meanwhile_is_prompted_once_more_and_never_capped() {
    let mut checked = 0usize;
    for_each_recheck_row(|row| {
        let Some(x) = expect(row) else { return };
        let saved = Re::EditedOnce(Then::SavedMeanwhile);
        let blocked = (0..row.assign.len()).any(|i| {
            is_live(row, i)
                && matches!(row.re[i], Re::EditedOnce(Then::Cancel) | Re::RecheckTimeout)
        });
        if blocked
            || !row
                .re
                .iter()
                .enumerate()
                .any(|(i, r)| is_live(row, i) && *r == saved)
        {
            return;
        }
        checked += 1;
        let d = run_recheck(row, false).d;
        let (_, tally) = commit_of(&d).unwrap_or_else(|| panic!("{}: no commit", row.name));
        for i in (0..row.assign.len()).filter(|i| row.re[*i] == saved) {
            assert_eq!(prompts_of(&d, i), 1, "{}: w{i}", row.name);
        }
        let every = row
            .re
            .iter()
            .filter(|r| **r == Re::EditedEveryRound)
            .count();
        assert_eq!(tally.map(|t| t.capped), Some(every as u32), "{}", row.name);
        assert_eq!(tally, x.backstop, "{}", row.name);
    });
    assert!(checked > 0, "no SavedMeanwhile row");
}

#[test]
fn r11_the_backstop_tally_matches_the_oracle() {
    let mut checked = 0usize;
    for_each_recheck_row(|row| {
        let Some(x) = expect(row) else { return };
        let Some(want) = x.backstop.filter(|_| x.end == End::Commit) else {
            return;
        };
        checked += 1;
        let d = run_recheck(row, false).d;
        let (_, tally) = commit_of(&d).unwrap_or_else(|| panic!("{}: no commit", row.name));
        let tally = tally.unwrap_or_else(|| panic!("{}: no tally", row.name));
        match row.bk {
            Bk::AllAck => assert_eq!((tally.missing, tally.failed), (0, 0), "{}", row.name),
            Bk::OneMisses => assert_eq!(tally.missing, 1, "{}", row.name),
            Bk::OneFails => assert_eq!(tally.failed, 2, "{}", row.name),
        }
        assert_eq!(tally, want, "{}", row.name);
    });
    assert!(checked > 0, "no row reached the backstop");
}

/// R12(i): another live window is prompted in round 1, and round 1 is not cut
/// short by a cancel or a silent window.
fn late_next_round_reachable(row: &Row, i: usize) -> bool {
    let live = |j: usize| is_live(row, j);
    let other = (0..row.re.len()).any(|j| {
        j != i && live(j) && matches!(row.re[j], Re::EditedOnce(_) | Re::EditedEveryRound)
    });
    let blocked = (0..row.re.len())
        .any(|j| live(j) && matches!(row.re[j], Re::EditedOnce(Then::Cancel) | Re::RecheckTimeout));
    other && !blocked
}

#[test]
fn r12_edited_late_is_prompted_iff_a_next_round_is_reachable() {
    let (mut reached, mut unreached) = (0usize, 0usize);
    for_each_recheck_row(|row| {
        for i in (0..row.re.len()).filter(|i| is_live(row, *i) && row.re[*i] == Re::EditedLate(1)) {
            let d = run_recheck(row, false).d;
            let commit = commit_of(&d);
            let late = format!("w{i}-late");
            let has_late = commit.as_ref().map(|(ids, _)| ids.contains(&late));
            if late_next_round_reachable(row, i) {
                reached += 1;
                assert_eq!(prompts_of(&d, i), 1, "{}: w{i} reachable", row.name);
                assert_eq!(has_late, Some(true), "{}", row.name);
            } else {
                unreached += 1;
                assert_eq!(prompts_of(&d, i), 0, "{}: w{i} unreachable", row.name);
                if let Some((_, tally)) = &commit {
                    assert_eq!(has_late, Some(false), "{}", row.name);
                    assert_eq!(rechecks(&d.steps()), 1, "{}", row.name);
                    let every = row
                        .re
                        .iter()
                        .filter(|r| **r == Re::EditedEveryRound)
                        .count();
                    assert_eq!(tally.map(|t| t.capped), Some(every as u32), "{}", row.name);
                }
            }
        }
    });
    assert!(
        reached > 0 && unreached > 0,
        "{reached} reached, {unreached} not"
    );
}

#[test]
fn r12_the_chain_row_reaches_exactly_n_plus_one_rechecks() {
    let row = chain_row();
    let d = run_recheck(&row, false).d;
    let steps = d.steps();
    assert_eq!(rechecks(&steps), 4, "{steps:?}");
    for label in &d.labels {
        assert_eq!(
            d.prompted().iter().filter(|l| *l == label).count(),
            1,
            "{label}"
        );
    }
    let (mut ids, tally) = commit_of(&d).unwrap_or_else(|| panic!("no commit: {steps:?}"));
    ids.sort();
    assert_eq!(ids, ["w0-r", "w1-late", "w2-late"]);
    assert_eq!(tally.map(|t| t.capped), Some(0));
    assert!(matches!(steps.last(), Some(Step::Commit { .. })));
}

#[test]
fn rt4_round_rises_by_one_exactly_at_each_recheck() {
    for_each_recheck_row(|row| {
        let d = run_recheck(row, false).d;
        let series = round_series(&d);
        let mut prev = Some(0u32);
        for (rec, now) in d.trace.iter().zip(&series) {
            let Some(now) = now else {
                assert!(
                    is_terminal(&rec.step),
                    "{}: request gone at {:?}",
                    row.name,
                    rec.step
                );
                continue;
            };
            let was = prev.expect("the request never comes back");
            match rec.step {
                Step::Recheck { .. } => assert_eq!(*now, was + 1, "{}", row.name),
                _ => assert_eq!(*now, was, "{}: at {:?}", row.name, rec.step),
            }
            prev = Some(*now);
        }
        let last_live = series.iter().rev().flatten().next().copied().unwrap_or(0);
        assert_eq!(last_live as usize, rechecks(&d.steps()), "{}", row.name);
    });
}
