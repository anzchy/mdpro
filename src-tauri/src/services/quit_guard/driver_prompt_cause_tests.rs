//! D16F WI-7 (audit row 24): a prompt that could not be delivered is logged as
//! what it is, not as a 2000 ms timeout.
//!
//! Law, per request: an immediate `emit_to` failure gives one
//! `app.quit.effect_failed {effect:"emitPrompt"}` line and no `app.quit.timeout`
//! line; an elapsed deadline gives one timeout line and no `emitPrompt` line.
//! Both end in the same native alert.
//!
//! Real JSONL file under `HOME_LOCK` in a temp `$HOME`. Request ids come from
//! the 7_000 band this module owns (`guard_at`), so no other guard's line can
//! match.

use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, fresh_log_home, guard_at, later, log_lines, set_home, Effect,
    RecordingEffects,
};
use crate::HOME_LOCK;
use serde_json::{json, Value};
use std::path::Path;

const OTHER: &str = "wi7other";

fn all(_: &Value) -> bool {
    true
}

/// `win` dirty, `OTHER` clean, so `win` is prompted. When `fail_emit` the
/// prompt cannot be handed over; otherwise the delivery deadline is ticked.
/// Returns the effects after the burn baseline.
fn run_case(
    guard: &QuitGuard<RecordingEffects>,
    floor: u64,
    win: &str,
    fail_emit: bool,
) -> Vec<Effect> {
    let base = effects_of(guard).len();
    let r = later(guard.begin(&[win, OTHER], 0));
    assert_eq!(r, floor, "guard did not hand out the expected request id");
    if fail_emit {
        guard.effects().fail(|f| f.emit_to.push(win.to_string()));
    }
    guard
        .handle_reply(win, r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply(OTHER, r, QuitAnswer::Clean, None, 2)
        .unwrap();
    if !fail_emit {
        let deadline = match effects_of(guard).last() {
            Some(Effect::ArmTimer(id, at)) if *id == r => *at,
            other => panic!("a delivered prompt must arm its deadline, got {other:?}"),
        };
        guard.tick(deadline);
    }
    let trace = effects_of(guard)[base..].to_vec();
    assert_eq!(
        trace.last(),
        Some(&Effect::NativeFallback(r, vec![win.to_string()])),
        "request {r} must end at the native alert"
    );
    trace
}

fn timeouts(home: &Path, r: u64) -> Vec<Value> {
    entries_where(home, "app.quit.timeout", r, all)
}

fn emit_prompt_failures(home: &Path, r: u64) -> Vec<Value> {
    entries_where(home, "app.quit.effect_failed", r, |v| {
        v.pointer("/context/effect") == Some(&json!("emitPrompt"))
    })
}

fn effect_failures(home: &Path, r: u64) -> Vec<Value> {
    entries_where(home, "app.quit.effect_failed", r, all)
}

/// The set of quit event names logged for `r` from the prompt onward.
fn cause_events(home: &Path, r: u64) -> Vec<String> {
    let mut names: Vec<String> = log_lines(home)
        .iter()
        .filter(|v| v.pointer("/context/requestId") == Some(&json!(r)))
        .filter_map(|v| {
            let event = v["event"].as_str()?;
            match event {
                "app.quit.timeout" => Some("timeout".to_string()),
                "app.quit.effect_failed" => v["context"]["effect"].as_str().map(str::to_string),
                _ => None,
            }
        })
        .collect();
    names.sort();
    names
}

fn assert_counts_only(line: &Value, labels: &[&str]) {
    let raw = line.to_string();
    for marker in labels.iter().chain(["burn"].iter()) {
        assert!(!raw.contains(marker), "{marker:?} leaked into {raw}");
    }
}

#[test]
fn wi7_immediate_emit_failure_logs_emit_prompt_and_no_timeout() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi7a");
    let _home = set_home(&home);
    let guard = guard_at(7_000);

    let trace = run_case(&guard, 7_000, "wi7a", true);

    let r = 7_000;
    assert_eq!(
        trace,
        vec![
            Effect::EmitAll(QuitEvent::Requested { request_id: r }),
            Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS),
            Effect::Activate("wi7a".to_string()),
            Effect::EmitTo("wi7a".to_string(), QuitEvent::Prompt { request_id: r }),
            Effect::NativeFallback(r, vec!["wi7a".to_string()]),
        ],
        "the q10 trace must be unchanged"
    );
    let failed = emit_prompt_failures(&home, r);
    assert_eq!(failed.len(), 1, "expected one emitPrompt line: {failed:?}");
    assert_eq!(
        failed[0]["context"],
        json!({ "requestId": r, "effect": "emitPrompt" })
    );
    assert_counts_only(&failed[0], &["wi7a", OTHER]);
    assert_eq!(
        timeouts(&home, r),
        Vec::<Value>::new(),
        "a delivery failure is not a timeout"
    );
}

