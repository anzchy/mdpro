//! WI3-D11 and D12 (concurrency and lock scope), split out of `driver_tests.rs`.
//!
//! Test cases for the WI-3 driver (`services::quit_guard::driver`), the
//! `on_window_event` seam and the pure log builders.
//!
//! Wired from `mod.rs` with `#[cfg(test)] #[path = ...]` so the specification
//! lives apart from the implementation it constrains.
//!
//! **Draft deletion is real here.** It is not behind `QuitEffects`, so every
//! case whose request reaches `Commit` with a non-empty id list runs under
//! `crate::HOME_LOCK`, in a temp `$HOME`, and asserts that `dirs::data_dir()`
//! resolved inside that temp HOME before it writes anything. Without that
//! guard these cases would delete the developer's own drafts.

use super::driver::*;
use super::driver_fixtures::*;
use std::sync::{Arc, Barrier, Mutex, OnceLock, Weak};

// ── WI3-D11 ───────────────────────────────────────────────────────────────────

#[test]
fn d11_concurrent_last_answers_produce_exactly_one_reply() {
    let labels: Vec<String> = (0..8).map(|i| format!("w{i}")).collect();

    for iteration in 0..200 {
        let gate = leak_gate();
        let guard = Arc::new(recording_guard(gate));
        let r = later(guard.begin(&labels, 0));
        let barrier = Arc::new(Barrier::new(labels.len()));
        let mut handles = Vec::new();
        for label in &labels {
            let guard = Arc::clone(&guard);
            let barrier = Arc::clone(&barrier);
            let label = label.clone();
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                guard
                    .handle_reply(&label, r, QuitAnswer::Clean, None, 1)
                    .unwrap();
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        // ADR-0035 changes the spec: commit is now preceded by a re-check round.
        let names: Vec<&str> = labels.iter().map(String::as_str).collect();
        finish_quit(&guard, r, &names, 2);
        let effects = effects_of(&guard);
        let replies: Vec<&Effect> = effects
            .iter()
            .filter(|e| matches!(e, Effect::Reply(_)))
            .collect();
        assert_eq!(
            replies.len(),
            1,
            "iteration {iteration}: eight racing answers gave {replies:?}"
        );
    }

    for iteration in 0..200 {
        let gate = leak_gate();
        let guard = Arc::new(recording_guard(gate));
        let r = later(guard.begin(&labels, 0));
        for label in labels.iter().skip(1) {
            guard
                .handle_reply(label, r, QuitAnswer::Clean, None, 1)
                .unwrap();
        }
        let barrier = Arc::new(Barrier::new(2));
        let answerer = {
            let guard = Arc::clone(&guard);
            let barrier = Arc::clone(&barrier);
            let label = labels[0].clone();
            std::thread::spawn(move || {
                barrier.wait();
                guard
                    .handle_reply(&label, r, QuitAnswer::Clean, None, 1)
                    .unwrap();
            })
        };
        let ticker = {
            let guard = Arc::clone(&guard);
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                guard.tick(QUIT_ACK_TIMEOUT_MS);
            })
        };
        answerer.join().unwrap();
        ticker.join().unwrap();
        // ADR-0035 changes the spec: commit is now preceded by a re-check
        // round. When the answer won, finish that round; when the tick won,
        // the alert owns the request and these answers are refused.
        for label in &labels {
            guard
                .handle_reply(label, r, QuitAnswer::Clean, None, 2)
                .unwrap();
        }
        // ADR-0035 changes the spec: commit is now preceded by a re-check round (and a backstop round).
        // The backstop deadline commits; under the alert the tick is refused.
        guard.tick(2 + crate::services::quit_guard::coordinator::QUIT_BACKSTOP_TIMEOUT_MS);

        let effects = effects_of(&guard);
        let replies: Vec<bool> = effects
            .iter()
            .filter_map(|e| match e {
                Effect::Reply(v) => Some(*v),
                _ => None,
            })
            .collect();
        let fallbacks = effects
            .iter()
            .filter(|e| matches!(e, Effect::NativeFallback(..)))
            .count();
        assert!(
            (replies.len() == 1 && fallbacks == 0) || (replies.is_empty() && fallbacks == 1),
            "iteration {iteration}: a last answer racing a tick must resolve once, \
             either by replying or by handing over; got {effects:?}"
        );
    }
}

