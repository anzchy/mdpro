//! Fallback cause, corollary (ii): nothing about the cause is left behind
//! (plan-20260925-232104 WI-2).
//! - fc7/fc8: within one request, across `release_fallback`, each attempt
//!   carries its own producer's cause.
//! - fc10/fc10b: an escape the driver does **not** rule `fallback` — an idle
//!   `noop`, `ignored/fallbackOwns`, `ignored/outOfPhase` — leaves no cause for
//!   the next genuine timeout alert. ADR-0036 keeps the menu item always
//!   enabled, so an idle press is a normal action.
//!
//! Split from `driver_fallback_cause_tests.rs` under rule 50 §6.

use super::super::fixtures::{
    alert_causes_for, escape_lines, escape_lines_for, in_home, to_backstop_guard,
};
use super::{effect_failed, fallback_escapes, fallback_on, s, timeouts};
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{effects_of, guard_at, later, Effect};
use crate::HOME_LOCK;
use serde_json::json;
use FallbackCause::{Escape, Timeout};

#[test]
fn fc10_an_idle_or_fallback_owns_escape_leaves_no_cause_behind() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc10");
    let g = guard_at(11_900);

    g.escape(); // idle: no request
    let r1 = later(g.begin(&["a"], 0));
    g.tick(QUIT_ACK_TIMEOUT_MS);
    g.fallback_answer(r1, FallbackAnswer::KeepOpen);
    let r2 = later(g.begin(&["a"], 10));
    g.tick(10 + QUIT_ACK_TIMEOUT_MS);
    g.escape(); // refused: the timer's alert owns r2
    g.fallback_answer(r2, FallbackAnswer::KeepOpen);
    let r3 = later(g.begin(&["a"], 20));
    g.tick(20 + QUIT_ACK_TIMEOUT_MS);

    assert_eq!((r1, r2, r3), (11_900, 11_901, 11_902));
    let e = effects_of(&g);
    for r in [r1, r2, r3] {
        assert_eq!(alert_causes_for(&e, r), [Timeout], "request {r}");
        assert_eq!(timeouts(&home, r), 1, "request {r}");
    }
    let lines = escape_lines(&home);
    assert_eq!(
        lines[0]["context"],
        json!({"outcome": "noop", "phase": "idle", "unresolvedCount": 0})
    );
    let owned = escape_lines_for(&home, r2);
    assert_eq!(owned.len(), 1, "{owned:?}");
    assert_eq!(owned[0]["context"]["outcome"], "ignored");
    assert_eq!(owned[0]["context"]["phase"], "fallback");
    assert_eq!(owned[0]["context"]["reason"], "fallbackOwns");
    assert!(
        lines.iter().all(|v| v["context"]["outcome"] != "fallback"),
        "no escape was ruled: {lines:?}"
    );
}

#[test]
fn fc10b_an_out_of_phase_backstop_escape_leaves_no_cause_behind() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc10b");
    let (g, r0) = to_backstop_guard(11_950);
    let mark = effects_of(&g).len();

    g.escape(); // refused: the backstop round is open
    g.handle_drafted("a", r0, (0, 0), 4);
    g.handle_drafted("b", r0, (0, 0), 5);
    assert!(
        effects_of(&g)[mark..].contains(&Effect::Reply(true)),
        "the backstop committed: {:?}",
        &effects_of(&g)[mark..]
    );
    let r1 = later(g.begin(&["a"], 10));
    g.tick(10 + QUIT_ACK_TIMEOUT_MS);

    assert_eq!(r1, 11_951);
    let e = effects_of(&g);
    assert!(
        alert_causes_for(&e, r0).is_empty(),
        "the backstop never alerts"
    );
    assert_eq!(alert_causes_for(&e, r1), [Timeout]);
    let lines = escape_lines_for(&home, r0);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(
        lines[0]["context"],
        json!({"outcome": "ignored", "phase": "backstop", "reason": "outOfPhase",
               "requestId": r0, "round": 1, "unresolvedCount": 2})
    );
    assert_eq!(timeouts(&home, r1), 1);
    assert!(escape_lines_for(&home, r1).is_empty());
}

#[test]
fn fc7_a_failed_timer_alert_then_an_escape_records_timeout_then_escape() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc7");
    let g = guard_at(11_500);
    let r = later(g.begin(&["A", "B"], 0));
    g.effects().fail(|f| f.native_fallback = true);
    g.handle_reply("A", r, QuitAnswer::Clean, None, 1).unwrap();
    g.tick(QUIT_ACK_TIMEOUT_MS);
    assert_eq!(effect_failed(&home, r, "nativeFallback"), 1);
    assert!(!fallback_on(&g), "the failed alert handed the request back");

    g.effects().fail(|f| f.native_fallback = false);
    g.escape();

    let e = effects_of(&g);
    assert_eq!(alert_causes_for(&e, r), [Timeout, Escape]);
    assert_eq!(
        e.last(),
        Some(&Effect::NativeFallback(r, s(&["B"]), Escape))
    );
    assert!(fallback_on(&g));
    assert_eq!((timeouts(&home, r), fallback_escapes(&home, r)), (1, 1));
}

#[test]
fn fc8_a_failed_escape_alert_then_a_recheck_timeout_records_escape_then_timeout() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc8");
    let g = guard_at(11_600);
    let r = later(g.begin(&["solo"], 0));
    g.effects().fail(|f| f.native_fallback = true);
    g.escape();
    assert!(!fallback_on(&g), "the failed alert handed the request back");

    g.effects().fail(|f| f.native_fallback = false);
    g.handle_reply("solo", r, QuitAnswer::Clean, None, 1)
        .unwrap();
    let at = match effects_of(&g).last() {
        Some(Effect::ArmTimer(id, at)) if *id == r => *at,
        other => panic!("the re-check round must arm its ack timer, got {other:?}"),
    };
    g.tick(at);

    let e = effects_of(&g);
    assert_eq!(alert_causes_for(&e, r), [Escape, Timeout]);
    assert_eq!(
        e.last(),
        Some(&Effect::NativeFallback(r, s(&["solo"]), Timeout))
    );
    assert_eq!(effect_failed(&home, r, "nativeFallback"), 1);
    assert_eq!((timeouts(&home, r), fallback_escapes(&home, r)), (1, 1));
    assert!(fallback_on(&g));
}
