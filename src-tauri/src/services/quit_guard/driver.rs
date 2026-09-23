//! Purpose: drive the pure coordinator's `Step`s onto the platform.
//!
//! Pipeline: native hook / `quit_guard_reply` / ack timer / `WindowEvent` ->
//! `QuitGuard` -> `QuitCoordinator` -> `Step` -> effects + real draft deletion
//! -> the NSApp reply.
//!
//! Key decisions:
//! - **No effect ever runs under the lock.** Each input takes the mutex once,
//!   asks the coordinator, updates the driver's own state, and drops the guard
//!   before anything is emitted. `replyToApplicationShouldTerminate:` can run
//!   AppKit code that re-enters this guard, and a `std::sync::Mutex` is not
//!   reentrant, so holding it across an effect is a deadlock.
//! - **Commit order is close, then delete, then reply.** Closing the gate and
//!   deleting run as one critical section, so an auto-save tick already in
//!   flight can neither slip its write in between them nor start a new one
//!   until the deletes are done (ADR-0025 §4).
//! - **Lock ordering: the draft gate is outside the coordinator mutex.** The
//!   commit takes the gate's write guard, finishes with it, and only then takes
//!   `self.lock()` to record the report. Nothing ever takes the gate while the
//!   coordinator mutex is held. The reply is made with neither held: it posts to
//!   the macOS main thread, which can re-enter this guard.
//! - **Draft deletion is not behind `QuitEffects`.** It is the one effect whose
//!   failure is data loss, so tests exercise the real thing.
//! - **An effect that reports failure is acted on, not discarded** (ADR-0029
//!   §4). A prompt that was not delivered goes straight back to the coordinator
//!   rather than waiting out a deadline for a dialog nobody has, and is logged
//!   as `effect_failed/emitPrompt`, never as a timeout; a reply or an
//!   alert that was not dispatched is logged at error level, and a failed alert
//!   hands the request back so the windows can still resolve it. A broadcast or
//!   an activation that failed is logged and changes nothing else.
//! - **A timer is armed only for a prompt that was actually handed over**, and
//!   at the coordinator's instant — the driver never computes a deadline.
//! - **The answer is logged after the coordinator has ruled**, with the ruling.
//!   Logging it on arrival reported every refusal as `status:"success"`, so a
//!   cancel that did nothing was indistinguishable from one that worked. The
//!   alert's answer is logged the same way, as `app.quit.fallback`.
//! - The draft-deletion loop lives in `driver_commit.rs`; a deletion that fails
//!   makes the `app.quit.commit` line `fail`.
//!
//! @coordinates-with docs/adr/0029-quit-deadlines-bound-machine-progress-not-people.md
//! @coordinates-with docs/adr/0025-app-quit-is-deferred-through-a-native-terminate-hook.md
//! @coordinates-with docs/adr/0027-a-quit-ack-timeout-draws-a-native-alert.md

use std::sync::Mutex;

use super::logging;
use super::plan::{translate, Plan};
use super::DraftGate;

#[path = "driver_commit.rs"]
mod commit;

pub use super::coordinator::{
    AbortReason, Answer, Begin, FallbackAnswer, IgnoredWhy, QuitCoordinator, Step,
    QUIT_ACK_TIMEOUT_MS, QUIT_PROMPT_DELIVERY_TIMEOUT_MS,
};
pub use super::events::{deliver_fallback, CommitReport, FallbackSink, QuitEffects, QuitEvent};
pub use super::reply::{validate_discard_ids, QuitAnswer, MAX_DISCARD_IDS};

struct Inner {
    coordinator: QuitCoordinator,
    current: Option<u64>,
    last_commit_report: Option<CommitReport>,
}

pub struct QuitGuard<E: QuitEffects> {
    inner: Mutex<Inner>,
    effects: E,
    committed: &'static DraftGate,
}

impl<E: QuitEffects> QuitGuard<E> {
    /// The production guard: it closes the one shared `QUIT_COMMITTED` gate that
    /// `save_draft` writes through.
    pub fn new(effects: E) -> Self {
        Self::with_gate(effects, &super::QUIT_COMMITTED)
    }

