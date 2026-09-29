//! Purpose: the async shell around `queue::PendingTable` (ADR-0042
//! decisions 1, 3, 4): one waiter per request, a 60 s deadline from
//! arrival, and every queue effect carried out on the `ConfirmEffects`
//! boundary in table order.
//!
//! Pipeline: `confirm` enqueues -> effects become outbox entries under the
//! lock (`outbox.rs`, which owns the wire rule) -> `drain` sends them
//! outside the lock -> reply / deadline / drop / cancel wakes the waiter.
//!
//! Key decisions:
//! - The std `Mutex` is never held across an `.await` or a boundary call;
//!   one drainer at a time sends the outbox, so emits keep table order.
//! - A failed request emit is `fail_show` -> `Cancelled(EmitFailed)`.
//! - Deadlines use `tokio::time::Instant` (the paused test clock moves
//!   them). A dropped waiter (client disconnect) withdraws its request.
//! - A poisoned table fails closed: `confirm` -> `Cancelled(EmitFailed)`,
//!   everything else -> `Err`. Nothing here panics.
//!
//! @coordinates-with src-tauri/src/services/mcp_confirm/queue.rs
//! @coordinates-with src-tauri/src/services/mcp_confirm/outbox.rs
//! @coordinates-with src-tauri/src/services/mcp_confirm/effects.rs

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tokio::sync::oneshot;
use tokio::time::{timeout_at, Instant};

use super::effects::ConfirmEffects;
use super::logging;
use super::outbox::{Inner, Slot};
use super::payload::ConfirmMeta;
use super::queue::{Cause, Effect, IdSource, Outcome, ReplyVerdict, RequestId};
use crate::models::LogEntryPayload;
use crate::services::logger;

/// How long a request may wait, from its arrival (ADR-0042 decision 4).
pub const CONFIRM_BUDGET: Duration = Duration::from_secs(60);
const UNAVAILABLE: &str = "confirmation table unavailable";

/// Where `mcp.confirm` lines go: the JSONL logger in production.
pub type LogSink = Arc<dyn Fn(LogEntryPayload) + Send + Sync>;

fn waited_ms(arrival: Instant) -> u64 {
    u64::try_from(arrival.elapsed().as_millis()).unwrap_or(u64::MAX)
}

pub struct ConfirmBroker<E> {
    effects: E,
    inner: Mutex<Inner>,
    sink: LogSink,
}

impl<E: ConfirmEffects> ConfirmBroker<E> {
    /// The production broker: uuid v4 ids, lines to the JSONL logger.
    pub fn new(effects: E) -> Self {
        let sink: LogSink = Arc::new(logger::log_event);
        Self::build(effects, || uuid::Uuid::new_v4().to_string(), sink)
    }

    /// A test broker with injected ids; its log lines are discarded unless
    /// `with_log_sink` replaces the sink.
    #[cfg(test)]
    pub fn new_with(effects: E, ids: impl IdSource + 'static) -> Self {
        Self::build(effects, ids, Arc::new(|_line| {}))
    }

    pub fn with_log_sink(mut self, sink: LogSink) -> Self {
        self.sink = sink;
        self
    }

    fn build(effects: E, ids: impl IdSource + 'static, sink: LogSink) -> Self {
        Self {
            effects,
            inner: Mutex::new(Inner::new(ids)),
            sink,
        }
    }

    /// Ask `window` to confirm and wait for the outcome, at most
    /// `CONFIRM_BUDGET` from now. Dropping the future withdraws the request.
    pub async fn confirm(&self, window: &str, meta: ConfirmMeta) -> Outcome {
        let arrival = Instant::now();
        let deadline = arrival + CONFIRM_BUDGET;
        let (tx, mut rx) = oneshot::channel();
        let Some((id, depth)) = self.enqueue(window, &meta, deadline, tx) else {
            (self.sink)(logging::unavailable_entry(window, &meta));
            return Outcome::Cancelled(Cause::EmitFailed);
        };
        (self.sink)(logging::start_entry(&id, window, &meta, depth));
        let mut guard = WithdrawGuard {
            broker: self,
            id: Some(id.clone()),
            window,
            meta: &meta,
            depth,
            arrival,
        };
        self.drain();
        let outcome = match timeout_at(deadline, &mut rx).await {
            Ok(Ok(outcome)) => outcome,
            // The sender went away without an outcome: fail closed.
            Ok(Err(_)) => Outcome::Cancelled(Cause::EmitFailed),
            Err(_) => self.expire(&id, &mut rx),
        };
        guard.id = None;
        let waited = waited_ms(arrival);
        (self.sink)(logging::end_entry(
            &id, window, &meta, depth, outcome, waited,
        ));
        outcome
    }

