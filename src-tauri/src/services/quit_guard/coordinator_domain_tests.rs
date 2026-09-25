//! The enumerated domain, the independent oracle and the replay driver shared
//! by the WI-2 property cases (P1 in `coordinator_props_tests.rs`, P2-P5 in
//! `coordinator_props_rel_tests.rs`).
//!
//! The oracle is written here from the matrix's law, and calls nothing inside
//! the coordinator. Enumerating the domain exhaustively is what replaces a
//! proptest dependency, which would need its own ADR.

use super::*;
use std::collections::BTreeSet;

#[path = "coordinator_runner.rs"]
mod coordinator_runner;
pub(super) use coordinator_runner::{is_terminal, replay, run, Runner};

// WI-5: the input dispatch, split out when `Input::Escape` was added.
#[path = "coordinator_runner_feed.rs"]
mod coordinator_runner_feed;
pub(super) use coordinator_runner_feed::dispatch;

#[path = "coordinator_runner_phase2.rs"]
mod coordinator_runner_phase2;
pub(super) use coordinator_runner_phase2::{for_each_phase2_row, run_with, Delivery};

#[path = "coordinator_phase2_props_tests.rs"]
mod coordinator_phase2_props_tests;

// ADR-0035 WI-3: the re-check and backstop domain, runner and laws.
#[path = "coordinator_runner_recheck_oracle.rs"]
mod coordinator_runner_recheck_oracle;
pub(super) use coordinator_runner_recheck_oracle::*;

#[path = "coordinator_runner_recheck.rs"]
mod coordinator_runner_recheck;
pub(super) use coordinator_runner_recheck::*;

#[path = "coordinator_recheck_props_tests.rs"]
mod coordinator_recheck_props_tests;

#[path = "coordinator_recheck_props_rel_tests.rs"]
mod coordinator_recheck_props_rel_tests;

// WI-5 (ADR-0030): the escape laws, injected over all three domains above.
#[path = "coordinator_escape_props_fixtures.rs"]
mod coordinator_escape_props_fixtures;

#[path = "coordinator_escape_props_tests.rs"]
mod coordinator_escape_props_tests;

#[path = "coordinator_escape_props_rel_tests.rs"]
mod coordinator_escape_props_rel_tests;

pub(super) const T: u64 = QUIT_ACK_TIMEOUT_MS;

/// One window's whole part in a run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Kind {
    Clean,
    Discard,
    Cancel,
    Timeout,
    SavedMeanwhile,
    GonePhase1,
    GoneWhilePrompted,
    GoneWhileQueued,
    GoneAfterClean,
    GoneAfterDirtyPhase1,
    GoneAfterDiscard,
}

pub(super) const ALL_KINDS: [Kind; 11] = [
    Kind::Clean,
    Kind::Discard,
    Kind::Cancel,
    Kind::Timeout,
    Kind::SavedMeanwhile,
    Kind::GonePhase1,
    Kind::GoneWhilePrompted,
    Kind::GoneWhileQueued,
    Kind::GoneAfterClean,
    Kind::GoneAfterDirtyPhase1,
    Kind::GoneAfterDiscard,
];

/// COMMITTING: every kind but the two that stop the quit.
pub(super) fn is_committing(k: Kind) -> bool {
    !matches!(k, Kind::Cancel | Kind::Timeout)
}

/// PROMPTED: the kinds that actually receive a `Prompt`.
pub(super) fn is_prompted(k: Kind) -> bool {
    matches!(
        k,
        Kind::Discard
            | Kind::Cancel
            | Kind::SavedMeanwhile
            | Kind::GoneWhilePrompted
            | Kind::GoneAfterDiscard
    )
}

/// DISCARDING: the kinds whose ids must reach the commit.
pub(super) fn is_discarding(k: Kind) -> bool {
    matches!(k, Kind::Discard | Kind::GoneAfterDiscard)
}

pub(super) fn sends_phase1(k: Kind) -> bool {
    k != Kind::Timeout
}

/// Window 0 discards an empty list, so an implementation that drops a window
/// with no ids still has to commit correctly.
pub(super) fn ids_of(i: usize) -> Vec<String> {
    if i == 0 {
        vec![]
    } else {
        vec![format!("w{i}-a"), format!("w{i}-b")]
    }
}

pub(super) fn expected_commit(assign: &[Kind]) -> bool {
    assign.iter().all(|k| is_committing(*k))
}

