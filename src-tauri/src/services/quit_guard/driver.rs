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
//! - The two resolutions — the commit (gate, deletion loop, report, reply) and
//!   the abort — live in `driver_commit.rs`; the ADR-0035 re-check and backstop
//!   rounds, and the backstop's `Drafted` answer, in `driver_rounds.rs`; every
//!   window answer — validation, round tag, ruling, log — in `driver_wire.rs`.
//!   Every event carries the round `plan` read under the lock (ADR-0035 A5).
//!
//! @coordinates-with docs/adr/0029-quit-deadlines-bound-machine-progress-not-people.md
//! @coordinates-with docs/adr/0025-app-quit-is-deferred-through-a-native-terminate-hook.md
//! @coordinates-with docs/adr/0027-a-quit-ack-timeout-draws-a-native-alert.md

use super::logging;
use super::plan::{translate, Plan};
use super::DraftGate;
use std::sync::Mutex;
#[path = "driver_commit.rs"]
mod commit;
#[path = "driver_rounds.rs"]
mod rounds;
#[path = "driver_wire.rs"]
mod wire;

pub use super::coordinator::{
    AbortReason, Answer, Begin, FallbackAnswer, IgnoredWhy, QuitCoordinator, Step,
    QUIT_ACK_TIMEOUT_MS, QUIT_PROMPT_DELIVERY_TIMEOUT_MS,
};
pub use super::events::{deliver_fallback, CommitReport, FallbackSink, QuitEffects, QuitEvent};
pub use super::reply::{
    validate_backstop_counts, validate_discard_ids, validate_undiscard_ids, QuitAnswer,
    MAX_BACKSTOP_COUNT, MAX_DISCARD_IDS,
};

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
            // Phase 1 is round 0; each re-check is the next round (ADR-0035 A5).
            if !self.effects.emit_all(QuitEvent::Requested {
                request_id,
                round: 0,
            }) {
                logging::log_effect_failed(request_id, "emitRequested");
            }
            self.effects
                .arm_timer(request_id, now_ms.saturating_add(QUIT_ACK_TIMEOUT_MS));
        }
        outcome
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
        let before = inner.coordinator.round();
        let step = input(&mut inner.coordinator);
        // The round after the input (a re-check has just started it); the one
        // before when the input ended the request.
        let round = inner.coordinator.round().or(before).unwrap_or_default();
        let (plan, refusal) = translate(step, inner.current.unwrap_or_default(), round);
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
                round,
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
                    .emit_to(&label, QuitEvent::Prompt { request_id, round })
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
            plan @ (Plan::Recheck { .. } | Plan::Backstop { .. }) => self.run_round(plan),
            Plan::Fallback {
                request_id,
                timed_out,
            } => {
                logging::log_timeout(request_id, timed_out.len(), QUIT_ACK_TIMEOUT_MS);
                self.fallback(request_id, timed_out);
            }
            Plan::Abort {
                request_id,
                reason,
                round,
            } => self.abort(request_id, &reason, round),
            Plan::Commit {
                request_id,
                discard_document_ids,
                backstop,
            } => self.commit(request_id, &discard_document_ids, backstop),
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
