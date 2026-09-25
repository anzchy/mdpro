//! WI-3 (plan-20260925-155408): the escape line's generated-domain property
//! (dx15) and its race against the ack tick (dx17, adversary G4). Split from
//! `driver_escape_log_tests.rs` under rule 50 §6.
//!
//! Law: per request, exactly one alert and exactly one line that caused it;
//! no escape line ever carries a label; `(outcome, reason)` always agrees with
//! the `phase` read under the same lock.

use super::super::fixtures::{
    alerts_for, consistent, escape_lines, escape_lines_for, in_home, raw_escape_lines,
};
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, guard_at, later, RecordingEffects,
};
use crate::HOME_LOCK;
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::Barrier;

/// Which phase a dx15 seed escapes from.
#[derive(Clone, Copy, Debug)]
enum Scenario {
    Phase1,
    Deciding,
    Recheck,
    AwaitingDelivery,
}

/// Drive one request to `scenario`; returns its id and the expected
/// `(phase, round, unresolvedCount)` of the escape line.
fn drive(
    g: &QuitGuard<RecordingEffects>,
    scenario: Scenario,
    labels: &[String],
    t0: u64,
) -> (u64, &'static str, u32, usize) {
    let r = later(g.begin(labels, t0));
    let answer = |label: &String, a: QuitAnswer, t: u64| {
        g.handle_reply(label, r, a, None, t0 + t).unwrap();
    };
    match scenario {
        Scenario::Phase1 => (r, "checking", 0, labels.len()),
        Scenario::Deciding => {
            answer(&labels[0], QuitAnswer::Dirty, 1);
            for label in &labels[1..] {
                answer(label, QuitAnswer::Clean, 2);
            }
            answer(&labels[0], QuitAnswer::Delivered, 3);
            (r, "deciding", 0, 1)
        }
        Scenario::Recheck => {
            for label in labels {
                answer(label, QuitAnswer::Clean, 1);
            }
            (r, "checking", 1, labels.len())
        }
        Scenario::AwaitingDelivery => {
            answer(&labels[0], QuitAnswer::Dirty, 1);
            answer(&labels[1], QuitAnswer::Dirty, 2);
            // Correction after red: `advance` prompts only once no window is
            // Pending, so x2 must answer too; x0 Prompted, x1/x2 Queued.
            answer(&labels[2], QuitAnswer::Dirty, 3);
            (r, "awaitingDelivery", 0, 3)
        }
    }
}

#[test]
fn dx15_escape_line_never_contains_a_label() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx15");
    let g = guard_at(10_800);
    let scenarios = [
        Scenario::Phase1,
        Scenario::Deciding,
        Scenario::Recheck,
        Scenario::AwaitingDelivery,
    ];
    let mut all_labels = Vec::new();
    let mut phases = BTreeSet::new();
    let mut requests = 0;

    for seed in 0..12u64 {
        let scenario = scenarios[(seed % 4) as usize];
        let n = match scenario {
            Scenario::AwaitingDelivery => 3,
            Scenario::Phase1 | Scenario::Deciding | Scenario::Recheck => 1 + seed as usize % 3,
        };
        let labels: Vec<String> = (0..n)
            .map(|i| match (seed, i) {
                (5, 0) => "zqé 05".to_string(), // non-ASCII and a space
                _ => format!("zq{seed:02x}-{i}"),
            })
            .collect();
        all_labels.extend(labels.iter().cloned());
        let (r, phase, round, count) = drive(&g, scenario, &labels, seed * 100);

        g.escape();
        g.escape();
        g.fallback_answer(r, FallbackAnswer::KeepOpen);

        let alerts = alerts_for(&effects_of(&g), r);
        assert_eq!(alerts.len(), 1, "seed {seed} {scenario:?}: {alerts:?}");
        let lines = escape_lines_for(&home, r);
        let fallback: Vec<&Value> = lines
            .iter()
            .filter(|v| v["context"]["outcome"] == "fallback")
            .collect();
        assert_eq!(fallback.len(), 1, "seed {seed}: {lines:?}");
        let ctx = &fallback[0]["context"];
        assert_eq!(ctx["phase"], phase, "seed {seed} {scenario:?}");
        assert_eq!(ctx["round"], round, "seed {seed} {scenario:?}");
        assert_eq!(ctx["unresolvedCount"], count, "seed {seed} {scenario:?}");
        assert_eq!(ctx["unresolvedCount"], alerts[0].len(), "seed {seed}");
        assert_eq!(lines.len(), 2, "one line per escape, seed {seed}");
        phases.insert(phase);
        requests += 1;
    }

    assert!(requests >= 12);
    assert_eq!(phases.len(), 3, "checking, deciding, awaitingDelivery");
    for line in escape_lines(&home) {
        assert!(consistent(&line), "inconsistent: {line}");
    }
    for raw in raw_escape_lines(&home) {
        for label in &all_labels {
            assert!(!raw.contains(label.as_str()), "{label:?} leaked: {raw}");
        }
    }
}

