//! Fallback cause (plan-20260925-232104 WI-2): every alert the driver hands
//! to `QuitEffects::native_fallback` carries the cause of the producer that
//! ruled it — the ack tick and an undeliverable prompt give `Timeout`, an
//! escape `fallback` ruling gives `Escape`.
//!
//! Law, per request: the cause of every recorded alert attempt matches its
//! producer, it lives in each call (never in the guard or the request), and it
//! is the only difference between a tick's alert and an escape's from the same
//! state. The oracle for "which producer" is the existing log line: one
//! `app.quit.timeout` or one `app.quit.escape {outcome:"fallback"}`.
//!
//! Real coordinator, logger and `DraftGate`; only the platform is
//! `RecordingEffects`. Request-id band 11_000-11_990.

use super::fixtures::{
    alert_causes_for, alerts_for, escape_lines_for, in_home, to_awaiting_delivery, to_deciding,
    to_recheck_with_discard,
};
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, guard_at, later, Effect, RecordingEffects,
};
use crate::HOME_LOCK;
use serde_json::Value;
use std::path::Path;
use std::sync::Barrier;
use FallbackCause::{Escape, Timeout};

pub(super) fn s(labels: &[&str]) -> Vec<String> {
    labels.iter().map(|l| l.to_string()).collect()
}

pub(super) fn fallback_on(g: &QuitGuard<impl QuitEffects>) -> bool {
    g.snapshot().live_request().is_some_and(|r| r.fallback)
}

pub(super) fn timeouts(home: &Path, r: u64) -> usize {
    entries_where(home, "app.quit.timeout", r, |_| true).len()
}

pub(super) fn effect_failed(home: &Path, r: u64, effect: &str) -> usize {
    entries_where(home, "app.quit.effect_failed", r, |v| {
        v["context"]["effect"] == effect
    })
    .len()
}

pub(super) fn fallback_escapes(home: &Path, r: u64) -> usize {
    escape_lines_for(home, r)
        .iter()
        .filter(|v| v["context"]["outcome"] == "fallback")
        .count()
}

#[test]
fn fc1_the_ack_timer_alert_carries_timeout_at_its_deadline_and_not_before() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc1");
    let g = guard_at(11_100);
    let r = later(g.begin(&["a"], 0));
    let mark = effects_of(&g).len();

    g.tick(QUIT_ACK_TIMEOUT_MS - 1);
    assert!(alert_causes_for(&effects_of(&g), r).is_empty(), "early");
    g.tick(QUIT_ACK_TIMEOUT_MS);

    let added: Vec<Effect> = effects_of(&g)[mark..]
        .iter()
        .filter(|e| !matches!(e, Effect::ArmTimer(..)))
        .cloned()
        .collect();
    assert_eq!(added, [Effect::NativeFallback(r, s(&["a"]), Timeout)]);
    assert_eq!(timeouts(&home, r), 1);
    assert!(escape_lines_for(&home, r).is_empty());
    assert!(fallback_on(&g));
}

#[test]
fn fc2_an_undeliverable_prompt_falls_back_with_timeout() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc2");
    let g = guard_at(11_150);
    let r = later(g.begin(&["A", "B"], 0));
    g.effects().fail(|f| f.emit_to.push("A".into()));
    g.handle_reply("A", r, QuitAnswer::Dirty, None, 1).unwrap();
    g.handle_reply("B", r, QuitAnswer::Clean, None, 2).unwrap();

    let e = effects_of(&g);
    assert_eq!(
        e.last(),
        Some(&Effect::NativeFallback(r, s(&["A"]), Timeout))
    );
    assert_eq!(alert_causes_for(&e, r), [Timeout]);
    assert_eq!(effect_failed(&home, r, "emitPrompt"), 1);
    assert_eq!(timeouts(&home, r), 0);
    assert!(escape_lines_for(&home, r).is_empty());
    assert!(fallback_on(&g));
}

#[test]
fn fc3_escape_from_each_escapable_phase_records_one_alert_with_escape() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc3");
    let g = guard_at(11_200);
    type Drive = fn(&QuitGuard<RecordingEffects>) -> u64;
    let phase1: Drive = |g| later(g.begin(&["p0", "p1"], 0));
    let scenarios: [(Drive, &str, u32, Vec<String>); 4] = [
        (phase1, "checking", 0, s(&["p0", "p1"])),
        (to_recheck_with_discard, "checking", 1, s(&["a"])),
        (
            to_awaiting_delivery,
            "awaitingDelivery",
            0,
            s(&["x0", "x1", "x2"]),
        ),
        (to_deciding, "deciding", 0, s(&["a"])),
    ];

    for (drive, phase, round, labels) in scenarios {
        let r = drive(&g);
        let mark = effects_of(&g).len();
        g.escape();
        g.escape();

        let e = effects_of(&g);
        let mut first = e[mark..].first().cloned();
        if let Some(Effect::NativeFallback(_, got, _)) = first.as_mut() {
            got.sort();
        }
        assert_eq!(
            first,
            Some(Effect::NativeFallback(r, labels, Escape)),
            "{phase}/{round}"
        );
        assert_eq!(alert_causes_for(&e, r), [Escape], "{phase}/{round}");
        assert_eq!(alert_causes_for(&e, r).len(), alerts_for(&e, r).len());
        let lines = escape_lines_for(&home, r);
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert_eq!(lines[0]["context"]["outcome"], "fallback", "{lines:?}");
        assert_eq!(lines[0]["context"]["phase"], phase, "{lines:?}");
        assert_eq!(lines[0]["context"]["round"], round, "{lines:?}");
        assert_eq!(lines[1]["context"]["reason"], "fallbackOwns", "{lines:?}");
        assert_eq!(timeouts(&home, r), 0, "{phase}/{round}");
        g.fallback_answer(r, FallbackAnswer::KeepOpen);
    }
}

