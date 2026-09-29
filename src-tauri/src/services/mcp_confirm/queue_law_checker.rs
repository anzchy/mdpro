//! The invariant checker for the `PendingTable` laws (matrix Q-12, Q-13 and
//! law 5). It keeps its own model of issued, live, resolved and withdrawn
//! ids, replays effects into `displayed`, and panics with the op trace and
//! step index on the first violation.

use std::collections::{HashMap, HashSet};

use super::law_fixtures::{Op, Step, WINDOWS};
use super::*;

pub(super) struct Checker<'a> {
    ops: &'a [Op],
    step: usize,
    enqueued: usize,
    owner: HashMap<RequestId, (&'static str, u32)>,
    live: HashSet<RequestId>,
    resolved: HashSet<RequestId>,
    withdrawn: HashSet<RequestId>,
    displayed: HashMap<&'static str, RequestId>,
    ever_displayed: HashSet<RequestId>,
    terminals: HashMap<RequestId, u32>,
    last_shown: HashMap<&'static str, u32>,
    closed: bool,
}

impl<'a> Checker<'a> {
    pub(super) fn new(ops: &'a [Op]) -> Self {
        Self {
            ops,
            step: 0,
            enqueued: 0,
            owner: HashMap::new(),
            live: HashSet::new(),
            resolved: HashSet::new(),
            withdrawn: HashSet::new(),
            displayed: HashMap::new(),
            ever_displayed: HashSet::new(),
            terminals: HashMap::new(),
            last_shown: HashMap::new(),
            closed: false,
        }
    }

    fn ensure(&self, ok: bool, what: &str) {
        assert!(
            ok,
            "law violated at step {} of {:?}: {what}",
            self.step, self.ops
        );
    }

    fn is_terminal(&self, id: &str) -> bool {
        self.resolved.contains(id) || self.withdrawn.contains(id)
    }

    pub(super) fn step(&mut self, i: usize, s: &Step, table: &PendingTable<()>) {
        self.step = i;
        let named = s.op.target().and(s.id.clone());
        // Q-12 (v): an op naming a terminal id has no effects.
        if let Some(id) = &named {
            if self.is_terminal(id) {
                self.ensure(s.effects.is_empty(), "op on a terminal id had effects");
            }
        }
        let displayed_before = self.displayed.clone();
        let was_displayed = |id: &str| displayed_before.values().any(|d| d == id);
        let live_before = named.as_ref().is_some_and(|id| self.live.contains(id));

        if let (Op::Enq(w), Some(id)) = (s.op, &s.id) {
            self.enqueued += 1;
            self.owner.insert(id.clone(), (w, self.enqueued as u32 - 1));
            if self.closed {
                // law 5: closed is absorbing
                let expected = vec![Effect::Resolve {
                    id: id.clone(),
                    outcome: Outcome::Cancelled(Cause::AppExit),
                }];
                self.ensure(
                    s.effects == expected,
                    "enqueue after close must resolve at once",
                );
            }
            self.live.insert(id.clone());
        }
        if s.op == Op::Close {
            self.closed = true;
        }

        for fx in &s.effects {
            match fx {
                Effect::Show { window, id } => {
                    let (w, ord) = self.owner_of(id);
                    self.ensure(w == window, "Show in a window that does not own the id");
                    self.ensure(
                        !self.displayed.contains_key(w),
                        "Show while one is displayed",
                    );
                    self.ensure(self.live.contains(id), "Show of a non-pending id");
                    let prev = self.last_shown.get(w).copied();
                    self.ensure(prev.is_none_or(|p| ord > p), "shown ids not in FIFO order");
                    self.last_shown.insert(w, ord);
                    self.displayed.insert(w, id.clone());
                    self.ever_displayed.insert(id.clone());
                }
                Effect::Resolve { id, outcome } => {
                    self.ensure(!self.resolved.contains(id), "id resolved twice");
                    self.ensure(!self.withdrawn.contains(id), "withdrawn id resolved");
                    self.ensure(self.live.contains(id), "Resolve of a non-pending id");
                    let (w, _) = self.owner_of(id);
                    let named_here = named.as_deref() == Some(id.as_str());
                    let ok = match (*outcome, s.op) {
                        (Outcome::Approved, Op::Reply(_, from, true))
                        | (Outcome::Rejected, Op::Reply(_, from, false)) => {
                            named_here && from == w && was_displayed(id)
                        }
                        (Outcome::Approved | Outcome::Rejected, _) => false,
                        (Outcome::TimedOut, op) => named_here && matches!(op, Op::Expire(_)),
                        (Outcome::Cancelled(Cause::EmitFailed), op) => {
                            named_here && matches!(op, Op::FailShow(_)) && was_displayed(id)
                        }
                        (Outcome::Cancelled(Cause::WindowClosed), op) => op == Op::CancelWindow(w),
                        (Outcome::Cancelled(Cause::ServerStop), op) => op == Op::CancelAll,
                        (Outcome::Cancelled(Cause::AppExit), op) => {
                            op == Op::Close || (matches!(op, Op::Enq(_)) && self.closed)
                        }
                    };
                    self.ensure(ok, "Resolve outcome not caused by this op");
                    self.end(w, id);
                    self.resolved.insert(id.clone());
                }
                Effect::Dismiss { window, id } => {
                    let (w, _) = self.owner_of(id);
                    self.ensure(w == window, "Dismiss in a window that does not own the id");
                    let ok = matches!(s.op, Op::Withdraw(_))
                        && named.as_deref() == Some(id.as_str())
                        && displayed_before.get(w) == Some(id);
                    self.ensure(ok, "Dismiss without a Withdraw of the displayed id");
                    self.end(w, id);
                    self.withdrawn.insert(id.clone());
                }
            }
        }
        // A withdraw of a pending, non-displayed id ends it silently.
        if let (Op::Withdraw(_), Some(id)) = (s.op, &named) {
            if live_before && self.live.remove(id) {
                self.withdrawn.insert(id.clone());
            }
        }
        // Scope of the cancels: nothing pending remains in scope.
        let in_scope = |id: &RequestId| match s.op {
            Op::CancelWindow(w) => self.owner.get(id).is_some_and(|&(ow, _)| ow == w),
            Op::CancelAll | Op::Close => true,
            Op::Enq(_) | Op::Reply(..) | Op::Expire(_) | Op::Withdraw(_) | Op::FailShow(_) => false,
        };
        self.ensure(
            !self.live.iter().any(in_scope),
            "a cancel left a request pending",
        );
        self.check_state(table);
    }