    /// A guard over an injected gate, so a test can commit a quit without
    /// closing draft saving for every other test in the process.
    pub fn with_gate(effects: E, committed: &'static DraftGate) -> Self {
        Self {
            inner: Mutex::new(Inner {
                coordinator: QuitCoordinator::new(),
                current: None,
                last_commit_report: None,
            }),
            effects,
            committed,
        }
    }

    pub fn effects(&self) -> &E {
        &self.effects
    }

    pub fn last_commit_report(&self) -> Option<CommitReport> {
        self.lock().last_commit_report
    }

    /// A poisoned lock means another thread panicked mid-quit. The coordinator
    /// behind it is a plain state machine that the panic did not corrupt, and
    /// refusing to quit from here would strand the app, so recover the value.
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Open a quit request over the windows open right now.
    pub fn begin<S: AsRef<str>>(&self, window_labels: &[S], now_ms: u64) -> Begin {
        let outcome = {
            let mut inner = self.lock();
            let outcome = inner.coordinator.begin(window_labels, now_ms);
            if let Begin::Later { request_id } = &outcome {
                inner.current = Some(*request_id);
            }
            outcome
        };
        if let Begin::Later { request_id } = &outcome {
            let request_id = *request_id;
            logging::log_request(request_id, window_labels.len());
            if !self.effects.emit_all(QuitEvent::Requested { request_id }) {
                logging::log_effect_failed(request_id, "emitRequested");
            }
            self.effects
                .arm_timer(request_id, now_ms.saturating_add(QUIT_ACK_TIMEOUT_MS));
        }
        outcome
    }

    /// One window's answer. `label` is the caller's own label, never a value
    /// from the payload: a window may not answer for another window.
    pub fn handle_reply(
        &self,
        label: &str,
        request_id: u64,
        answer: QuitAnswer,
        document_ids: Option<Vec<String>>,
        now_ms: u64,
    ) -> Result<(), String> {
        // Counted before validation so a refusal still logs how many ids came.
        let sent = document_ids.as_deref().unwrap_or_default();
        let refused_context = logging::answer_log_context(label, answer, request_id, sent);
        let ids = match validate_discard_ids(answer, document_ids) {
            Ok(ids) => ids,
            Err(err) => {
                // `err` names an index or a limit, never an id (see `reply`).
                logging::log_answer(refused_context, Some(err.clone()));
                return Err(err);
            }
        };
        let context = logging::answer_log_context(label, answer, request_id, &ids);
        let wire_answer = answer;
        let answer = match answer {
            QuitAnswer::Clean => Answer::Clean,
            QuitAnswer::Dirty => Answer::Dirty,
            QuitAnswer::Discard => Answer::Discard(ids),
            QuitAnswer::Cancel => Answer::Cancel,
            QuitAnswer::Delivered => Answer::Delivered,
        };
        let (plan, refusal) = self.plan(|c| c.on_answer(request_id, label, answer, now_ms));
        // Logged AFTER the coordinator has ruled, with what it ruled. Logging
        // the answer on arrival reported every refusal as a success, so a cancel
        // that did nothing was indistinguishable from one that worked.
        logging::log_answer(
            context,
            refusal.map(|why| format!("{wire_answer:?} refused: {}", why.as_str())),
        );
        self.run(plan);
        Ok(())
    }

    /// The ack deadline has been reached.
    pub fn tick(&self, now_ms: u64) {
        let (plan, _) = self.plan(|c| c.on_tick(now_ms));
        self.run(plan);
    }

    /// A window is gone for good. Routed from `WindowEvent::Destroyed` only.
    pub fn window_gone(&self, label: &str, now_ms: u64) {
        let (plan, _) = self.plan(|c| c.on_window_gone(label, now_ms));
        self.run(plan);
    }

    /// The user's answer to the native timeout alert (ADR-0027). Logged with
    /// the coordinator's ruling, before the plan runs, so the line precedes the
    /// commit or cancel it causes.
    pub fn fallback_answer(&self, request_id: u64, answer: FallbackAnswer) {
        let (plan, refusal) = self.plan(|c| c.on_fallback_answer(request_id, answer));
        logging::log_fallback(request_id, answer, refusal.map(IgnoredWhy::as_str));
        self.run(plan);
    }

