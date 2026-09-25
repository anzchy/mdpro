//! ADR-0035 WI-5 (A5): the IPC entry `handle_wire_reply`, the `drafted`
//! answer's validation, and `handle_reply`'s refusal of `Drafted` (DD-1 … DD-4,
//! and the WI-5 half of DL-4: the `round` key on every `app.quit.answer` line).
//! DD-5, the stale-round metamorphic property, is in
//! `driver_stale_round_tests.rs`.
//!
//! Registered from `driver_backstop_log_tests.rs`. The platform is
//! `RecordingEffects`; log cases read the real JSONL file under `HOME_LOCK`.
//!
//! Law: refusal inertness. Every refused reply — by validation, by phase or by
//! round — leaves `snapshot()` as it was and records no effect. The label always
//! comes from the caller.

use crate::services::quit_guard::coordinator::QUIT_BACKSTOP_TIMEOUT_MS;
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, fresh_log_home, guard_at, later, leak_gate, recording_guard,
    set_home, Effect, RecordingEffects,
};
use crate::HOME_LOCK;
use serde_json::Value;
use std::collections::BTreeSet;

/// One window `a`, driven to the backstop: phase 1 clean at 10 (round 0), the
/// re-check clean at 20 (round 1). Returns the request id.
pub(super) fn at_backstop(guard: &QuitGuard<RecordingEffects>) -> u64 {
    let r = later(guard.begin(&["a"], 0));
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 10)
        .unwrap();
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 20)
        .unwrap();
    assert!(
        matches!(
            effects_of(guard).as_slice(),
            [
                ..,
                Effect::EmitAll(QuitEvent::Backstop { round: 1, .. }),
                Effect::ArmTimer(..)
            ]
        ),
        "fixture: expected the backstop round, got {:?}",
        effects_of(guard)
    );
    r
}

fn keys(v: &Value) -> BTreeSet<String> {
    v.as_object()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

fn set(list: &[&str]) -> BTreeSet<String> {
    list.iter().map(|s| s.to_string()).collect()
}

// ── DD-1 ──────────────────────────────────────────────────────────────────────

#[test]
fn dd1_a_refused_drafted_leaves_snapshot_and_effects_unchanged() {
    let guard = recording_guard(leak_gate());
    let r = at_backstop(&guard);
    // (drafted, failed, round, request id, refused by validation?)
    let rows = [
        (None, Some(0), Some(1), r, true),
        (Some(0), None, Some(1), r, true),
        (Some(102), Some(0), Some(1), r, true),
        (Some(1), Some(0), Some(0), r, false),
        (Some(1), Some(0), Some(1), r + 1, false),
    ];
    for (drafted, failed, round, id, invalid) in rows {
        let row = format!("drafted={drafted:?} failed={failed:?} round={round:?} id={id}");
        let before = guard.snapshot();
        let effects_before = effects_of(&guard).len();
        let got = guard.handle_wire_reply(
            "a",
            id,
            QuitAnswer::Drafted,
            None,
            drafted,
            failed,
            round,
            30,
        );
        assert_eq!(got.is_err(), invalid, "{row}: {got:?}");
        assert_eq!(guard.snapshot(), before, "{row}: the state moved");
        assert_eq!(
            effects_of(&guard).len(),
            effects_before,
            "{row}: an effect ran"
        );
    }
    // Nothing was spent: the real answer still commits.
    guard
        .handle_wire_reply(
            "a",
            r,
            QuitAnswer::Drafted,
            None,
            Some(1),
            Some(0),
            Some(1),
            40,
        )
        .unwrap();
    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
}

// ── DD-2 ──────────────────────────────────────────────────────────────────────

#[test]
fn dd2_handle_reply_refuses_drafted() {
    let guard = recording_guard(leak_gate());
    let r = at_backstop(&guard);
    let before = guard.snapshot();
    let effects_before = effects_of(&guard).len();

    let err = guard
        .handle_reply("a", r, QuitAnswer::Drafted, None, 30)
        .expect_err("a drafted answer without its counts must be refused");
    assert!(
        err.contains("handle_drafted") || err.contains("counts required"),
        "the refusal must say what is missing: {err:?}"
    );
    assert_eq!(guard.snapshot(), before);
    assert_eq!(effects_of(&guard).len(), effects_before);
    assert!(
        !effects_of(&guard).contains(&Effect::Reply(true)),
        "a count-less drafted reported a successful backstop"
    );
}

// ── DD-3 ──────────────────────────────────────────────────────────────────────

#[test]
fn dd3_a_refusal_is_logged_as_a_fail_answer_with_counts_only() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("dd3");
    let _home = set_home(&home);
    let guard = guard_at(9_350);
    let r = at_backstop(&guard);
    assert_eq!(r, 9_350);

    let err = guard
        .handle_wire_reply(
            "a",
            r,
            QuitAnswer::Drafted,
            None,
            Some(102),
            Some(0),
            Some(1),
            30,
        )
        .expect_err("an over-cap count must be refused");
    assert!(err.contains("101"), "{err:?}");

    let lines = entries_where(&home, "app.quit.answer", r, |v| {
        v.pointer("/context/draftedCount").and_then(Value::as_u64) == Some(102)
    });
    assert_eq!(lines.len(), 1, "{lines:?}");
    let line = &lines[0];
    assert_eq!(line["status"], "fail", "{line}");
    assert_eq!(line["context"]["answer"], "drafted", "{line}");
    assert_eq!(line["context"]["failedCount"], 0, "{line}");
    assert_eq!(line["context"]["round"], 1, "{line}");
    let error = line["error"].as_str().unwrap_or_default();
    assert!(error.contains("101"), "the error must name the cap: {line}");
    assert!(!error.contains("102"), "the error quoted the value: {line}");
}

