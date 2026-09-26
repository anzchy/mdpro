//! ADR-0035 WI-4 (A6): the `app.quit.recheck`, `app.quit.backstop` and
//! `app.quit.commit` lines, `gateWaitMs`, and the two new `effect_failed`
//! names (DL-1 to DL-6).
//!
//! Registered from `driver_tests.rs`. These read the real JSONL log under a
//! temp `$HOME`, holding `HOME_LOCK`; request ids come from the 9_000 to 9_600
//! band this module owns, so no other guard's line can match. DL-4 lives in
//! `driver_backstop_redaction_tests.rs`; this module also registers the WI-4
//! driver specs `driver_backstop_tests.rs` and `driver_recheck_tests.rs`.
//!
//! Law: every context is counts, enums and flags only, with an exact key set;
//! the commit line fails when a deletion failed, a backstop draft failed, a
//! window never answered the backstop, or a window was capped; `gateWaitMs`
//! grows with how long a save held the gate.

use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, fresh_log_home, guard_at, guard_at_with, later, leak_gate, set_home,
    Effect, RecordingEffects,
};
use crate::HOME_LOCK;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::sync::mpsc;
use std::time::Duration;

const BACKSTOP_MS: u64 = crate::services::quit_guard::coordinator::QUIT_BACKSTOP_TIMEOUT_MS;

pub(super) fn all(_: &Value) -> bool {
    true
}

pub(super) fn keys(v: &Value) -> BTreeSet<String> {
    v.as_object()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

pub(super) fn set(list: &[&str]) -> BTreeSet<String> {
    list.iter().map(|s| s.to_string()).collect()
}

pub(super) fn commit_line(home: &std::path::Path, r: u64) -> Value {
    let lines = entries_where(home, "app.quit.commit", r, all);
    assert_eq!(lines.len(), 1, "expected one commit line: {lines:?}");
    lines[0].clone()
}

/// Windows `a` and `b`, clean twice: the backstop was issued at 3.
fn to_backstop(guard: &QuitGuard<RecordingEffects>) -> u64 {
    let r = later(guard.begin(&["a", "b"], 0));
    for (label, now) in [("a", 0), ("b", 1), ("a", 2), ("b", 3)] {
        guard
            .handle_reply(label, r, QuitAnswer::Clean, None, now)
            .unwrap();
    }
    r
}

/// `Reply(true)`s since the latest request began. The requests `guard_at`
/// burnt to reach its floor each committed and replied too; they come first.
pub(super) fn replies(guard: &QuitGuard<RecordingEffects>) -> usize {
    let effects = effects_of(guard);
    let began = effects
        .iter()
        .rposition(|e| matches!(e, Effect::EmitAll(QuitEvent::Requested { round: 0, .. })))
        .unwrap_or(0);
    effects[began..]
        .iter()
        .filter(|e| matches!(e, Effect::Reply(true)))
        .count()
}

// ── DL-1 ──────────────────────────────────────────────────────────────────────

#[test]
fn dl1_a_silent_backstop_window_makes_the_commit_line_fail_with_draft_missing() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("dl1");
    let _home = set_home(&home);
    let guard = guard_at(9_000);
    let r = to_backstop(&guard);
    assert_eq!(r, 9_000, "guard_at did not land on its floor");
    guard.handle_drafted("a", r, (1, 0), 4);
    guard.tick(3 + BACKSTOP_MS);

    assert_eq!(replies(&guard), 1);
    let line = commit_line(&home, r);
    assert_eq!(line["status"], "fail", "{line}");
    assert_eq!(line["level"], "error", "{line}");
    let wait = line["context"]["gateWaitMs"].as_u64();
    assert!(wait.is_some(), "gateWaitMs must be an integer: {line}");
    // ADR-0035 review M-1: the commit context gains the `undiscarded` count, so the exact key set grows by one.
    assert_eq!(
        line["context"],
        json!({
            "requestId": r, "deleted": 0, "failed": 0, "drafted": 1, "draftFailed": 0,
            "draftMissing": 1, "capped": 0, "backstop": true, "gateWaitMs": wait,
            "undiscarded": 0
        })
    );
    let error = line["error"].as_str().unwrap_or_default();
    assert!(
        error.contains('1'),
        "the error must carry the count: {line}"
    );
    for id in ["a", "b"] {
        assert!(
            !error.split_whitespace().any(|w| w == id),
            "the error names a window: {error}"
        );
    }
}

// ── DL-2 ──────────────────────────────────────────────────────────────────────