/// G4: the escape and the ack tick race for the same request. Whichever wins,
/// one alert is posted, exactly one line names its cause, and the escape's
/// line is internally consistent.
#[test]
fn dx17_escape_racing_the_ack_tick_logs_a_consistent_line_and_one_alert() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx17");
    let g = guard_at(10_900);
    let mut ids = Vec::new();

    for _ in 0..64 {
        let r = later(g.begin(&["a"], 0));
        let barrier = Barrier::new(2);
        std::thread::scope(|s| {
            s.spawn(|| {
                barrier.wait();
                g.escape();
            });
            s.spawn(|| {
                barrier.wait();
                g.tick(QUIT_ACK_TIMEOUT_MS);
            });
        });
        g.fallback_answer(r, FallbackAnswer::KeepOpen);
        ids.push(r);
    }

    let effects = effects_of(&g);
    // Who won each race, reported in every failure message. No minimum per
    // side is asserted: the scheduler decides, and a floor would be flaky.
    let (mut escape_won, mut tick_won) = (0usize, 0usize);
    for &r in &ids {
        let lines = escape_lines_for(&home, r);
        match lines.first().map(|l| &l["context"]) {
            Some(c) if c["outcome"] == "fallback" => escape_won += 1,
            Some(c) if c["outcome"] == "ignored" && c["reason"] == "fallbackOwns" => tick_won += 1,
            _ => {}
        }
    }
    let won = format!("escape won {escape_won}, tick won {tick_won}");
    for r in ids {
        assert_eq!(alerts_for(&effects, r).len(), 1, "request {r}; {won}");
        let lines = escape_lines_for(&home, r);
        assert_eq!(lines.len(), 1, "one line per escape, request {r}; {won}");
        assert!(consistent(&lines[0]), "request {r}: {}; {won}", lines[0]);
        let escaped = (lines[0]["context"]["outcome"] == "fallback") as usize;
        let timed_out = entries_where(&home, "app.quit.timeout", r, |_| true).len();
        assert_eq!(
            escaped + timed_out,
            1,
            "request {r}: exactly one cause, escape {escaped} timeout {timed_out}; {won}"
        );
    }
    assert_eq!(escape_won + tick_won, 64, "every race has a winner; {won}");
}

/// dx17's tick-wins side, pinned deterministically: the ack timer has already
/// posted the alert, so the escape is refused as `fallbackOwns` and posts none.
#[test]
fn dx17b_escape_after_the_timer_fallback_is_ignored_and_posts_no_second_alert() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx17b");
    let g = guard_at(10_970);
    let r = later(g.begin(&["a"], 0));
    g.tick(QUIT_ACK_TIMEOUT_MS + 1);
    assert_eq!(
        alerts_for(&effects_of(&g), r).len(),
        1,
        "timer fallback fired"
    );

    g.escape();

    let lines = escape_lines_for(&home, r);
    assert_eq!(lines.len(), 1, "{lines:?}");
    let ctx = &lines[0]["context"];
    assert_eq!(ctx["outcome"], "ignored");
    assert_eq!(ctx["phase"], "fallback");
    assert_eq!(ctx["reason"], "fallbackOwns");
    assert_eq!(ctx["unresolvedCount"], 1);
    assert_eq!(alerts_for(&effects_of(&g), r).len(), 1, "no second alert");
    g.fallback_answer(r, FallbackAnswer::KeepOpen);
}
