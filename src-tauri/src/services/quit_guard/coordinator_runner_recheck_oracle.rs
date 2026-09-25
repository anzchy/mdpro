//! ADR-0035 WI-3: the re-check and backstop domain, and its independent oracle.
//!
//! A row is the WI-2 phase-1 row (`for_each_row`) extended by two axes: how
//! each window live after phase 2 answers the re-check rounds (`Re`), and how
//! the live windows answer the draft backstop (`Bk`). `expect` is written from
//! ADR-0035's law — every live window is asked again after each round that
//! prompted, a window is re-prompted at most once, the backstop precedes the
//! commit — and calls nothing inside the coordinator. It extends the WI-2
//! oracle (`expected_commit`, `expected_ids`) by composition, never by edit.
//!
//! Domain budget (plan WI-3): the full cross product for N in 1..=2; for N=3
//! the re-check axis is `AXIS_N3`, over committing phase-1 rows only. A phase-1
//! row that does not commit never reaches a re-check, so it runs once, with
//! the placeholder axes. A window gone before the re-check has no re-check
//! behaviour, so it keeps the placeholder too (the realizable predicate).

use super::*;
use std::collections::BTreeSet;

/// What a window re-prompted by a re-check does with its dialog.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in super::super) enum Then {
    Discard,
    Cancel,
    SavedMeanwhile,
}

/// One live window's part in the re-check rounds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in super::super) enum Re {
    StaysClean,
    /// Dirty at the first re-check, then clean for good.
    EditedOnce(Then),
    /// Clean for this many re-checks, dirty at the next, then clean; when
    /// prompted it discards `w{i}-late`. The domain uses a delay of 1; the
    /// R12(ii) chain row also uses 2.
    EditedLate(usize),
    /// Dirty at every re-check; its one re-prompt discards `w{i}-r`.
    EditedEveryRound,
    /// Never answers the first re-check.
    RecheckTimeout,
    /// Destroyed at its turn in the first re-check, instead of answering.
    GoneBeforeRecheck,
}

/// How the live windows answer the draft backstop.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in super::super) enum Bk {
    /// Every live window sends `Drafted { 1, 0 }`.
    AllAck,
    /// The first live window never answers; the backstop deadline is ticked.
    OneMisses,
    /// The first live window sends `Drafted { 1, 2 }`.
    OneFails,
}

pub(in super::super) const AXIS_FULL: [Re; 8] = [
    Re::StaysClean,
    Re::EditedOnce(Then::Discard),
    Re::EditedOnce(Then::Cancel),
    Re::EditedOnce(Then::SavedMeanwhile),
    Re::EditedLate(1),
    Re::EditedEveryRound,
    Re::RecheckTimeout,
    Re::GoneBeforeRecheck,
];

pub(in super::super) const AXIS_N3: [Re; 4] = [
    Re::StaysClean,
    Re::EditedOnce(Then::Discard),
    Re::EditedLate(1),
    Re::EditedEveryRound,
];

pub(in super::super) const BACKSTOPS: [Bk; 3] = [Bk::AllAck, Bk::OneMisses, Bk::OneFails];

#[derive(Clone, Debug)]
pub(in super::super) struct Row {
    pub assign: Vec<Kind>,
    pub order: Vec<usize>,
    pub tick_at: Option<usize>,
    pub re: Vec<Re>,
    pub bk: Bk,
    pub name: String,
}

/// The kinds whose window is still live when phase 2 has drained.
pub(in super::super) fn live_after_phase2(k: Kind) -> bool {
    matches!(k, Kind::Clean | Kind::Discard | Kind::SavedMeanwhile)
}

/// Whether a window with behaviour `re` answers `dirty` at re-check `k`
/// (1-based). Defines the environment, so the runner and the oracle share it.
pub(in super::super) fn dirty_at(re: Re, k: usize) -> bool {
    match re {
        Re::StaysClean => false,
        Re::EditedOnce(_) => k == 1,
        Re::EditedLate(delay) => k == delay + 1,
        Re::EditedEveryRound => true,
        Re::RecheckTimeout | Re::GoneBeforeRecheck => {
            panic!("{re:?} sends no ack at re-check {k}")
        }
    }
}

/// The ids a re-check-induced prompt of `w{i}` discards, if any.
pub(in super::super) fn recheck_ids(re: Re, i: usize) -> Option<Vec<String>> {
    match re {
        Re::EditedOnce(Then::Discard) | Re::EditedEveryRound => Some(vec![format!("w{i}-r")]),
        Re::EditedLate(_) => Some(vec![format!("w{i}-late")]),
        _ => None,
    }
}

fn combos(axis: &[Re], len: usize) -> Vec<Vec<Re>> {
    let mut out = vec![vec![]];
    for _ in 0..len {
        out = out
            .iter()
            .flat_map(|p| {
                axis.iter().map(move |r| {
                    let mut q = p.clone();
                    q.push(*r);
                    q
                })
            })
            .collect();
    }
    out
}

