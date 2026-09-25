//! Q13, split out of `driver_deadline_tests.rs` (rule 50 §6): a refused answer
//! is not written to the log as a success.
//!
//! Registered from `driver_deadline_tests.rs`. Runs under `HOME_LOCK` in a temp
//! `$HOME`, reading the real JSONL log.

use crate::models::{LogLevel, LogSettings};
use crate::services::logger;
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, finish_quit, fresh_log_home, later, leak_gate, recording_guard,
    set_home, Effect,
};
use crate::HOME_LOCK;
use serde_json::Value;

#[test]
fn q13_a_refused_answer_is_not_logged_as_a_success() {
    let _home_lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("quit_refused_answer");
    let _home_guard = set_home(&home);
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });

    let gate = leak_gate();
    let guard = recording_guard(gate);
    // Labels no other test uses: a concurrent test writes into this same log.
    let (win, other) = ("q13win", "q13other");
    let r = later(guard.begin(&[win, other], 0));

    // `cancel` before this window was ever prompted: the coordinator refuses it
    // out of phase and the quit carries on. On the device this refusal read as
    // `status:"success"` in the log, so a cancel that did nothing looked like a
    // cancel that worked.
    guard
        .handle_reply(win, r, QuitAnswer::Cancel, None, 1)
        .unwrap();

    let mine = |v: &Value| {
        matches!(
            v.pointer("/context/windowLabel").and_then(Value::as_str),
            Some(l) if l == win || l == other
        )
    };
    let answers = entries_where(&home, "app.quit.answer", r, mine);
    assert_eq!(
        answers.len(),
        1,
        "expected one answer line, got {answers:?}"
    );
    assert_ne!(
        answers[0].get("status").and_then(Value::as_str),
        Some("success"),
        "a refused answer logged as a success makes a broken quit look healthy"
    );
    let text = answers[0].to_string();
    assert!(
        text.contains("outOfPhase") || text.contains("OutOfPhase"),
        "the refusal must say why it was refused: {text}"
    );

    // The refusal really was a refusal: the request is untouched and still
    // completes normally.
    guard
        .handle_reply(win, r, QuitAnswer::Clean, None, 2)
        .unwrap();
    guard
        .handle_reply(other, r, QuitAnswer::Clean, None, 3)
        .unwrap();
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    finish_quit(&guard, r, &[win, other], 4);
    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));

    // An accepted answer is still a success line.
    let accepted = entries_where(&home, "app.quit.answer", r, mine);
    assert!(
        accepted
            .iter()
            .any(|v| v.get("status").and_then(Value::as_str) == Some("success")),
        "an accepted answer must still be logged as a success: {accepted:?}"
    );
}
