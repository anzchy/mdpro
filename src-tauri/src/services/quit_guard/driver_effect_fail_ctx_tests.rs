//! D16F WI-8 (audit rows 12, 15): every `app.quit.effect_failed` context is
//! exactly `{requestId, effect}`, over every effect name, and carries no label.
//!
//! Moved unchanged out of `driver_effect_fail_tests.rs` (rule 50 §6) and
//! registered from it, so it shares that module's script and helpers. Real
//! JSONL file under `HOME_LOCK` in a temp `$HOME`, request ids 8_700 to 8_702.

use super::{assert_counts_only, run_script, CANCELLED, OTHER, REQUESTED};
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    fresh_log_home, guard_at, later, log_lines, set_home,
};
use crate::services::quit_guard::effects::report_dispatch;
use crate::HOME_LOCK;
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// q12c extended to every effect name the driver and the timer can log.
#[test]
fn wi8_every_effect_failed_context_is_request_and_effect_only() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi8q");
    let _home = set_home(&home);
    let guard = guard_at(8_700);
    guard.effects().fail(|f| {
        f.emit_all = vec![REQUESTED, CANCELLED];
        f.activate = true;
        f.reply = true;
        f.native_fallback = true;
        f.emit_to = vec!["w8q2".to_string()];
    });

    run_script(&guard, 8_700, "w8q1");
    let r = later(guard.begin(&["w8q2", OTHER], 10));
    assert_eq!(r, 8_701);
    guard
        .handle_reply("w8q2", r, QuitAnswer::Dirty, None, 11)
        .unwrap();
    guard
        .handle_reply(OTHER, r, QuitAnswer::Clean, None, 12)
        .unwrap();
    report_dispatch(Err::<(), &str>("closed"), 8_702, "timerDispatch");

    let lines: Vec<Value> = log_lines(&home)
        .into_iter()
        .filter(|v| v["event"] == json!("app.quit.effect_failed"))
        .filter(|v| {
            matches!(
                v.pointer("/context/requestId").and_then(Value::as_u64),
                Some(8_700..=8_702)
            )
        })
        .collect();
    let names: BTreeSet<&str> = lines
        .iter()
        .filter_map(|v| v["context"]["effect"].as_str())
        .collect();
    let every = [
        "reply",
        "nativeFallback",
        "emitPrompt",
        "emitRequested",
        "emitCancelled",
        "activate",
        "timerDispatch",
    ];
    assert_eq!(names, BTreeSet::from(every), "lines: {lines:?}");
    for line in &lines {
        let keys: BTreeSet<&str> = line["context"]
            .as_object()
            .expect("context is an object")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, BTreeSet::from(["requestId", "effect"]), "{line}");
        assert_counts_only(line, &["w8q1", "w8q2", OTHER]);
    }
}
