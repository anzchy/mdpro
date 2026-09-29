//! The pending MCP write confirmations (ADR-0042 decisions 3 and 4), as a
//! pure state machine: no Tauri, no tokio, no clock.
//!
//! Each window has a FIFO of pending requests; only its oldest is shown.
//! Every operation returns the [`Effect`]s the caller must carry out, in
//! order. A shown request ends with exactly one of `Resolve` or `Dismiss`;
//! a queued, never-shown request ends with a `Resolve` (or silently, when
//! withdrawn). Operations naming an id that is no longer pending are no-ops.

use std::collections::{HashMap, VecDeque};

/// Opaque request id. Production ids are uuid v4 (issued by the broker's
/// id source); tests inject a sequential source.
pub type RequestId = String;

/// Supplies a fresh id for each enqueued request. Ids must be unique for
/// the table's lifetime (uuid v4 in production).
pub trait IdSource: Send {
    fn next_id(&mut self) -> RequestId;
}

impl<F: FnMut() -> RequestId + Send> IdSource for F {
    fn next_id(&mut self) -> RequestId {
        self()
    }
}

/// Why a request was cancelled rather than answered or timed out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cause {
    ServerStop,
    AppExit,
    WindowClosed,
    EmitFailed,
}

/// How a request ended, as delivered to its waiter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Approved,
    Rejected,
    TimedOut,
    Cancelled(Cause),
}

/// What the caller must do after an operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// Display `id` in `window`.
    Show { window: String, id: RequestId },
    /// `id` ended with `outcome`; deliver it to the waiter.
    Resolve { id: RequestId, outcome: Outcome },
    /// The displayed `id` was withdrawn; no waiter remains.
    Dismiss { window: String, id: RequestId },
}

/// The verdict on a reply from a window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplyVerdict {
    Resolved,
    IgnoredUnknown,
    IgnoredWrongWindow,
    IgnoredNotShown,
}

/// One pending request.
struct Entry<M> {
    window: String,
    /// Global enqueue order, so cross-window cancels resolve oldest first.
    seq: u64,
    meta: M,
}

/// The pending-request table. `M` is the caller's per-request metadata.
pub struct PendingTable<M> {
    ids: Box<dyn IdSource>,
    entries: HashMap<RequestId, Entry<M>>,
    /// FIFO per window; the front is the shown request. Never empty.
    queues: HashMap<String, VecDeque<RequestId>>,
    next_seq: u64,
    /// Set once by `close`; every later enqueue resolves with this cause.
    closed: Option<Cause>,
}

impl<M> PendingTable<M> {
    pub fn new(ids: impl IdSource + 'static) -> Self {
        Self {
            ids: Box::new(ids),
            entries: HashMap::new(),
            queues: HashMap::new(),
            next_seq: 0,
            closed: None,
        }
    }

    /// Add a request for `window`. Shows it iff the window had nothing
    /// pending. After `close`, resolves at once as `Cancelled(cause)`.
    pub fn enqueue(&mut self, window: &str, meta: M) -> (RequestId, Vec<Effect>) {
        let id = self.ids.next_id();
        if let Some(cause) = self.closed {
            let fx = vec![resolve(&id, Outcome::Cancelled(cause))];
            return (id, fx);
        }
        let seq = self.next_seq;
        self.next_seq += 1;
        let entry = Entry {
            window: window.to_string(),
            seq,
            meta,
        };
        self.entries.insert(id.clone(), entry);
        let queue = self.queues.entry(window.to_string()).or_default();
        queue.push_back(id.clone());
        let fx = if queue.len() == 1 {
            vec![show(window, &id)]
        } else {
            Vec::new()
        };
        (id, fx)
    }

    /// A window's answer. Accepted only for a pending id, from the window
    /// that owns it, while it is the shown request.
    pub fn reply(&mut self, id: &str, caller: &str, approved: bool) -> (ReplyVerdict, Vec<Effect>) {
        let Some(entry) = self.entries.get(id) else {
            return (ReplyVerdict::IgnoredUnknown, Vec::new());
        };
        if entry.window != caller {
            return (ReplyVerdict::IgnoredWrongWindow, Vec::new());
        }
        if !self.is_shown(id) {
            return (ReplyVerdict::IgnoredNotShown, Vec::new());
        }
        let outcome = if approved {
            Outcome::Approved
        } else {
            Outcome::Rejected
        };
        (ReplyVerdict::Resolved, self.end(id, outcome))
    }

    /// The request's deadline passed (shown or still queued).
    pub fn expire(&mut self, id: &str) -> Vec<Effect> {
        self.end(id, Outcome::TimedOut)
    }