    fn owner_of(&self, id: &str) -> (&'static str, u32) {
        let found = self.owner.get(id).copied();
        self.ensure(found.is_some(), "effect names an id never issued");
        found.unwrap_or(("?", u32::MAX))
    }

    fn end(&mut self, w: &'static str, id: &RequestId) {
        if self.displayed.get(w) == Some(id) {
            self.displayed.remove(w);
        }
        self.live.remove(id);
        *self.terminals.entry(id.clone()).or_insert(0) += 1;
    }

    fn check_state(&self, table: &PendingTable<()>) {
        // Q-12 (i) conservation
        let accounted = self.resolved.len() + self.withdrawn.len() + table.pending_len();
        self.ensure(
            self.enqueued == accounted,
            "enqueued != resolved + withdrawn + pending",
        );
        self.ensure(
            table.pending_len() == self.live.len(),
            "pending_len disagrees with model",
        );
        // Q-12 (iii)
        self.ensure(
            self.resolved.is_disjoint(&self.withdrawn),
            "resolved ∩ withdrawn ≠ ∅",
        );
        // Q-13 (iii): the displayed id is the window's oldest pending
        for w in WINDOWS {
            let oldest = self
                .live
                .iter()
                .filter_map(|id| self.owner.get(id).map(|&(ow, ord)| (ow, ord, id)))
                .filter(|&(ow, _, _)| ow == w)
                .min_by_key(|&(_, ord, _)| ord)
                .map(|(_, _, id)| id.clone());
            self.ensure(
                self.displayed.get(w).cloned() == oldest,
                "displayed is not the oldest",
            );
            self.ensure(
                table.shown(w) == oldest,
                "shown() disagrees with the effects",
            );
        }
    }

    /// Q-13 (v): every displayed id got exactly one terminal effect,
    /// counting ids still pending as zero.
    pub(super) fn finish(&self) {
        for id in &self.ever_displayed {
            let n = self.terminals.get(id).copied().unwrap_or(0);
            let expected = u32::from(!self.live.contains(id));
            self.ensure(
                n == expected,
                "a displayed id did not get exactly one end signal",
            );
        }
    }
}
