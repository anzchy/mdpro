//! Specification for the driver half of ADR-0029: cases WI-BLOCK1-Q9 .. Q13.
//!
//! The coordinator owns every deadline; this file pins that the driver actually
//! arms the one it is handed, that an effect which could not be dispatched is
//! seen rather than discarded, and that a refused answer is not written to the
//! log as a success. Q13 lives in `driver_refused_answer_tests.rs`.
//!
//! The log-reading cases run under `HOME_LOCK` in a temp `$HOME`, the same way
//! `services::logger`'s own atomicity test does: `log_path()` resolves through
//! `dirs::home_dir()`, so a temp HOME makes the real JSONL file the assertion
//! surface without touching the developer's own log.

use super::driver::*;
use super::driver_fixtures::{
    effects_of, entries_where, finish_quit, fresh_log_home, later, leak_gate, recording_guard,
    set_home, Effect,
};
use super::logging::effect_failure_log_context;
use crate::models::{LogLevel, LogSettings};
use crate::services::logger;
use crate::HOME_LOCK;
use serde_json::Value;

// ── Q9: the prompt's deadline is armed, after the window is fronted ──────────

#[test]
fn q9_a_prompt_arms_the_timer_with_the_coordinators_deadline() {
    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();

    // Phase 1 closes at 1900, which is inside the ack budget but nearly spends
    // it. The prompt's own budget starts here, not at 0.
    guard
        .handle_reply("B", r, QuitAnswer::Clean, None, 1_900)
        .unwrap();

    assert_eq!(
        effects_of(&guard),
        vec![
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitAll(QuitEvent::Requested {
                request_id: r,
                round: 0
            }),
            Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS),
            Effect::Activate("A".to_string()),
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitTo(
                "A".to_string(),
                QuitEvent::Prompt {
                    request_id: r,
                    round: 0
                }
            ),
            Effect::ArmTimer(r, 1_900 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS),
        ],
        "the prompt must front the window, ask it, and then arm its delivery deadline"
    );
}

// ── Q10: a prompt that could not be delivered ────────────────────────────────

#[test]
fn q10_an_undeliverable_prompt_goes_to_the_alert_and_arms_nothing() {
    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));
    guard.effects().fail(|f| f.emit_to.push("A".to_string()));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Clean, None, 2)
        .unwrap();

    assert_eq!(
        effects_of(&guard),
        vec![
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitAll(QuitEvent::Requested {
                request_id: r,
                round: 0
            }),
            Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS),
            Effect::Activate("A".to_string()),
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitTo(
                "A".to_string(),
                QuitEvent::Prompt {
                    request_id: r,
                    round: 0
                }
            ),
            Effect::NativeFallback(r, vec!["A".to_string()]),
        ],
        "an undeliverable prompt must not be waited on: no timer, straight to the alert"
    );
}

// ── Q11: an early tick re-arms and does nothing else ─────────────────────────

#[test]
fn q11_an_early_tick_re_arms_and_has_no_other_effect() {
    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));
    let after_begin = effects_of(&guard);

    guard.tick(1);
    let after_tick = effects_of(&guard);
    assert_eq!(
        after_tick[after_begin.len()..],
        [Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS)],
        "an early tick must put the request's wake-up back, and nothing more"
    );

    // And the re-armed deadline still fires.
    guard.tick(QUIT_ACK_TIMEOUT_MS);
    let end = effects_of(&guard);
    assert_eq!(
        end[after_tick.len()..],
        [Effect::NativeFallback(
            r,
            vec!["A".to_string(), "B".to_string()]
        )]
    );
}

// ── Q12: an alert that could not be posted must not strand the request ───────

#[test]
fn q12_a_native_fallback_that_was_not_dispatched_leaves_the_request_answerable() {
    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));
    guard.effects().fail(|f| f.native_fallback = true);
    guard
        .handle_reply("A", r, QuitAnswer::Clean, None, 1)
        .unwrap();
    guard.tick(QUIT_ACK_TIMEOUT_MS);
    let after_fallback = effects_of(&guard);
    assert_eq!(
        after_fallback.last(),
        Some(&Effect::NativeFallback(r, vec!["B".to_string()])),
        "the tick still tries the alert"
    );

    // The alert is not on screen, so it cannot own the request: B must still be
    // heard. Believing an alert that was never posted is how the app becomes
    // unquittable with nothing on screen to explain it.
    guard
        .handle_reply("B", r, QuitAnswer::Dirty, None, 2_001)
        .unwrap();
    assert_eq!(
        effects_of(&guard)[after_fallback.len()..],
        [
            Effect::Activate("B".to_string()),
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitTo(
                "B".to_string(),
                QuitEvent::Prompt {
                    request_id: r,
                    round: 0
                }
            ),
            Effect::ArmTimer(r, 2_001 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS),
        ],
        "a request the alert never took must carry on through phase 2"
    );

    guard
        .handle_reply("B", r, QuitAnswer::Discard, Some(vec![]), 2_002)
        .unwrap();
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    finish_quit(&guard, r, &["A", "B"], 2_003);
    assert_eq!(
        effects_of(&guard).last(),
        Some(&Effect::Reply(true)),
        "and it must still reach the NSApp reply"
    );
}

// ── Q12b / Q13: what the log says when an effect or an answer fails ──────────

#[test]
fn q12b_an_effect_that_was_not_dispatched_is_logged_as_a_failure() {
    let _home_lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("quit_effect_failed");
    let _home_guard = set_home(&home);
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });

    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A"], 0));
    guard.effects().fail(|f| f.reply = true);
    guard
        .handle_reply("A", r, QuitAnswer::Clean, None, 1)
        .unwrap();
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    finish_quit(&guard, r, &["A"], 2);

    // The quit committed: the gate is closed and AppKit was asked exactly once.
    assert!(gate.is_closed());
    assert_eq!(
        effects_of(&guard)
            .iter()
            .filter(|e| matches!(e, Effect::Reply(_)))
            .count(),
        1
    );

    // A reply AppKit never received is the unquittable case, so it cannot be
    // silent — this is the one line a support log has to show.
    let failures = entries_where(&home, "app.quit.effect_failed", r, |v| {
        v.pointer("/context/effect").and_then(Value::as_str) == Some("reply")
    });
    assert_eq!(
        failures.len(),
        1,
        "expected exactly one effect_failed line, got {failures:?}"
    );
    assert_eq!(
        failures[0]
            .pointer("/context/effect")
            .and_then(Value::as_str),
        Some("reply")
    );
    assert_eq!(
        failures[0].get("level").and_then(Value::as_str),
        Some("error"),
        "a liveness failure is not an info line"
    );
    assert_eq!(
        failures[0].get("status").and_then(Value::as_str),
        Some("fail")
    );
}

#[test]
fn q12c_the_effect_failure_context_carries_the_request_and_the_effect_only() {
    // Same rule as every other quit log line: ids, counts and statuses only.
    // The effect name is the driver's own constant, never a webview value.
    for effect in ["reply", "nativeFallback"] {
        let context = effect_failure_log_context(7, effect);
        let map = context.as_object().expect("context is an object");
        assert_eq!(map.len(), 2, "unexpected keys in {context}");
        assert_eq!(map.get("requestId").and_then(Value::as_u64), Some(7));
        assert_eq!(map.get("effect").and_then(Value::as_str), Some(effect));
    }
}

#[path = "driver_refused_answer_tests.rs"]
mod driver_refused_answer_tests;