#[test]
fn wi7_real_deadline_logs_one_timeout_and_no_effect_failed() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi7b");
    let _home = set_home(&home);
    let guard = guard_at(7_100);

    run_case(&guard, 7_100, "wi7b", false);

    let lines = timeouts(&home, 7_100);
    assert_eq!(lines.len(), 1, "expected one timeout line: {lines:?}");
    assert_eq!(lines[0]["error"], json!("no ack within 2000ms"));
    assert_counts_only(&lines[0], &["wi7b", OTHER]);
    assert_eq!(effect_failures(&home, 7_100), Vec::<Value>::new());
}

/// Metamorphic: same shape, different cause. The traces agree once the ids
/// are mapped and the delivered prompt's own deadline (`ArmTimer` after the
/// `EmitTo`, which q10 pins as absent for an undelivered prompt) is set aside;
/// the logged causes differ by exactly `{emitPrompt}` versus `{timeout}`.
#[test]
fn wi7_metamorphic_same_shape_different_cause() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi7m");
    let _home = set_home(&home);

    let failed = run_case(&guard_at(7_200), 7_200, "wi7m", true);
    let elapsed = run_case(&guard_at(7_300), 7_300, "wi7m", false);

    let normalise = |trace: Vec<Effect>, r: u64| -> Vec<Effect> {
        let mut seen_prompt = false;
        trace
            .into_iter()
            .filter(|e| {
                let keep = !(seen_prompt && matches!(e, Effect::ArmTimer(..)));
                seen_prompt |= matches!(e, Effect::EmitTo(..));
                keep
            })
            .map(|e| match e {
                Effect::EmitAll(QuitEvent::Requested { request_id }) if request_id == r => {
                    Effect::EmitAll(QuitEvent::Requested { request_id: 0 })
                }
                Effect::EmitTo(l, QuitEvent::Prompt { request_id }) if request_id == r => {
                    Effect::EmitTo(l, QuitEvent::Prompt { request_id: 0 })
                }
                Effect::ArmTimer(id, at) if id == r => Effect::ArmTimer(0, at),
                Effect::NativeFallback(id, t) if id == r => Effect::NativeFallback(0, t),
                other => other,
            })
            .collect()
    };
    assert_eq!(normalise(failed, 7_200), normalise(elapsed, 7_300));
    assert_eq!(cause_events(&home, 7_200), vec!["emitPrompt".to_string()]);
    assert_eq!(cause_events(&home, 7_300), vec!["timeout".to_string()]);
}

/// [ADV1-6] The cause is decided per request: a delivery failure on r1 must
/// not suppress the timeout line of a later request on the same guard.
#[test]
fn wi7_cause_is_per_request_not_a_sticky_guard_flag() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi7s");
    let _home = set_home(&home);
    let guard = guard_at(7_400);

    run_case(&guard, 7_400, "wi7s1", true);
    guard.fallback_answer(7_400, FallbackAnswer::KeepOpen);
    // Same guard: `emit_to` still fails for `wi7s1` only, so r2's prompt is
    // handed over and its deadline elapses.
    run_case(&guard, 7_401, "wi7s2", false);

    assert_eq!(timeouts(&home, 7_400).len(), 0, "r1 was not a timeout");
    assert_eq!(emit_prompt_failures(&home, 7_400).len(), 1, "r1 emitPrompt");
    assert_eq!(timeouts(&home, 7_401).len(), 1, "r2 is a real timeout");
    assert_eq!(
        emit_prompt_failures(&home, 7_401).len(),
        0,
        "r2 was delivered"
    );
}