#[test]
fn fc4_an_escape_after_the_timer_alert_keeps_the_one_alert_timeout() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc4");
    let g = guard_at(11_300);
    let r = later(g.begin(&["a"], 0));
    g.tick(QUIT_ACK_TIMEOUT_MS + 1);

    g.escape();

    assert_eq!(alert_causes_for(&effects_of(&g), r), [Timeout]);
    assert_eq!(timeouts(&home, r), 1);
    let lines = escape_lines_for(&home, r);
    assert_eq!(lines.len(), 1, "{lines:?}");
    let ctx = &lines[0]["context"];
    assert_eq!(
        (&ctx["outcome"], &ctx["phase"], &ctx["reason"]),
        (
            &Value::from("ignored"),
            &Value::from("fallback"),
            &Value::from("fallbackOwns")
        )
    );
    assert!(fallback_on(&g));
    g.fallback_answer(r, FallbackAnswer::KeepOpen);
}

/// dx17's race, with the cause as the property: it agrees with whichever
/// producer won. No minimum per side — the scheduler decides.
#[test]
fn fc5_racing_escape_and_tick_the_cause_agrees_with_the_winner() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc5");
    let g = guard_at(11_000);
    let mut ids = Vec::new();
    for _ in 0..64 {
        let r = later(g.begin(&["a"], 0));
        let barrier = Barrier::new(2);
        std::thread::scope(|sc| {
            sc.spawn(|| {
                barrier.wait();
                g.escape();
            });
            sc.spawn(|| {
                barrier.wait();
                g.tick(QUIT_ACK_TIMEOUT_MS);
            });
        });
        g.fallback_answer(r, FallbackAnswer::KeepOpen);
        ids.push(r);
    }

    let effects = effects_of(&g);
    let escaped = |r| fallback_escapes(&home, r) == 1;
    let escape_won = ids.iter().filter(|&&r| escaped(r)).count();
    let won = format!(
        "escape won {escape_won}, tick won {}",
        ids.len() - escape_won
    );
    for &r in &ids {
        let causes = alert_causes_for(&effects, r);
        let timed_out = timeouts(&home, r) == 1;
        assert_eq!(causes.len(), 1, "request {r}: {causes:?}; {won}");
        assert_eq!(causes[0] == Escape, escaped(r), "request {r}; {won}");
        assert_eq!(causes[0] == Timeout, timed_out, "request {r}; {won}");
        assert_ne!(escaped(r), timed_out, "request {r}: one cause; {won}");
    }
}

#[test]
fn fc6_the_cause_does_not_leak_between_requests() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc6");
    let g = guard_at(11_400);
    let keep = |r| g.fallback_answer(r, FallbackAnswer::KeepOpen);

    let r1 = later(g.begin(&["a"], 0));
    g.escape();
    keep(r1);
    let r2 = later(g.begin(&["a"], 10));
    g.tick(10 + QUIT_ACK_TIMEOUT_MS);
    keep(r2);
    let r3 = later(g.begin(&["a"], 20));
    g.tick(20 + QUIT_ACK_TIMEOUT_MS);
    keep(r3);
    let r4 = later(g.begin(&["a"], 30));
    g.escape();

    let e = effects_of(&g);
    for (r, cause) in [(r1, Escape), (r2, Timeout), (r3, Timeout), (r4, Escape)] {
        assert_eq!(alert_causes_for(&e, r), [cause], "request {r}");
        assert_eq!(fallback_escapes(&home, r), (cause == Escape) as usize);
        assert_eq!(timeouts(&home, r), (cause == Timeout) as usize);
    }
}

/// Metamorphic: from the same phase-1 state, a tick and an escape post the
/// same alert and own the request the same way; only the cause differs.
#[test]
fn fc9_tick_and_escape_from_the_same_state_differ_only_in_the_cause() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("fc9");
    let g1 = guard_at(11_700);
    let r1 = later(g1.begin(&["a", "b"], 0));
    let m1 = effects_of(&g1).len();
    g1.tick(QUIT_ACK_TIMEOUT_MS);
    let g2 = guard_at(11_800);
    let r2 = later(g2.begin(&["a", "b"], 0));
    let m2 = effects_of(&g2).len();
    g2.escape();

    // Ids mapped away, the cause dropped, `ArmTimer` set aside.
    let norm = |e: &[Effect], r: u64| -> Vec<Result<Vec<String>, Effect>> {
        e.iter()
            .filter(|e| !matches!(e, Effect::ArmTimer(..)))
            .map(|e| match e {
                Effect::NativeFallback(id, t, _) if *id == r => Ok(t.clone()),
                other => Err(other.clone()),
            })
            .collect()
    };
    let n1 = norm(&effects_of(&g1)[m1..], r1);
    assert_eq!(n1, norm(&effects_of(&g2)[m2..], r2));
    assert_eq!(n1, [Ok(s(&["a", "b"]))]);
    assert_eq!(alert_causes_for(&effects_of(&g1), r1), [Timeout]);
    assert_eq!(alert_causes_for(&effects_of(&g2), r2), [Escape]);
    let (s1, s2) = (g1.snapshot(), g2.snapshot());
    let (q1, q2) = (s1.live_request().unwrap(), s2.live_request().unwrap());
    assert!(q1.fallback && q2.fallback);
    assert_eq!(q1.windows, q2.windows);
    assert_eq!((timeouts(&home, r1), fallback_escapes(&home, r1)), (1, 0));
    assert_eq!((timeouts(&home, r2), fallback_escapes(&home, r2)), (0, 1));
}

#[path = "driver_fallback_cause_stale_tests.rs"]
mod stale;