pub(super) fn expected_ids(assign: &[Kind]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for (i, k) in assign.iter().enumerate() {
        if is_discarding(*k) {
            out.extend(ids_of(i));
        }
    }
    out
}

pub(super) fn dirty_windows_in_snapshot_order(assign: &[Kind]) -> Vec<usize> {
    (0..assign.len())
        .filter(|i| is_prompted(assign[*i]))
        .collect()
}

/// Two kinds need a particular shape before they can occur at all. Rows that
/// fail this are skipped by this explicit predicate, and counted.
pub(super) fn realizable(assign: &[Kind], order: &[usize]) -> bool {
    for i in 0..assign.len() {
        if assign[i] == Kind::GoneWhileQueued && !(0..i).any(|j| is_prompted(assign[j])) {
            return false;
        }
    }
    let has_timeout = assign.contains(&Kind::Timeout);
    if !has_timeout {
        if let Some(last) = order.last() {
            if assign[*last] == Kind::GoneAfterDirtyPhase1 {
                return false;
            }
        }
    }
    true
}

/// One input to the coordinator, recorded so a run can be replayed verbatim.
#[derive(Clone, Debug)]
pub(super) enum Input {
    Answer {
        idx: usize,
        answer: Answer,
    },
    StaleAnswer {
        idx: usize,
        answer: Answer,
    },
    ForeignAnswer(Answer),
    Gone(usize),
    ForeignGone,
    Tick(u64),
    Fallback(FallbackAnswer),
    /// "Stop Waiting and Quit…" (ADR-0030, WI-5). Never part of a canonical
    /// run: only the escape laws inject it, so no existing row count moves.
    Escape,
}

/// What the input was for, so an assertion can find it in the trace.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Tag {
    Phase1(usize),
    Phase2(usize),
    Gone(usize),
    Tick,
    Junk,
    /// The prompted window's delivery ack (`Answer::Delivered`).
    Delivered(usize),
    /// A tick at the prompted window's delivery deadline, with no ack sent.
    DeliveryTick(usize),
    /// A tick after the window's ack, at the deadline and far past it.
    LateTick(usize),
    /// A live window's answer to an ADR-0035 re-check round.
    Recheck(usize),
    /// A live window's `Drafted` answer to the ADR-0035 backstop round.
    Backstop(usize),
    /// An injected `Input::Escape` (WI-5).
    Escape,
}

#[derive(Clone, Debug)]
pub(super) struct Rec {
    pub tag: Tag,
    pub step: Step,
}

pub(super) fn permutations(items: &[usize]) -> Vec<Vec<usize>> {
    if items.is_empty() {
        return vec![vec![]];
    }
    let mut out = Vec::new();
    for (i, head) in items.iter().enumerate() {
        let mut rest = items.to_vec();
        rest.remove(i);
        for mut tail in permutations(&rest) {
            tail.insert(0, *head);
            out.push(tail);
        }
    }
    out
}

pub(super) fn assignments(n: usize) -> Vec<Vec<Kind>> {
    let mut out = vec![vec![]];
    for _ in 0..n {
        let mut next = Vec::new();
        for prefix in &out {
            for k in ALL_KINDS {
                let mut row = prefix.clone();
                row.push(k);
                next.push(row);
            }
        }
        out = next;
    }
    out
}

/// Every realizable `(assign, order, tick position)` row for N in 1..=3.
/// Returns the number of rows the `realizable` predicate skipped.
pub(super) fn for_each_row(mut f: impl FnMut(&[Kind], &[usize], Option<usize>, &str)) -> usize {
    let mut skipped = 0usize;
    for n in 1..=3usize {
        for assign in assignments(n) {
            let senders: Vec<usize> = (0..n).filter(|i| sends_phase1(assign[*i])).collect();
            let has_timeout = assign.contains(&Kind::Timeout);
            for order in permutations(&senders) {
                if !realizable(&assign, &order) {
                    skipped += 1;
                    continue;
                }
                if has_timeout {
                    for tick_at in 0..=order.len() {
                        let row = format!("n={n} assign={assign:?} order={order:?} tick@{tick_at}");
                        f(&assign, &order, Some(tick_at), &row);
                    }
                } else {
                    let row = format!("n={n} assign={assign:?} order={order:?} tick=none");
                    f(&assign, &order, None, &row);
                }
            }
        }
    }
    skipped
}
