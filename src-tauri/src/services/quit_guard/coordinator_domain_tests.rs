//! The enumerated domain, the independent oracle and the replay driver shared
//! by the WI-2 property cases (P1 in `coordinator_props_tests.rs`, P2-P5 in
//! `coordinator_props_rel_tests.rs`).
//!
//! The oracle is written here from the matrix's law, and calls nothing inside
//! the coordinator. Enumerating the domain exhaustively is what replaces a
//! proptest dependency, which would need its own ADR.

use super::*;
use std::collections::BTreeSet;

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
    Answer { idx: usize, answer: Answer },
    StaleAnswer { idx: usize, answer: Answer },
    ForeignAnswer(Answer),
    Gone(usize),
    ForeignGone,
    Tick(u64),
    Fallback(FallbackAnswer),
}

/// What the input was for, so an assertion can find it in the trace.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Tag {
    Phase1(usize),
    Phase2(usize),
    Gone(usize),
    Tick,
    Junk,
}

#[derive(Clone, Debug)]
pub(super) struct Rec {
    pub tag: Tag,
    pub step: Step,
}

pub(super) fn is_terminal(step: &Step) -> bool {
    matches!(
        step,
        Step::Commit { .. } | Step::Abort { .. } | Step::NativeFallback { .. }
    )
}

pub(super) struct Runner {
    pub c: QuitCoordinator,
    pub id: u64,
    pub labels: Vec<String>,
    pub trace: Vec<Rec>,
    pub inputs: Vec<Input>,
    pub row: String,
    outstanding: Option<usize>,
    last_answer: Option<(usize, Answer)>,
}

impl Runner {
    pub fn new(n: usize, row: &str) -> Self {
        let labels: Vec<String> = (0..n).map(|i| format!("w{i}")).collect();
        let mut c = QuitCoordinator::new();
        let id = match c.begin(&labels, 0) {
            Begin::Later { request_id } => request_id,
            other => panic!("{row}: begin gave {other:?}"),
        };
        Self {
            c,
            id,
            labels,
            trace: Vec::new(),
            inputs: Vec::new(),
            row: row.to_string(),
            outstanding: None,
            last_answer: None,
        }
    }

    pub fn outstanding(&self) -> Option<usize> {
        self.outstanding
    }

    pub fn clear_outstanding(&mut self) {
        self.outstanding = None;
    }

    pub fn last_answer(&self) -> Option<(usize, Answer)> {
        self.last_answer.clone()
    }

    pub fn feed(&mut self, tag: Tag, input: Input) -> Step {
        let step = match &input {
            Input::Answer { idx, answer } => {
                self.last_answer = Some((*idx, answer.clone()));
                self.c
                    .on_answer(self.id, &self.labels[*idx], answer.clone(), 1)
            }
            Input::StaleAnswer { idx, answer } => self.c.on_answer(
                self.id.wrapping_sub(1),
                &self.labels[*idx],
                answer.clone(),
                1,
            ),
            Input::ForeignAnswer(answer) => self.c.on_answer(self.id, "zz", answer.clone(), 1),
            Input::Gone(idx) => self.c.on_window_gone(&self.labels[*idx]),
            Input::ForeignGone => self.c.on_window_gone("zz"),
            Input::Tick(now) => self.c.on_tick(*now),
            Input::Fallback(answer) => self.c.on_fallback_answer(self.id, *answer),
        };
        if let Step::Prompt(label) = &step {
            self.outstanding = Some(
                self.labels
                    .iter()
                    .position(|l| l == label)
                    .unwrap_or_else(|| panic!("{}: prompt for unknown label {label}", self.row)),
            );
        }
        self.trace.push(Rec {
            tag,
            step: step.clone(),
        });
        self.inputs.push(input);
        step
    }

    pub fn steps(&self) -> Vec<Step> {
        self.trace.iter().map(|r| r.step.clone()).collect()
    }

    pub fn terminal_index(&self) -> usize {
        self.trace
            .iter()
            .position(|r| is_terminal(&r.step))
            .unwrap_or_else(|| panic!("{}: no terminal step in {:?}", self.row, self.steps()))
    }