// ── WI3-D12 ───────────────────────────────────────────────────────────────────

/// Effects that call back into the guard while they run. If the driver held its
/// lock across the effects, this deadlocks on a non-reentrant `std::Mutex`.
#[derive(Default)]
struct ReentrantEffects {
    log: Mutex<Vec<Effect>>,
    guard: OnceLock<Weak<QuitGuard<ReentrantEffects>>>,
    begins: Mutex<Vec<Begin>>,
}

impl ReentrantEffects {
    fn reenter(&self) {
        if let Some(guard) = self.guard.get().and_then(|w| w.upgrade()) {
            let outcome = guard.begin(&["x"], 0);
            self.begins.lock().unwrap().push(outcome);
            guard.tick(1);
        }
    }
}

impl QuitEffects for ReentrantEffects {
    fn emit_all(&self, event: QuitEvent) -> bool {
        self.log.lock().unwrap().push(Effect::EmitAll(event));
        true
    }
    fn emit_to(&self, label: &str, event: QuitEvent) -> bool {
        self.log
            .lock()
            .unwrap()
            .push(Effect::EmitTo(label.to_string(), event));
        self.reenter();
        true
    }
    fn activate(&self, label: &str) -> bool {
        self.log
            .lock()
            .unwrap()
            .push(Effect::Activate(label.to_string()));
        true
    }
    fn arm_timer(&self, request_id: u64, deadline_ms: u64) {
        self.log
            .lock()
            .unwrap()
            .push(Effect::ArmTimer(request_id, deadline_ms));
    }
    fn reply(&self, terminate: bool) -> bool {
        self.log.lock().unwrap().push(Effect::Reply(terminate));
        self.reenter();
        true
    }
    fn native_fallback(
        &self,
        request_id: u64,
        timed_out: Vec<String>,
        cause: FallbackCause,
    ) -> bool {
        self.log
            .lock()
            .unwrap()
            .push(Effect::NativeFallback(request_id, timed_out, cause));
        true
    }
}

#[test]
fn d12_effects_run_outside_the_coordinator_lock() {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let gate = leak_gate();
        let guard = Arc::new(QuitGuard::with_gate(ReentrantEffects::default(), gate));
        guard
            .effects()
            .guard
            .set(Arc::downgrade(&guard))
            .unwrap_or_else(|_| panic!("guard slot already filled"));

        let r = later(guard.begin(&["A"], 0));
        guard
            .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
            .unwrap();
        guard
            .handle_reply("A", r, QuitAnswer::Discard, Some(vec![]), 2)
            .unwrap();
        // ADR-0035 changes the spec: commit is now preceded by a re-check round.
        guard
            .handle_reply("A", r, QuitAnswer::Clean, None, 3)
            .unwrap();
        // ADR-0035 changes the spec: commit is now preceded by a re-check round (and a backstop round).
        guard.tick(3 + crate::services::quit_guard::coordinator::QUIT_BACKSTOP_TIMEOUT_MS);
        let begins = guard.effects().begins.lock().unwrap().clone();
        let _ = tx.send(begins);
    });

    let begins = rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .expect("the driver deadlocked: effects ran while the coordinator lock was held");

    assert_eq!(
        begins.len(),
        2,
        "expected one re-entrant begin from the prompt and one from the reply"
    );
    assert_eq!(
        begins[0],
        Begin::AlreadyPending,
        "a begin during the pending request must not start a second one"
    );
    assert!(
        matches!(begins[1], Begin::Later { .. }),
        "a begin after the request resolved must start a fresh one, got {:?}",
        begins[1]
    );
}