// ── DD-4 ──────────────────────────────────────────────────────────────────────

#[test]
fn dd4_the_wire_entry_dispatches_by_answer_and_passes_the_round() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["a"], 0));
    let wire = |answer, counts: (Option<u32>, Option<u32>), round, t| {
        guard
            .handle_wire_reply("a", r, answer, None, counts.0, counts.1, Some(round), t)
            .unwrap();
    };
    wire(QuitAnswer::Clean, (None, None), 0, 10);
    wire(QuitAnswer::Clean, (None, None), 1, 20);
    wire(QuitAnswer::Drafted, (Some(1), Some(0)), 1, 30);

    // The DR-1 sequence, reached through the IPC entry.
    assert_eq!(
        effects_of(&guard),
        vec![
            Effect::EmitAll(QuitEvent::Requested {
                request_id: r,
                round: 0
            }),
            Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS),
            Effect::EmitAll(QuitEvent::Requested {
                request_id: r,
                round: 1
            }),
            Effect::ArmTimer(r, 10 + QUIT_ACK_TIMEOUT_MS),
            Effect::EmitAll(QuitEvent::Backstop {
                request_id: r,
                round: 1
            }),
            Effect::ArmTimer(r, 20 + QUIT_BACKSTOP_TIMEOUT_MS),
            Effect::Reply(true),
        ]
    );
    assert_eq!(guard.snapshot().round(), None, "the request must be over");
}

// ── DL-4 (WI-5 half): `round` on every answer line; a stale round is a fail ───

#[test]
fn dl4_every_answer_line_carries_round_and_a_stale_round_logs_fail() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("dl4wire");
    let _home = set_home(&home);
    let guard = guard_at(9_360);
    let r = later(guard.begin(&["a"], 0));
    assert_eq!(r, 9_360);
    let wire = |answer, counts: (Option<u32>, Option<u32>), round, t| {
        guard
            .handle_wire_reply("a", r, answer, None, counts.0, counts.1, round, t)
            .unwrap();
    };
    wire(QuitAnswer::Clean, (None, None), Some(0), 10);
    // Round 1 is live now: a reordered round-0 reply is refused.
    wire(QuitAnswer::Clean, (None, None), Some(0), 15);
    wire(QuitAnswer::Clean, (None, None), Some(1), 20);
    wire(QuitAnswer::Drafted, (Some(1), Some(0)), Some(1), 30);
    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
    // The legacy entry, untagged, after the request is over.
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 40)
        .unwrap();

    let lines = entries_where(&home, "app.quit.answer", r, |_| true);
    assert_eq!(lines.len(), 5, "{lines:?}");
    let base = set(&["windowLabel", "answer", "requestId", "idCount", "round"]);
    let mut drafted = base.clone();
    drafted.extend(set(&["draftedCount", "failedCount"]));
    let rounds: Vec<Value> = lines
        .iter()
        .map(|l| l["context"]["round"].clone())
        .collect();
    assert_eq!(
        rounds,
        vec![
            Value::from(0),
            Value::from(0),
            Value::from(1),
            Value::from(1),
            Value::Null
        ]
    );
    for line in &lines {
        let want = if line["context"]["answer"] == "drafted" {
            &drafted
        } else {
            &base
        };
        assert_eq!(&keys(&line["context"]), want, "{line}");
    }
    let stale = &lines[1];
    assert_eq!(stale["status"], "fail", "{stale}");
    assert!(
        stale["error"]
            .as_str()
            .is_some_and(|e| e.contains("staleRound")),
        "the refusal must say why: {stale}"
    );
    assert_eq!(lines[2]["status"], "success");
    assert_eq!(lines[3]["status"], "success");
}

#[path = "driver_stale_round_tests.rs"]
mod driver_stale_round_tests;
