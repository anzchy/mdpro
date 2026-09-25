//! The replay `Runner`, `run` and `replay`, split out of `coordinator_domain_tests.rs` and registered from it.
//!
//! The enumerated domain, the independent oracle and the replay driver shared
//! by the WI-2 property cases (P1 in `coordinator_props_tests.rs`, P2-P5 in
//! `coordinator_props_rel_tests.rs`).
//!
//! The oracle is written here from the matrix's law, and calls nothing inside
//! the coordinator. Enumerating the domain exhaustively is what replaces a
//! proptest dependency, which would need its own ADR.

use super::*;

pub(in super::super) fn is_terminal(step: &Step) -> bool {
    matches!(
        step,
        Step::Commit { .. } | Step::Abort { .. } | Step::NativeFallback { .. }
    )
}

pub(in super::super) struct Runner {
    pub c: QuitCoordinator,
    pub id: u64,
    pub labels: Vec<String>,
    pub trace: Vec<Rec>,
    pub inputs: Vec<Input>,
    pub row: String,
    outstanding: Option<usize>,
    last_answer: Option<(usize, Answer)>,
    gone: Vec<bool>,
    recheck_open: bool,
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
            gone: vec![false; n],
            recheck_open: false,
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

    /// Whether an ADR-0035 re-check round is open and still unanswered.
    pub fn recheck_open(&self) -> bool {
        self.recheck_open
    }

    /// The windows the runner has not fed a gone for, in snapshot order.
    pub fn live(&self) -> Vec<usize> {
        (0..self.labels.len()).filter(|i| !self.gone[*i]).collect()
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
            Input::Gone(idx) => {
                self.gone[*idx] = true;
                self.c.on_window_gone(&self.labels[*idx], 1)
            }
            Input::ForeignGone => self.c.on_window_gone("zz", 1),
            Input::Tick(now) => self.c.on_tick(*now),
            Input::Fallback(answer) => self.c.on_fallback_answer(self.id, *answer),
        };
        match &step {
            Step::Recheck { .. } => self.recheck_open = true,
            s if is_terminal(s) || matches!(s, Step::Backstop { .. }) => self.recheck_open = false,
            _ => {}
        }
        if let Step::Prompt { label, .. } = &step {
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
                Step::Prompt { label, .. } => Some(label.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn commit_ids(&self) -> Option<Vec<String>> {
        self.trace.iter().find_map(|r| match &r.step {
            Step::Commit {
                discard_document_ids,
                ..
            } => Some(discard_document_ids.clone()),
            _ => None,
        })
    }
}

/// Drive one `(assign, order, tick position)` row to its end, then feed three
/// junk inputs. The loop is written from the matrix, not from the
/// implementation: it only reacts to `Prompt`. Phase 2 answers each prompt
/// directly; `run_with` adds the delivery-ack axis (WI-11).
pub(in super::super) fn run(
    assign: &[Kind],
    order: &[usize],
    tick_at: Option<usize>,
    row: &str,
) -> Runner {
    super::run_with(assign, order, tick_at, super::Delivery::Direct, row)
}

/// Phase 1, in the permuted arrival order, with the single tick at `tick_at`.
pub(in super::super) fn phase1(
    d: &mut Runner,
    assign: &[Kind],
    order: &[usize],
    tick_at: Option<usize>,
) {
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
}

/// Phase 2's decision for the prompted window `l`, as its kind dictates.
pub(in super::super) fn decide(d: &mut Runner, assign: &[Kind], l: usize) {
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
        other => panic!(
            "{}: window w{l} was prompted but its kind is {other:?}",
            d.row
        ),
    }
}

/// Junk: a replay of the last answer, a tick an hour later, and a gone.
pub(in super::super) fn junk(d: &mut Runner) {
    if let Some((idx, answer)) = d.last_answer() {
        d.feed(Tag::Junk, Input::Answer { idx, answer });
    }
    d.feed(Tag::Junk, Input::Tick(3_600_000));
    d.feed(Tag::Junk, Input::Gone(0));
}

/// Feed a recorded input sequence to a fresh coordinator, optionally inserting
/// one junk input at `at`. Used by WI2-P4 to show that ignored inputs are inert.
pub(in super::super) fn replay(
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