    /// The labels prompted over the whole run, in order.
    pub fn prompted(&self) -> Vec<String> {
        self.trace
            .iter()
            .filter_map(|r| match &r.step {
                Step::Prompt(l) => Some(l.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn commit_ids(&self) -> Option<Vec<String>> {
        self.trace.iter().find_map(|r| match &r.step {
            Step::Commit {
                discard_document_ids,
            } => Some(discard_document_ids.clone()),
            _ => None,
        })
    }
}

/// Drive one `(assign, order, tick position)` row to its end, then feed three
/// junk inputs. The loop is written from the matrix, not from the
/// implementation: it only reacts to `Prompt`.
pub(super) fn run(assign: &[Kind], order: &[usize], tick_at: Option<usize>, row: &str) -> Runner {
    let n = assign.len();
    let mut d = Runner::new(n, row);

    // Phase 1, in the permuted arrival order.
    for pos in 0..=order.len() {
        if tick_at == Some(pos) {
            d.feed(Tag::Tick, Input::Tick(T));
        }
        if pos == order.len() {
            break;
        }
        let i = order[pos];
        match assign[i] {
            Kind::Clean | Kind::GoneAfterClean => {
                d.feed(
                    Tag::Phase1(i),
                    Input::Answer {
                        idx: i,
                        answer: Answer::Clean,
                    },
                );
                if assign[i] == Kind::GoneAfterClean {
                    d.feed(Tag::Gone(i), Input::Gone(i));
                }
            }
            Kind::GonePhase1 => {
                d.feed(Tag::Gone(i), Input::Gone(i));
            }
            Kind::Timeout => unreachable!("a timing-out window sends no phase-1 input"),
            _ => {
                d.feed(
                    Tag::Phase1(i),
                    Input::Answer {
                        idx: i,
                        answer: Answer::Dirty,
                    },
                );
                if assign[i] == Kind::GoneAfterDirtyPhase1 {
                    d.feed(Tag::Gone(i), Input::Gone(i));
                }
            }
        }
    }

    // Phase 2: answer whichever window is prompted, one at a time.
    let mut first_prompt = true;
    let mut guard = 0;
    while let Some(l) = d.outstanding() {
        guard += 1;
        assert!(guard <= 3 * n + 5, "{row}: prompt loop does not terminate");
        if first_prompt {
            first_prompt = false;
            for (q, kind) in assign.iter().enumerate() {
                if *kind == Kind::GoneWhileQueued {
                    d.feed(Tag::Gone(q), Input::Gone(q));
                }
            }
            if d.outstanding() != Some(l) {
                continue;
            }
        }
        d.clear_outstanding();
        match assign[l] {
            Kind::Discard | Kind::GoneAfterDiscard => {
                d.feed(
                    Tag::Phase2(l),
                    Input::Answer {
                        idx: l,
                        answer: Answer::Discard(ids_of(l)),
                    },
                );
                if assign[l] == Kind::GoneAfterDiscard {
                    d.feed(Tag::Gone(l), Input::Gone(l));
                }
            }
            Kind::Cancel => {
                d.feed(
                    Tag::Phase2(l),
                    Input::Answer {
                        idx: l,
                        answer: Answer::Cancel,
                    },
                );
            }
            Kind::SavedMeanwhile => {
                d.feed(
                    Tag::Phase2(l),
                    Input::Answer {
                        idx: l,
                        answer: Answer::Clean,
                    },
                );
            }
            Kind::GoneWhilePrompted => {
                d.feed(Tag::Gone(l), Input::Gone(l));
            }
            other => panic!("{row}: window w{l} was prompted but its kind is {other:?}"),
        }
    }

    // Junk: a replay of the last answer, a tick an hour later, and a gone.
    if let Some((idx, answer)) = d.last_answer() {
        d.feed(Tag::Junk, Input::Answer { idx, answer });
    }
    d.feed(Tag::Junk, Input::Tick(3_600_000));
    d.feed(Tag::Junk, Input::Gone(0));
    d
}

/// Feed a recorded input sequence to a fresh coordinator, optionally inserting
/// one junk input at `at`. Used by WI2-P4 to show that ignored inputs are inert.
pub(super) fn replay(
    n: usize,
    inputs: &[Input],
    junk: Option<(usize, Input)>,
    row: &str,
) -> (Runner, Option<Step>) {
    let mut d = Runner::new(n, row);
    let mut junk_step = None;
    for pos in 0..=inputs.len() {
        if let Some((at, input)) = &junk {
            if *at == pos {
                junk_step = Some(d.feed(Tag::Junk, input.clone()));
            }
        }
        if pos == inputs.len() {
            break;
        }
        let tag = match &inputs[pos] {
            Input::Answer { idx, .. } => Tag::Phase1(*idx),
            Input::Gone(idx) => Tag::Gone(*idx),
            _ => Tag::Junk,
        };
        d.feed(tag, inputs[pos].clone());
    }
    (d, junk_step)
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