/// Every re-check row. Returns how many rows it visited.
pub(in super::super) fn for_each_recheck_row(mut f: impl FnMut(&Row)) -> usize {
    let mut rows = 0usize;
    for_each_row(|assign, order, tick_at, name| {
        let n = assign.len();
        let mut emit = |re: Vec<Re>, bk: Bk| {
            rows += 1;
            f(&Row {
                assign: assign.to_vec(),
                order: order.to_vec(),
                tick_at,
                name: format!("{name} re={re:?} bk={bk:?}"),
                re,
                bk,
            });
        };
        if !expected_commit(assign) {
            if n < 3 {
                emit(vec![Re::StaysClean; n], Bk::AllAck);
            }
            return;
        }
        let axis: &[Re] = if n == 3 { &AXIS_N3 } else { &AXIS_FULL };
        let live: Vec<usize> = (0..n).filter(|i| live_after_phase2(assign[*i])).collect();
        let backstops: &[Bk] = if live.is_empty() {
            &[Bk::AllAck]
        } else {
            &BACKSTOPS
        };
        for combo in combos(axis, live.len()) {
            let mut re = vec![Re::StaysClean; n];
            for (slot, i) in live.iter().enumerate() {
                re[*i] = combo[slot];
            }
            for bk in backstops {
                emit(re.clone(), *bk);
            }
        }
    });
    rows
}

/// R12(ii): three windows clean in phase 1; `w{k}` is first dirty at round
/// k+1, so the request needs exactly N+1 = 4 re-checks.
pub(in super::super) fn chain_row() -> Row {
    let re = vec![
        Re::EditedOnce(Then::Discard),
        Re::EditedLate(1),
        Re::EditedLate(2),
    ];
    Row {
        assign: vec![Kind::Clean; 3],
        order: vec![0, 1, 2],
        tick_at: None,
        name: format!("chain re={re:?}"),
        re,
        bk: Bk::AllAck,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in super::super) enum End {
    Commit,
    Cancelled(usize),
    Fallback,
}

/// What ADR-0035 says a row whose phase 1 and 2 commit must do next.
#[derive(Clone, Debug)]
pub(in super::super) struct Expect {
    pub end: End,
    pub rechecks: usize,
    /// Prompts each window receives after phase 1.
    pub recheck_prompts: Vec<usize>,
    /// The round each window's re-check-induced prompt belongs to.
    pub prompt_round: Vec<Option<usize>>,
    pub ids: BTreeSet<String>,
    /// `Some` exactly when a backstop runs; `capped` counts windows.
    pub backstop: Option<BackstopTally>,
}

/// The oracle. `None` when the row stops in phase 1 or 2.
pub(in super::super) fn expect(row: &Row) -> Option<Expect> {
    if !expected_commit(&row.assign) {
        return None;
    }
    let n = row.assign.len();
    let mut live: Vec<bool> = row.assign.iter().map(|k| live_after_phase2(*k)).collect();
    let mut bit = vec![false; n];
    let mut capped = vec![false; n];
    let mut x = Expect {
        end: End::Commit,
        rechecks: 0,
        recheck_prompts: vec![0; n],
        prompt_round: vec![None; n],
        ids: expected_ids(&row.assign),
        backstop: None,
    };
    // A round is due at open and after every round that prompted.
    while live.contains(&true) {
        x.rechecks += 1;
        let k = x.rechecks;
        let mut queue = Vec::new();
        let mut silent = false;
        for i in 0..n {
            if !live[i] {
                continue;
            }
            match row.re[i] {
                Re::GoneBeforeRecheck => live[i] = false,
                Re::RecheckTimeout => silent = true,
                re if dirty_at(re, k) && bit[i] => capped[i] = true,
                re if dirty_at(re, k) => {
                    bit[i] = true;
                    queue.push(i);
                }
                _ => {}
            }
        }
        if silent {
            x.end = End::Fallback;
            return Some(x);
        }
        for q in &queue {
            x.recheck_prompts[*q] += 1;
            x.prompt_round[*q] = Some(k);
            if row.re[*q] == Re::EditedOnce(Then::Cancel) {
                x.end = End::Cancelled(*q);
                return Some(x);
            }
            x.ids
                .extend(recheck_ids(row.re[*q], *q).unwrap_or_default());
        }
        if queue.is_empty() {
            break;
        }
    }
    let drafting = live.iter().filter(|l| **l).count() as u32;
    if drafting > 0 {
        let missing = u32::from(row.bk == Bk::OneMisses);
        x.backstop = Some(BackstopTally {
            drafted: drafting - missing,
            failed: if row.bk == Bk::OneFails { 2 } else { 0 },
            missing,
            capped: capped.iter().filter(|c| **c).count() as u32,
            // ADR-0035 review M-1: compile-only — the tally gained an `undiscarded` count; no redraft here.
            undiscarded: 0,
        });
    }
    Some(x)
}
