//! Hand-enumerated op sequences for the `PendingTable` laws (matrix Q-12 …
//! Q-14), the executor that runs them, and the window-B projection.
//! The invariant checker lives in `queue_law_checker.rs`.

use super::law_checker::Checker;
use super::tests::seq_ids;
use super::*;

/// The harness issues at most this many requests per run.
pub(super) const MAX_REQUESTS: u32 = 3;

pub(super) const WINDOWS: [&str; 2] = ["A", "B"];

/// One harness op. `u32` arguments are the ordinal of the enqueued request
/// (`r{k}` with the sequential id source); an ordinal not yet issued
/// exercises the unknown-id path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Op {
    Enq(&'static str),
    Reply(u32, &'static str, bool),
    Expire(u32),
    Withdraw(u32),
    FailShow(u32),
    CancelWindow(&'static str),
    CancelAll,
    Close,
}

impl Op {
    /// The ordinal an id-naming op refers to.
    pub(super) fn target(self) -> Option<u32> {
        match self {
            Op::Reply(k, _, _) | Op::Expire(k) | Op::Withdraw(k) | Op::FailShow(k) => Some(k),
            Op::Enq(_) | Op::CancelWindow(_) | Op::CancelAll | Op::Close => None,
        }
    }

    fn with_target(self, k: u32) -> Op {
        match self {
            Op::Reply(_, from, approved) => Op::Reply(k, from, approved),
            Op::Expire(_) => Op::Expire(k),
            Op::Withdraw(_) => Op::Withdraw(k),
            Op::FailShow(_) => Op::FailShow(k),
            Op::Enq(_) | Op::CancelWindow(_) | Op::CancelAll | Op::Close => self,
        }
    }
}

/// Σ: the full 27-op alphabet.
pub(super) fn sigma() -> Vec<Op> {
    let mut ops = vec![Op::Enq("A"), Op::Enq("B")];
    for k in 0..MAX_REQUESTS {
        for from in WINDOWS {
            for approved in [true, false] {
                ops.push(Op::Reply(k, from, approved));
            }
        }
    }
    for k in 0..MAX_REQUESTS {
        ops.extend([Op::Expire(k), Op::Withdraw(k), Op::FailShow(k)]);
    }
    ops.extend([
        Op::CancelWindow("A"),
        Op::CancelWindow("B"),
        Op::CancelAll,
        Op::Close,
    ]);
    ops
}

/// Σ′: the reduced alphabet for lengths 5 and 6.
pub(super) fn sigma_reduced() -> Vec<Op> {
    vec![
        Op::Enq("A"),
        Op::Enq("B"),
        Op::Reply(0, "A", true),
        Op::Reply(1, "A", false),
        Op::Reply(2, "B", true),
        Op::Expire(1),
        Op::Withdraw(0),
        Op::CancelWindow("A"),
    ]
}

/// Calls `f` on every sequence over `alphabet` of exactly `len` ops and
/// returns how many there were.
pub(super) fn for_each_sequence(alphabet: &[Op], len: usize, f: &mut dyn FnMut(&[Op])) -> usize {
    let mut idx = vec![0usize; len];
    let mut seq: Vec<Op> = Vec::with_capacity(len);
    let mut count = 0;
    loop {
        seq.clear();
        seq.extend(idx.iter().map(|&i| alphabet[i]));
        f(&seq);
        count += 1;
        // odometer increment; done when every digit wraps
        let mut pos = 0;
        loop {
            if pos == len {
                return count;
            }
            idx[pos] += 1;
            if idx[pos] < alphabet.len() {
                break;
            }
            idx[pos] = 0;
            pos += 1;
        }
    }
}

/// The Q-12 enumeration: Σ at lengths 0..=4, then Σ′ at lengths 5..=6.
/// Returns the two counts.
pub(super) fn enumerate_all(f: &mut dyn FnMut(&[Op])) -> (usize, usize) {
    let full = sigma();
    let reduced = sigma_reduced();
    let short: usize = (0..=4).map(|n| for_each_sequence(&full, n, f)).sum();
    let long: usize = (5..=6).map(|n| for_each_sequence(&reduced, n, f)).sum();
    (short, long)
}

/// One executed step with its concrete id (for Enq: the id issued; `None`
/// when the cap skipped it).
#[derive(Debug, Clone)]
pub(super) struct Step {
    pub op: Op,
    pub id: Option<RequestId>,
    pub effects: Vec<Effect>,
}

/// Runs `ops` on a fresh table, checking every law after every step.
pub(super) fn run_checked(ops: &[Op]) -> Vec<Step> {
    let mut table: PendingTable<()> = PendingTable::new(seq_ids());
    let mut checker = Checker::new(ops);
    let mut issued = 0u32;
    let mut steps = Vec::with_capacity(ops.len());
    for (i, &op) in ops.iter().enumerate() {
        let (id, effects) = match op {
            Op::Enq(_) if issued >= MAX_REQUESTS => (None, Vec::new()),
            Op::Enq(w) => {
                issued += 1;
                let (id, fx) = table.enqueue(w, ());
                (Some(id), fx)
            }
            Op::Reply(k, from, approved) => {
                let id = format!("r{k}");
                let (_, fx) = table.reply(&id, from, approved);
                (Some(id), fx)
            }
            Op::Expire(k) => (Some(format!("r{k}")), table.expire(&format!("r{k}"))),
            Op::Withdraw(k) => (Some(format!("r{k}")), table.withdraw(&format!("r{k}"))),
            Op::FailShow(k) => (Some(format!("r{k}")), table.fail_show(&format!("r{k}"))),
            Op::CancelWindow(w) => (None, table.cancel_window(w)),
            Op::CancelAll => (None, table.cancel_all(Cause::ServerStop)),
            Op::Close => (None, table.close(Cause::AppExit)),
        };
        let step = Step { op, id, effects };
        checker.step(i, &step, &table);
        steps.push(step);
    }
    checker.finish();
    steps
}

/// Projects an executed trace onto window B's ops, renaming B's ids to
/// their ordinal within B (the ids a fresh run issues).
pub(super) fn project_to_b(steps: &[Step]) -> Vec<Op> {
    let mut b_ords: HashMap<RequestId, u32> = HashMap::new();
    let mut out = Vec::new();
    for s in steps {
        match s.op {
            Op::Enq("B") => {
                if let Some(id) = &s.id {
                    let ord = b_ords.len() as u32;
                    b_ords.insert(id.clone(), ord);
                    out.push(s.op);
                }
            }
            Op::CancelWindow("B") | Op::CancelAll | Op::Close => out.push(s.op),
            op => {
                let renamed = s.id.as_ref().and_then(|id| b_ords.get(id));
                if let (Some(_), Some(&ord)) = (op.target(), renamed) {
                    out.push(op.with_target(ord));
                }
            }
        }
    }
    out
}

/// B's effects with ids renamed `b{ordinal within B}`.
pub(super) fn b_effects(steps: &[Step]) -> Vec<Effect> {
    let mut b_ords: HashMap<RequestId, usize> = HashMap::new();
    for s in steps {
        if let (Op::Enq("B"), Some(id)) = (s.op, &s.id) {
            let ord = b_ords.len();
            b_ords.insert(id.clone(), ord);
        }
    }
    let rename = |id: &RequestId| b_ords.get(id).map(|o| format!("b{o}"));
    let mut out = Vec::new();
    for fx in steps.iter().flat_map(|s| s.effects.iter()) {
        let mapped = match fx {
            Effect::Show { window, id } => rename(id).map(|id| Effect::Show {
                window: window.clone(),
                id,
            }),
            Effect::Dismiss { window, id } => rename(id).map(|id| Effect::Dismiss {
                window: window.clone(),
                id,
            }),
            Effect::Resolve { id, outcome } => rename(id).map(|id| Effect::Resolve {
                id,
                outcome: *outcome,
            }),
        };
        out.extend(mapped);
    }
    out
}
