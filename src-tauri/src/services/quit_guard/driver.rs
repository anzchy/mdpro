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
//! - **Commit order is flag, then delete, then reply.** The flag closes draft
//!   saving first, so an auto-save tick already in flight cannot write a
//!   discarded draft back between the delete and process exit (ADR-0025 §4).
//! - **Draft deletion is not behind `QuitEffects`.** It is the one effect whose
//!   failure is data loss, so tests exercise the real thing.
//!
//! @coordinates-with docs/adr/0025-app-quit-is-deferred-through-a-native-terminate-hook.md
//! @coordinates-with docs/adr/0027-a-quit-ack-timeout-draws-a-native-alert.md

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use super::logging;
use crate::services::draft;

pub use super::coordinator::{
    AbortReason, Answer, Begin, FallbackAnswer, QuitCoordinator, Step, QUIT_ACK_TIMEOUT_MS,
};
pub use super::events::{CommitReport, QuitEffects, QuitEvent};
pub use super::reply::{validate_discard_ids, QuitAnswer, MAX_DISCARD_IDS};

/// What to do once the lock is released. Computed under the lock so the driver's
/// own state is already consistent before any effect can re-enter it.
enum Plan {
    Nothing,
    Prompt {
        request_id: u64,
        label: String,
    },
    Fallback {
        request_id: u64,
        timed_out: Vec<String>,
    },
    Abort {
        request_id: u64,
        reason: AbortReason,
    },
    Commit {
        request_id: u64,
        discard_document_ids: Vec<String>,
    },
}

struct Inner {
    coordinator: QuitCoordinator,
    current: Option<u64>,
    last_commit_report: Option<CommitReport>,
}

pub struct QuitGuard<E: QuitEffects> {
    inner: Mutex<Inner>,
    effects: E,
    committed: &'static AtomicBool,
}

impl<E: QuitEffects> QuitGuard<E> {
    /// The production guard: it writes the one shared `QUIT_COMMITTED` flag that
    /// `save_draft` reads.
    pub fn new(effects: E) -> Self {
        Self::with_flag(effects, &super::QUIT_COMMITTED)
    }

    /// A guard over an injected flag, so a test can commit a quit without
    /// closing draft saving for every other test in the process.
    pub fn with_flag(effects: E, committed: &'static AtomicBool) -> Self {
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
            self.effects.emit_all(QuitEvent::Requested { request_id });
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
        let ids = match validate_discard_ids(answer, document_ids) {
            Ok(ids) => ids,
            Err(err) => {
                let context = logging::answer_log_context(label, answer, request_id, &[]);
                logging::log_answer(context, Some(err.clone()));
                return Err(err);
            }
        };
        logging::log_answer(
            logging::answer_log_context(label, answer, request_id, &ids),
            None,
        );
        let answer = match answer {
            QuitAnswer::Clean => Answer::Clean,
            QuitAnswer::Dirty => Answer::Dirty,
            QuitAnswer::Discard => Answer::Discard(ids),
            QuitAnswer::Cancel => Answer::Cancel,
        };
        let plan = self.plan(|c| c.on_answer(request_id, label, answer, now_ms));
        self.run(plan);
        Ok(())
    }

    /// The ack deadline has been reached.
    pub fn tick(&self, now_ms: u64) {
        let plan = self.plan(|c| c.on_tick(now_ms));
        self.run(plan);
    }

    /// A window is gone for good. Routed from `WindowEvent::Destroyed` only.
    pub fn window_gone(&self, label: &str) {
        let plan = self.plan(|c| c.on_window_gone(label));
        self.run(plan);
    }

    /// The user's answer to the native timeout alert (ADR-0027).
    pub fn fallback_answer(&self, request_id: u64, answer: FallbackAnswer) {
        let plan = self.plan(|c| c.on_fallback_answer(request_id, answer));
        self.run(plan);
    }

    fn plan(&self, input: impl FnOnce(&mut QuitCoordinator) -> Step) -> Plan {
        let mut inner = self.lock();
        let step = input(&mut inner.coordinator);
        let request_id = inner.current.unwrap_or_default();
        match step {
            // `Ignored` is deliberately silent: a duplicate reply from a
            // recovering webview is ordinary, and logging it invites a storm.
            Step::Wait | Step::Ignored { .. } => Plan::Nothing,
            Step::Prompt(label) => Plan::Prompt { request_id, label },
            Step::NativeFallback { timed_out } => Plan::Fallback {
                request_id,
                timed_out,
            },
            Step::Abort { reason } => {
                inner.current = None;
                Plan::Abort { request_id, reason }
            }
            Step::Commit {
                discard_document_ids,
            } => {
                inner.current = None;
                Plan::Commit {
                    request_id,
                    discard_document_ids,
                }
            }
        }
    }

    fn run(&self, plan: Plan) {
        match plan {
            Plan::Nothing => {}
            Plan::Prompt { request_id, label } => {
                logging::log_prompt(request_id, &label);
                // Front first, then ask: a dialog in a window the user cannot
                // see reads as a hang.
                self.effects.activate(&label);
                self.effects
                    .emit_to(&label, QuitEvent::Prompt { request_id });
            }
            Plan::Fallback {
                request_id,
                timed_out,
            } => {
                logging::log_timeout(request_id, timed_out.len(), QUIT_ACK_TIMEOUT_MS);
                self.effects.native_fallback(request_id, timed_out);
            }
            Plan::Abort { request_id, reason } => {
                logging::log_cancel(request_id, &reason);
                // Close every open dialog before refusing, so no window is left
                // showing a prompt for a request that no longer exists.
                self.effects.emit_all(QuitEvent::Cancelled { request_id });
                self.effects.reply(false);
            }
            Plan::Commit {
                request_id,
                discard_document_ids,
            } => {
                self.committed.store(true, Ordering::SeqCst);
                let mut report = CommitReport::default();
                for id in &discard_document_ids {
                    self.effects.on_delete(id);
                    match draft::delete_draft(id) {
                        Ok(true) => report.deleted += 1,
                        // Nothing to delete: the draft was never written.
                        Ok(false) => {}
                        // One draft that will not go must not strand the quit;
                        // it is counted and the rest still run.
                        Err(_) => report.failed += 1,
                    }
                }
                self.lock().last_commit_report = Some(report);
                logging::log_commit(request_id, &report);
                self.effects.reply(true);
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn snapshot(&self) -> QuitCoordinator {
        self.lock().coordinator.clone()
    }
}