#[test]
fn dl2_drafted_with_failures_makes_the_commit_line_fail_and_still_replies_yes() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("dl2");
    let _home = set_home(&home);
    let guard = guard_at(9_100);
    let r = later(guard.begin(&["a"], 0));
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 1)
        .unwrap();
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 2)
        .unwrap();
    guard.handle_drafted("a", r, (2, 2), 3);

    assert_eq!(replies(&guard), 1);
    let line = commit_line(&home, r);
    assert_eq!(line["status"], "fail", "{line}");
    assert_eq!(line["context"]["drafted"], 2, "{line}");
    assert_eq!(line["context"]["draftFailed"], 2, "{line}");
}

// ── DL-3 ──────────────────────────────────────────────────────────────────────

#[test]
fn dl3_a_clean_backstop_logs_success() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("dl3");
    let _home = set_home(&home);
    let guard = guard_at(9_200);
    let r = later(guard.begin(&["a"], 0));
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 1)
        .unwrap();
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 2)
        .unwrap();
    guard.handle_drafted("a", r, (0, 0), 3);

    let line = commit_line(&home, r);
    assert_eq!(line["status"], "success", "{line}");
    assert!(
        line.get("error").filter(|e| !e.is_null()).is_none(),
        "{line}"
    );
}

// ── DL-5 ──────────────────────────────────────────────────────────────────────

const HOLD: Duration = Duration::from_millis(600);
const THRESHOLD_MS: u64 = 300;

#[test]
fn dl5_gate_wait_ms_measures_a_contended_close() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("dl5");
    let _home = set_home(&home);

    let gate = leak_gate();
    let contended = guard_at_with(9_400, gate);
    let r1 = later(contended.begin(&["a"], 0));
    contended
        .handle_reply("a", r1, QuitAnswer::Clean, None, 1)
        .unwrap();
    contended
        .handle_reply("a", r1, QuitAnswer::Clean, None, 2)
        .unwrap();
    let (tx, rx) = mpsc::channel();
    let holder = std::thread::spawn(move || {
        gate.if_open(|| {
            tx.send(()).unwrap();
            std::thread::sleep(HOLD);
        })
    });
    rx.recv().unwrap();
    contended.handle_drafted("a", r1, (0, 0), 3);
    holder.join().unwrap();

    let uncontended = guard_at(9_500);
    let r2 = later(uncontended.begin(&["a"], 0));
    uncontended
        .handle_reply("a", r2, QuitAnswer::Clean, None, 1)
        .unwrap();
    uncontended
        .handle_reply("a", r2, QuitAnswer::Clean, None, 2)
        .unwrap();
    uncontended.handle_drafted("a", r2, (0, 0), 3);

    let wait = |r| commit_line(&home, r)["context"]["gateWaitMs"].as_u64();
    let slow = wait(r1).expect("contended gateWaitMs must be an integer");
    let fast = wait(r2).expect("uncontended gateWaitMs must be an integer");
    assert!(slow >= THRESHOLD_MS, "contended wait {slow}ms");
    assert!(fast < THRESHOLD_MS, "uncontended wait {fast}ms");
}

// ── DL-6 ──────────────────────────────────────────────────────────────────────

#[test]
fn dl6_effect_failed_names_emit_recheck_and_emit_backstop() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("dl6");
    let _home = set_home(&home);

    for (floor, call, name) in [(9_600, 2, "emitRecheck"), (9_601, 3, "emitBackstop")] {
        let guard = guard_at(floor);
        // The burnt requests broadcast too: count this request's calls from here.
        let burnt = effects_of(&guard)
            .iter()
            .filter(|e| matches!(e, Effect::EmitAll(_)))
            .count();
        guard
            .effects()
            .fail(|f| f.emit_all_calls = vec![burnt + call]);
        let r = later(guard.begin(&["a"], 0));
        assert_eq!(r, floor, "guard_at did not land on its floor");
        guard
            .handle_reply("a", r, QuitAnswer::Clean, None, 1)
            .unwrap();
        guard
            .handle_reply("a", r, QuitAnswer::Clean, None, 2)
            .unwrap();

        let lines = entries_where(&home, "app.quit.effect_failed", r, all);
        assert_eq!(lines.len(), 1, "{name}: {lines:?}");
        assert_eq!(lines[0]["context"]["effect"], name, "{name}");
    }
}

// The other ADR-0035 WI-4 (and WI-5) driver specifications, registered here because
// `driver_tests.rs` is at its line budget.
#[path = "driver_backstop_tests.rs"]
mod driver_backstop_tests;
#[path = "driver_drafted_reply_tests.rs"]
mod driver_drafted_reply_tests;
#[path = "driver_recheck_tests.rs"]
mod driver_recheck_tests;
