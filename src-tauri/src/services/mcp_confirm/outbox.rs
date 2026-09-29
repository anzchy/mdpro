//! The broker's locked state: the pending table, the waiters, and the
//! outbox that turns queue effects into boundary calls (ADR-0042 wire rule).
//!
//! Everything here runs under the broker's lock and makes no boundary call;
//! `broker::drain` sends the outbox afterwards, in order, via `Wire::send`.
//!
//! Wire rule: `Show` -> a `mcp:confirm_request` entry, carrying what is left
//! of the request's own budget. The end of a displayed request -> exactly
//! one `mcp:confirm_resolved` entry (`Dismiss` is `withdrawn`), queued
//! before any later `Show`. `Cancelled(WindowClosed)` (the window is gone)
//! and a never-displayed request get none.

use std::collections::{HashMap, VecDeque};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::oneshot;
use tokio::time::Instant;

use super::broker::LogSink;
use super::effects::ConfirmEffects;
use super::logging;
use super::payload::{
    ConfirmMeta, ConfirmRequestPayload, ConfirmResolvedPayload, ResolvedOutcome,
    CONFIRM_REQUEST_EVENT, CONFIRM_RESOLVED_EVENT,
};
use super::queue::{Cause, Effect, IdSource, Outcome, PendingTable, RequestId};

pub(super) struct Slot {
    pub meta: ConfirmMeta,
    pub deadline: Instant,
}

/// A boundary call waiting to be made, in table order.
pub(super) enum Wire {
    Request {
        window: String,
        id: RequestId,
        payload: Value,
    },
    Resolved {
        window: String,
        id: RequestId,
        payload: Value,
    },
}

impl Wire {
    /// Make this boundary call, outside the lock. A delivered request is
    /// followed by one attention request. Returns the id whose request emit
    /// failed, so the broker can `fail_show` it; other failures are logged.
    pub fn send(self, effects: &impl ConfirmEffects, sink: &LogSink) -> Option<RequestId> {
        match self {
            Wire::Request {
                window,
                id,
                payload,
            } => {
                if effects
                    .emit_to(&window, CONFIRM_REQUEST_EVENT, payload)
                    .is_err()
                {
                    sink(logging::effect_failed_entry(&id, &window, "request"));
                    return Some(id);
                }
                if effects.request_attention(&window).is_err() {
                    sink(logging::effect_failed_entry(&id, &window, "attention"));
                }
                None
            }
            Wire::Resolved {
                window,
                id,
                payload,
            } => {
                if effects
                    .emit_to(&window, CONFIRM_RESOLVED_EVENT, payload)
                    .is_err()
                {
                    sink(logging::effect_failed_entry(&id, &window, "resolved"));
                }
                None
            }
        }
    }
}

pub(super) struct Inner {
    pub table: PendingTable<Slot>,
    pub waiters: HashMap<RequestId, oneshot::Sender<Outcome>>,
    /// Requests whose `confirm_request` is on screen or queued to be.
    pub displayed: HashMap<RequestId, String>,
    pub outbox: VecDeque<Wire>,
    /// Set while one caller is sending the outbox.
    pub draining: bool,
}

fn to_value<T: Serialize>(payload: T) -> Value {
    serde_json::to_value(payload).unwrap_or_default()
}

impl Inner {
    pub fn new(ids: impl IdSource + 'static) -> Self {
        Self {
            table: PendingTable::new(ids),
            waiters: HashMap::new(),
            displayed: HashMap::new(),
            outbox: VecDeque::new(),
            draining: false,
        }
    }

    /// Carry out queue effects: wake waiters and queue boundary calls.
    pub fn apply(&mut self, effects: Vec<Effect>) {
        let now = Instant::now();
        for effect in effects {
            match effect {
                Effect::Show { window, id } => self.show(window, id, now),
                Effect::Resolve { id, outcome } => {
                    if let Some(waiter) = self.waiters.remove(&id) {
                        // Err: the waiter is already gone, and its drop
                        // guard finds nothing left to withdraw.
                        let _ = waiter.send(outcome);
                    }
                    let closes = outcome != Outcome::Cancelled(Cause::WindowClosed);
                    if let Some(window) = self.displayed.remove(&id).filter(|_| closes) {
                        self.close(window, id, outcome.into());
                    }
                }
                Effect::Dismiss { window, id } => {
                    self.displayed.remove(&id);
                    self.close(window, id, ResolvedOutcome::Withdrawn);
                }
            }
        }
    }

    fn show(&mut self, window: String, id: RequestId, now: Instant) {
        let Some(slot) = self.table.meta(&id) else {
            return;
        };
        let remaining = slot.deadline.saturating_duration_since(now).as_millis();
        let expires_in_ms = u64::try_from(remaining).unwrap_or(u64::MAX);
        let payload = to_value(ConfirmRequestPayload::new(&id, &slot.meta, expires_in_ms));
        self.displayed.insert(id.clone(), window.clone());
        self.outbox.push_back(Wire::Request {
            window,
            id,
            payload,
        });
    }

    fn close(&mut self, window: String, id: RequestId, outcome: ResolvedOutcome) {
        let request_id = id.clone();
        let payload = to_value(ConfirmResolvedPayload {
            request_id,
            outcome,
        });
        self.outbox.push_back(Wire::Resolved {
            window,
            id,
            payload,
        });
    }
}
