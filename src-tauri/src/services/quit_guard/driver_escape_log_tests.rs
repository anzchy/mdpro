//! WI-3 (plan-20260925-155408): the `app.quit.escape` lines the driver writes,
//! read back from a real JSONL log in a temp `$HOME`.
//!
//! Law: one escape line per `escape()` / `deliver_escape` call, Info /
//! `success`, counts only; its phase, round and count are the ones the ruling
//! saw under the same lock; a rescued request never also logs a timeout.

use super::fixtures::{
    alerts_for, escape_lines, escape_lines_for, in_home, raw_escape_lines, to_backstop_guard,
    to_recheck_with_discard,
};
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, finish_quit, guard_at, later, log_lines, Effect, RecordingEffects,
};
use crate::HOME_LOCK;
use serde_json::{json, Value};

fn info_success(line: &Value) {
    assert_eq!(line["level"], "info", "{line}");
    assert_eq!(line["status"], "success", "{line}");
}

#[test]
fn dx3_recheck_escape_logs_round_1() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx3");
    let g = guard_at(10_100);
    let r = to_recheck_with_discard(&g);

    g.escape();

    assert_eq!(
        effects_of(&g).last(),
        Some(&Effect::NativeFallback(
            r,
            vec!["a".to_string()],
            FallbackCause::Escape
        ))
    );
    let lines = escape_lines_for(&home, r);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(
        lines[0]["context"],
        json!({"outcome": "fallback", "phase": "checking", "requestId": r,
               "round": 1, "unresolvedCount": 1})
    );
}

#[test]
fn dx4_escape_line_counts_only_and_no_timeout_line() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx4");
    let g = guard_at(10_150);
    let r = later(g.begin(&["lbl-q7a", "lbl-q7b", "lbl-q7c"], 0));
    g.handle_reply("lbl-q7a", r, QuitAnswer::Clean, None, 1)
        .unwrap();

    g.escape();

    let lines = escape_lines_for(&home, r);
    assert_eq!(lines.len(), 1, "{lines:?}");
    let ctx = &lines[0]["context"];
    assert_eq!(ctx["outcome"], "fallback");
    assert_eq!(ctx["phase"], "checking");
    assert_eq!(ctx["unresolvedCount"], 2);
    info_success(&lines[0]);
    for raw in raw_escape_lines(&home) {
        assert!(!raw.contains("lbl-q7"), "a label leaked: {raw}");
    }
    assert!(entries_where(&home, "app.quit.timeout", r, |_| true).is_empty());
}

#[test]
fn dx8c_failed_alert_logs_escape_before_effect_failed() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx8c");
    let g = guard_at(10_450);
    let r = later(g.begin(&["solo"], 0));
    g.effects().fail(|f| f.native_fallback = true);

    g.escape();

    let watched = [
        "app.quit.escape",
        "app.quit.effect_failed",
        "app.quit.timeout",
    ];
    let lines: Vec<Value> = log_lines(&home)
        .into_iter()
        .filter(|v| {
            v.pointer("/context/requestId").and_then(Value::as_u64) == Some(r)
                && watched.contains(&v["event"].as_str().unwrap_or(""))
        })
        .collect();
    let events: Vec<&str> = lines.iter().map(|v| v["event"].as_str().unwrap()).collect();
    assert_eq!(
        events,
        ["app.quit.escape", "app.quit.effect_failed"],
        "{lines:?}"
    );
    assert_eq!(lines[0]["context"]["outcome"], "fallback");
    info_success(&lines[0]);
    assert_eq!(lines[1]["context"]["effect"], "nativeFallback");
    assert_eq!(lines[1]["level"], "error");
    assert_eq!(lines[1]["status"], "fail");
}

#[test]
fn dx9_double_escape_posts_one_alert_and_logs_fallback_owns() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx9");
    let g = guard_at(10_500);
    let r = later(g.begin(&["a", "b"], 0));

    g.escape();
    g.escape();

    assert_eq!(alerts_for(&effects_of(&g), r).len(), 1);
    let lines = escape_lines_for(&home, r);
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert_eq!(lines[0]["context"]["outcome"], "fallback");
    assert_eq!(
        lines[1]["context"],
        json!({"outcome": "ignored", "phase": "fallback", "reason": "fallbackOwns",
               "requestId": r, "round": 0, "unresolvedCount": 2})
    );
    info_success(&lines[1]);
}

#[test]
fn dx10a_idle_escape_records_nothing_and_logs_noop() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx10a");
    let g = guard_at(1); // logging on, nothing burnt

    g.escape();

    assert!(effects_of(&g).is_empty(), "{:?}", effects_of(&g));
    let lines = escape_lines(&home);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(
        lines[0]["context"],
        json!({"outcome": "noop", "phase": "idle", "unresolvedCount": 0})
    );
    info_success(&lines[0]);
}

#[test]
fn dx10b_escape_after_commit_is_noop() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx10b");
    let g = guard_at(10_550);
    let r = later(g.begin(&["a"], 0));
    g.handle_reply("a", r, QuitAnswer::Clean, None, 1).unwrap();
    finish_quit(&g, r, &["a"], 2);
    let replies = |g: &QuitGuard<RecordingEffects>| {
        effects_of(g)
            .iter()
            .filter(|e| matches!(e, Effect::Reply(_)))
            .count()
    };
    let before = replies(&g);
    let mark = effects_of(&g).len();

    g.escape();

    assert_eq!(effects_of(&g).len(), mark, "{:?}", &effects_of(&g)[mark..]);
    assert_eq!(replies(&g), before);
    let lines = escape_lines(&home);
    let newest = lines.last().expect("an escape line");
    assert_eq!(newest["context"]["outcome"], "noop");
    assert_eq!(newest["context"]["phase"], "idle");
    assert!(newest["context"].get("requestId").is_none(), "{newest}");
}

#[test]
fn dx10c_backstop_escape_records_nothing_and_logs_out_of_phase() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx10c");
    let (g, r) = to_backstop_guard(10_600);
    let snap = g.snapshot();
    let mark = effects_of(&g).len();

    g.escape();

    assert_eq!(effects_of(&g).len(), mark, "{:?}", &effects_of(&g)[mark..]);
    assert_eq!(g.snapshot(), snap);
    let lines = escape_lines_for(&home, r);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(
        lines[0]["context"],
        json!({"outcome": "ignored", "phase": "backstop", "reason": "outOfPhase",
               "requestId": r, "round": 1, "unresolvedCount": 2})
    );
}

#[test]
fn dx11_deliver_escape_none_logs_no_guard() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx11");
    let _logging_on = guard_at(1);

    deliver_escape::<QuitGuard<RecordingEffects>>(None);

    let lines = escape_lines(&home);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(
        lines[0]["context"],
        json!({"outcome": "noop", "phase": "idle", "unresolvedCount": 0, "reason": "noGuard"})
    );
    info_success(&lines[0]);
}

/// G5: `Some` is the direct call and nothing else — no extra `noGuard` line.
#[test]
fn dx12b_deliver_escape_some_idle_writes_exactly_one_noop_line() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx12b-idle");
    let g = guard_at(1);

    deliver_escape(Some(&g));

    assert!(effects_of(&g).is_empty());
    let lines = escape_lines(&home);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(
        lines[0]["context"],
        json!({"outcome": "noop", "phase": "idle", "unresolvedCount": 0})
    );
}

#[path = "driver_escape_prop_tests.rs"]
mod prop;