    /// The waiter went away. Ends the request without an outcome; a shown
    /// request is dismissed, a queued one leaves silently.
    pub fn withdraw(&mut self, id: &str) -> Vec<Effect> {
        match self.remove(id) {
            Some((window, true)) => {
                let mut fx = vec![Effect::Dismiss {
                    window: window.clone(),
                    id: id.to_string(),
                }];
                fx.extend(self.show_head(&window));
                fx
            }
            Some((_, false)) | None => Vec::new(),
        }
    }

    /// Showing `id` failed. Only the shown request can have failed to show;
    /// anything else is a no-op.
    pub fn fail_show(&mut self, id: &str) -> Vec<Effect> {
        if !self.is_shown(id) {
            return Vec::new();
        }
        self.end(id, Outcome::Cancelled(Cause::EmitFailed))
    }

    /// The window is gone: cancel all of its requests, in enqueue order.
    /// Other windows are untouched.
    pub fn cancel_window(&mut self, window: &str) -> Vec<Effect> {
        let queue = self.queues.remove(window).unwrap_or_default();
        let cancelled = Outcome::Cancelled(Cause::WindowClosed);
        queue
            .into_iter()
            .filter(|id| self.entries.remove(id).is_some())
            .map(|id| resolve(&id, cancelled))
            .collect()
    }

    /// Cancel every pending request, oldest first. The table stays open.
    pub fn cancel_all(&mut self, cause: Cause) -> Vec<Effect> {
        let mut all: Vec<(u64, RequestId)> = self
            .entries
            .drain()
            .map(|(id, entry)| (entry.seq, id))
            .collect();
        self.queues.clear();
        all.sort_unstable();
        all.into_iter()
            .map(|(_, id)| resolve(&id, Outcome::Cancelled(cause)))
            .collect()
    }

    /// Cancel everything and refuse all later requests with `cause`.
    /// Idempotent: the first cause sticks.
    pub fn close(&mut self, cause: Cause) -> Vec<Effect> {
        if self.closed.is_some() {
            return Vec::new();
        }
        self.closed = Some(cause);
        self.cancel_all(cause)
    }

    pub fn pending_len(&self) -> usize {
        self.entries.len()
    }

    /// The request currently shown in `window`, if any.
    pub fn shown(&self, window: &str) -> Option<RequestId> {
        self.queues.get(window).and_then(|q| q.front()).cloned()
    }

    /// The metadata of a pending request.
    pub fn meta(&self, id: &str) -> Option<&M> {
        self.entries.get(id).map(|e| &e.meta)
    }

    pub fn is_closed(&self) -> bool {
        self.closed.is_some()
    }

    fn is_shown(&self, id: &str) -> bool {
        self.entries
            .get(id)
            .and_then(|e| self.queues.get(&e.window))
            .and_then(|q| q.front())
            .is_some_and(|head| head == id)
    }

    fn show_head(&self, window: &str) -> Option<Effect> {
        self.shown(window).map(|id| show(window, &id))
    }

    /// Remove `id`; returns its window and whether it was the shown one.
    fn remove(&mut self, id: &str) -> Option<(String, bool)> {
        let entry = self.entries.remove(id)?;
        let mut was_head = false;
        if let Some(queue) = self.queues.get_mut(&entry.window) {
            was_head = queue.front().is_some_and(|head| head == id);
            queue.retain(|queued| queued != id);
            if queue.is_empty() {
                self.queues.remove(&entry.window);
            }
        }
        Some((entry.window, was_head))
    }

    /// Resolve `id` with `outcome`, advancing its window if it was shown.
    fn end(&mut self, id: &str, outcome: Outcome) -> Vec<Effect> {
        let Some((window, was_head)) = self.remove(id) else {
            return Vec::new();
        };
        let mut fx = vec![resolve(id, outcome)];
        if was_head {
            fx.extend(self.show_head(&window));
        }
        fx
    }
}

fn show(window: &str, id: &str) -> Effect {
    Effect::Show {
        window: window.to_string(),
        id: id.to_string(),
    }
}

fn resolve(id: &str, outcome: Outcome) -> Effect {
    Effect::Resolve {
        id: id.to_string(),
        outcome,
    }
}

#[cfg(test)]
#[path = "queue_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "queue_law_fixtures.rs"]
mod law_fixtures;

#[cfg(test)]
#[path = "queue_law_checker.rs"]
mod law_checker;

#[cfg(test)]
#[path = "queue_law_tests.rs"]
mod law_tests;
