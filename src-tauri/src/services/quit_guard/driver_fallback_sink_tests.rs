//! D16F WI-6: the `app.quit.fallback` context builder, the macOS alert's call
//! site `deliver_fallback` ([ADV1-3], [ADV1-4]) and the static wiring check
//! [ADV1-5] (c) and (f).
//!
//! Law: exactly one `app.quit.fallback` line per call. `None` always gives a
//! `"noGuard"` fail and touches no state; `Some(g)` is observationally
//! identical to calling `g.fallback_answer` directly.

use super::driver_fallback_log_tests::assert_fallback_line;
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, fresh_log_home, guard_at, later, set_home, Effect, RecordingEffects,
};
use crate::services::quit_guard::logging::{fallback_log_context, log_fallback_no_guard};
use crate::HOME_LOCK;
use serde_json::json;

#[test]
fn wi6_context_builder_maps_every_answer_to_its_bare_wire_string() {
    for answer in [FallbackAnswer::KeepOpen, FallbackAnswer::QuitAnyway] {
        // Exhaustive on purpose: a new variant must not compile past this.
        let expected = match answer {
            FallbackAnswer::KeepOpen => "keepOpen",
            FallbackAnswer::QuitAnyway => "quitWithoutSaving",
        };
        let context = fallback_log_context(42, answer);
        assert_eq!(context, json!({ "requestId": 42, "answer": expected }));
        let keys: Vec<&String> = context.as_object().expect("an object").keys().collect();
        assert_eq!(keys.len(), 2, "exactly requestId and answer: {context}");
    }
}

#[test]
fn wi6_no_guard_line_shape() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi6noguard");
    let _home = set_home(&home);
    let _floor = guard_at(1); // turns logging on at Info; burns nothing

    log_fallback_no_guard(6_900, FallbackAnswer::KeepOpen);

    assert_fallback_line(&home, 6_900, FallbackAnswer::KeepOpen, Some("noGuard"));
}

#[test]
fn adv1_3_none_writes_exactly_one_no_guard_fail_line() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi6none");
    let _home = set_home(&home);
    let _floor = guard_at(1);

    deliver_fallback::<QuitGuard<RecordingEffects>>(None, 6_950, FallbackAnswer::QuitAnyway);

    let line = assert_fallback_line(&home, 6_950, FallbackAnswer::QuitAnyway, Some("noGuard"));
    assert_eq!(
        line["context"],
        json!({ "requestId": 6_950, "answer": "quitWithoutSaving" })
    );
}

/// The q10 shape at `floor`: the prompt cannot be delivered, so the alert owns it.
fn in_fallback(floor: u64) -> QuitGuard<RecordingEffects> {
    let guard = guard_at(floor);
    let r = later(guard.begin(&["wi6s", "wi6t"], 0));
    assert_eq!(r, floor, "guard_at did not land on its floor");
    guard.effects().fail(|f| f.emit_to.push("wi6s".to_string()));
    guard
        .handle_reply("wi6s", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("wi6t", r, QuitAnswer::Clean, None, 2)
        .unwrap();
    assert!(matches!(
        effects_of(&guard).last(),
        Some(Effect::NativeFallback(..))
    ));
    guard
}

#[test]
fn adv1_4_some_delegates_with_the_same_outcome_as_fallback_answer() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi6some");
    let _home = set_home(&home);
    let a = in_fallback(6_960);
    let b = in_fallback(6_970);
    let (base_a, base_b) = (effects_of(&a).len(), effects_of(&b).len());

    deliver_fallback(Some(&a), 6_960, FallbackAnswer::KeepOpen);
    b.fallback_answer(6_970, FallbackAnswer::KeepOpen);

    let tail = |id: u64| {
        vec![
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitAll(QuitEvent::Cancelled {
                request_id: id,
                round: 0,
            }),
            Effect::Reply(false),
        ]
    };
    assert_eq!(effects_of(&a)[base_a..], tail(6_960)[..]);
    assert_eq!(effects_of(&b)[base_b..], tail(6_970)[..]);
    assert_eq!(
        format!("{:?}", a.snapshot()).replace("6960", "ID"),
        format!("{:?}", b.snapshot()).replace("6970", "ID"),
        "deliver_fallback(Some) must leave the same state as a direct call"
    );
    assert_fallback_line(&home, 6_960, FallbackAnswer::KeepOpen, None);
    let no_guard = entries_where(&home, "app.quit.fallback", 6_960, |v| {
        v["error"] == "noGuard"
    });
    assert!(
        no_guard.is_empty(),
        "Some must never log noGuard: {no_guard:?}"
    );
}

/// [ADV1-5] (c) and (f): the alert's answer reaches the guard only through
/// `deliver_fallback`, so a missing guard cannot drop it silently.
#[test]
fn adv1_5_macos_routes_the_alert_answer_through_deliver_fallback() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/services/quit_guard/macos.rs"
    );
    let source = std::fs::read_to_string(path).expect("macos.rs is readable");
    let calls = |needle: &str| source.lines().filter(|l| l.contains(needle)).count();
    assert!(
        calls("deliver_fallback(") >= 1,
        "(c) macos.rs must call deliver_fallback"
    );
    assert_eq!(
        calls(".fallback_answer("),
        0,
        "(f) no direct fallback_answer call in macos.rs"
    );
}