    /// A window's answer. The caller supplies its own label; the table
    /// accepts it only from the owner, for the shown request.
    pub fn reply(&self, id: &str, caller: &str, approved: bool) -> Result<ReplyVerdict, String> {
        let mut verdict = ReplyVerdict::IgnoredUnknown;
        self.run(|inner| {
            let (v, effects) = inner.table.reply(id, caller, approved);
            verdict = v;
            effects
        })?;
        Ok(verdict)
    }

    pub fn cancel_window(&self, window: &str) -> Result<(), String> {
        self.run(|inner| inner.table.cancel_window(window))
    }

    pub fn cancel_all(&self, cause: Cause) -> Result<(), String> {
        self.run(|inner| inner.table.cancel_all(cause))
    }

    pub fn close(&self, cause: Cause) -> Result<(), String> {
        self.run(|inner| inner.table.close(cause))
    }

    fn lock(&self) -> Result<MutexGuard<'_, Inner>, String> {
        self.inner.lock().map_err(|_| UNAVAILABLE.to_string())
    }

    /// Run one table operation, queue its effects, then send them.
    fn run(&self, op: impl FnOnce(&mut Inner) -> Vec<Effect>) -> Result<(), String> {
        {
            let mut inner = self.lock()?;
            let effects = op(&mut inner);
            inner.apply(effects);
        }
        self.drain();
        Ok(())
    }

    fn enqueue(
        &self,
        window: &str,
        meta: &ConfirmMeta,
        deadline: Instant,
        tx: oneshot::Sender<Outcome>,
    ) -> Option<(RequestId, usize)> {
        let mut inner = self.lock().ok()?;
        let slot = Slot {
            meta: meta.clone(),
            deadline,
        };
        let (id, effects) = inner.table.enqueue(window, slot);
        inner.waiters.insert(id.clone(), tx);
        let depth = inner.table.pending_len();
        inner.apply(effects);
        Some((id, depth))
    }

    /// The deadline passed. An outcome that got there first is kept.
    fn expire(&self, id: &str, rx: &mut oneshot::Receiver<Outcome>) -> Outcome {
        if self.run(|inner| inner.table.expire(id)).is_err() {
            return Outcome::Cancelled(Cause::EmitFailed);
        }
        rx.try_recv().unwrap_or(Outcome::TimedOut)
    }

    /// Returns whether `id` was still pending.
    fn withdraw(&self, id: &str) -> bool {
        let mut was_pending = false;
        let ran = self.run(|inner| {
            inner.waiters.remove(id);
            was_pending = inner.table.meta(id).is_some();
            inner.table.withdraw(id)
        });
        ran.is_ok() && was_pending
    }

    /// Send queued boundary calls in order, outside the lock. A caller that
    /// finds another drainer at work leaves its entries to it.
    fn drain(&self) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if inner.draining {
            return;
        }
        inner.draining = true;
        while let Some(wire) = inner.outbox.pop_front() {
            drop(inner);
            let failed = wire.send(&self.effects, &self.sink);
            inner = match self.inner.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if let Some(id) = failed {
                // Never on screen, so it gets no `confirm_resolved`.
                inner.displayed.remove(&id);
                let effects = inner.table.fail_show(&id);
                inner.apply(effects);
            }
        }
        inner.draining = false;
    }
}

/// Withdraws the request if the `confirm` future is dropped before its
/// outcome (axum drops the handler when the client disconnects).
struct WithdrawGuard<'a, E: ConfirmEffects> {
    broker: &'a ConfirmBroker<E>,
    id: Option<RequestId>,
    window: &'a str,
    meta: &'a ConfirmMeta,
    depth: usize,
    arrival: Instant,
}

impl<E: ConfirmEffects> Drop for WithdrawGuard<'_, E> {
    fn drop(&mut self) {
        let Some(id) = self.id.take() else {
            return;
        };
        if self.broker.withdraw(&id) {
            let waited = waited_ms(self.arrival);
            let line = logging::withdrawn_entry(&id, self.window, self.meta, self.depth, waited);
            (self.broker.sink)(line);
        }
    }
}

#[cfg(test)]
impl<E: ConfirmEffects> ConfirmBroker<E> {
    pub fn pending_len(&self) -> usize {
        self.inner
            .lock()
            .map(|i| i.table.pending_len())
            .unwrap_or(0)
    }

    pub fn shown(&self, window: &str) -> Option<RequestId> {
        self.inner.lock().ok()?.table.shown(window)
    }

    pub fn poison_for_test(&self) {
        let _ = std::thread::scope(|s| {
            s.spawn(|| {
                let _held = self.inner.lock();
                panic!("poisoning the confirmation table for a test");
            })
            .join()
        });
    }
}

#[cfg(test)]
#[path = "broker_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "broker_time_tests.rs"]
mod time_tests;

#[cfg(test)]
#[path = "broker_law_tests.rs"]
mod law_tests;

#[cfg(test)]
#[path = "broker_end_signal_tests.rs"]
mod end_signal_tests;