    /// Run one input under the lock and translate its `Step` into work for
    /// after the lock. The guard is dropped on return, so `run` — and every
    /// effect it reaches — is called with nothing held.
    fn plan(&self, input: impl FnOnce(&mut QuitCoordinator) -> Step) -> (Plan, Option<IgnoredWhy>) {
        let mut inner = self.lock();
        let step = input(&mut inner.coordinator);
        let (plan, refusal) = translate(step, inner.current.unwrap_or_default());
        if plan.resolves_request() {
            inner.current = None;
        }
        (plan, refusal)
    }

    fn run(&self, plan: Plan) {
        match plan {
            Plan::Nothing => {}
            Plan::Prompt {
                request_id,
                label,
                deadline_ms,
            } => {
                logging::log_prompt(request_id, &label);
                // Front first, then ask: a dialog in a window the user cannot
                // see reads as a hang. A failed activation is logged only:
                // the prompt may still reach a window that is already in front.
                if !self.effects.activate(&label) {
                    logging::log_effect_failed(request_id, "activate");
                }
                if self
                    .effects
                    .emit_to(&label, QuitEvent::Prompt { request_id })
                {
                    // Only a prompt that was actually handed over is worth
                    // waiting for. The deadline is the coordinator's: it is the
                    // only one that knows this is a machine step (ADR-0029).
                    self.effects.arm_timer(request_id, deadline_ms);
                } else {
                    // Logged as what it is, not as a timeout: no deadline ran.
                    // The cause lives in this call only, never in the guard.
                    logging::log_effect_failed(request_id, "emitPrompt");
                    match self.plan(|c| c.on_delivery_failed(request_id, &label)).0 {
                        Plan::Fallback { timed_out, .. } => self.fallback(request_id, timed_out),
                        plan => self.run(plan),
                    }
                }
            }
            Plan::Rearm {
                request_id,
                deadline_ms,
            } => self.effects.arm_timer(request_id, deadline_ms),
            Plan::Fallback {
                request_id,
                timed_out,
            } => {
                logging::log_timeout(request_id, timed_out.len(), QUIT_ACK_TIMEOUT_MS);
                self.fallback(request_id, timed_out);
            }
            Plan::Abort { request_id, reason } => {
                logging::log_cancel(request_id, &reason);
                // Close every open dialog before refusing, so no window is left
                // showing a prompt for a request that no longer exists.
                if !self.effects.emit_all(QuitEvent::Cancelled { request_id }) {
                    logging::log_effect_failed(request_id, "emitCancelled");
                }
                if !self.effects.reply(false) {
                    logging::log_effect_failed(request_id, "reply");
                }
            }
            Plan::Commit {
                request_id,
                discard_document_ids,
            } => {
                // One critical section for the close AND the deletes. A save
                // that is mid-write holds this off until it finishes, and no
                // save can start once it is taken — so nothing can write a
                // discarded draft back behind the loop (ADR-0025 §4).
                let report = {
                    let _closed = self.committed.close();
                    commit::delete_discarded(&self.effects, &discard_document_ids)
                };
                // The gate guard is released above, before the coordinator
                // mutex is taken and before the reply is posted: see the lock
                // ordering in this module's header.
                self.lock().last_commit_report = Some(report);
                logging::log_commit(request_id, &report);
                if !self.effects.reply(true) {
                    logging::log_effect_failed(request_id, "reply");
                }
            }
        }
    }

    /// Post the native alert. An alert that was never posted cannot own the
    /// request: leaving it owned would strand a quit behind a dialog that does
    /// not exist.
    fn fallback(&self, request_id: u64, timed_out: Vec<String>) {
        if !self.effects.native_fallback(request_id, timed_out) {
            logging::log_effect_failed(request_id, "nativeFallback");
            self.lock().coordinator.release_fallback(request_id);
        }
    }

    #[cfg(test)]
    pub(crate) fn snapshot(&self) -> QuitCoordinator {
        self.lock().coordinator.clone()
    }
}
