//! D16F WI-8 (audit rows 12, 15): a failed broadcast or activation is logged
//! and changes nothing else.
//!
//! Law: the effect trace is the same under any failure subset of
//! `{emit_all, activate}`; the set of logged `effect_failed` names equals the
//! mapped failing set; every context is exactly `{requestId, effect}`.
//!
//! Real JSONL file under `HOME_LOCK` in a temp `$HOME`. Request ids come from
//! the 8_000 band this module owns (`guard_at`), so no other guard's line can
//! match.

use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, fresh_log_home, guard_at, later, set_home, Effect, RecordingEffects,
};
use crate::HOME_LOCK;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::Path;

const OTHER: &str = "wi8other";
const REQUESTED: &str = "app:quit-requested";
const CANCELLED: &str = "app:quit-cancelled";

fn all(_: &Value) -> bool {
    true
}

/// `win` dirty, `OTHER` clean, so `win` is prompted; then `win` cancels.
/// Returns the effects after the burn baseline.
fn run_script(guard: &QuitGuard<RecordingEffects>, floor: u64, win: &str) -> Vec<Effect> {
    let base = effects_of(guard).len();
    let r = later(guard.begin(&[win, OTHER], 0));
    assert_eq!(r, floor, "guard did not hand out the expected request id");
    guard
        .handle_reply(win, r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply(OTHER, r, QuitAnswer::Clean, None, 2)
        .unwrap();
    guard
        .handle_reply(win, r, QuitAnswer::Cancel, None, 3)
        .unwrap();
    effects_of(guard)[base..].to_vec()
}

fn failure_names(home: &Path, r: u64) -> BTreeSet<String> {
    entries_where(home, "app.quit.effect_failed", r, all)
        .iter()
        .filter_map(|v| v["context"]["effect"].as_str().map(str::to_string))
        .collect()
}

fn failures_named(home: &Path, r: u64, effect: &str) -> Vec<Value> {
    entries_where(home, "app.quit.effect_failed", r, |v| {
        v.pointer("/context/effect") == Some(&json!(effect))
    })
}

fn assert_counts_only(line: &Value, labels: &[&str]) {
    let raw = line.to_string();
    for marker in labels.iter().chain(["burn"].iter()) {
        assert!(!raw.contains(marker), "{marker:?} leaked into {raw}");
    }
}

fn assert_one_line(home: &Path, r: u64, effect: &str, labels: &[&str]) {
    let lines = failures_named(home, r, effect);
    assert_eq!(lines.len(), 1, "expected one {effect} line: {lines:?}");
    assert_eq!(
        lines[0]["context"],
        json!({ "requestId": r, "effect": effect })
    );
    assert_eq!(lines[0]["status"], json!("fail"));
    assert_counts_only(&lines[0], labels);
}

#[test]
fn wi8_emit_requested_failure_is_logged_and_the_request_stays_armed() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi8a");
    let _home = set_home(&home);
    let guard = guard_at(8_000);
    guard
        .effects()
        .fail(|f| f.emit_all = vec![REQUESTED, CANCELLED]);
    let base = effects_of(&guard).len();

    assert_eq!(guard.begin(&["w8a"], 0), Begin::Later { request_id: 8_000 });

    assert_eq!(
        effects_of(&guard)[base..].to_vec(),
        vec![
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitAll(QuitEvent::Requested {
                request_id: 8_000,
                round: 0
            }),
            Effect::ArmTimer(8_000, QUIT_ACK_TIMEOUT_MS),
        ]
    );
    assert_eq!(
        guard.begin(&["w8a"], 1),
        Begin::AlreadyPending,
        "request is live"
    );
    assert_one_line(&home, 8_000, "emitRequested", &["w8a"]);
}

#[test]
fn wi8_emit_cancelled_failure_still_replies_no() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi8b");
    let _home = set_home(&home);
    let guard = guard_at(8_100);
    guard.effects().fail(|f| f.emit_all = vec![CANCELLED]);

    let trace = run_script(&guard, 8_100, "w8b");

    assert_eq!(
        trace[trace.len() - 2..].to_vec(),
        vec![
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitAll(QuitEvent::Cancelled {
                request_id: 8_100,
                round: 0
            }),
            Effect::Reply(false),
        ]
    );
    assert_eq!(
        guard.begin(&["w8b"], 4),
        Begin::Later { request_id: 8_101 },
        "the cancelled request must no longer be live"
    );
    assert_one_line(&home, 8_100, "emitCancelled", &["w8b", OTHER]);
    assert_eq!(
        failure_names(&home, 8_100),
        BTreeSet::from(["emitCancelled".to_string()])
    );
    assert_eq!(entries_where(&home, "app.quit.cancel", 8_100, all).len(), 1);
}

#[test]
fn wi8_activate_failure_still_sends_the_prompt() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi8c");
    let _home = set_home(&home);
    let guard = guard_at(8_200);
    guard.effects().fail(|f| f.activate = true);

    let trace = run_script(&guard, 8_200, "w8c");

    let at = trace
        .iter()
        .position(|e| *e == Effect::Activate("w8c".to_string()))
        .expect("the window is activated");
    assert_eq!(
        trace[at + 1],
        // ADR-0035 changes the spec: the event payload carries `round` (A5).
        Effect::EmitTo(
            "w8c".to_string(),
            QuitEvent::Prompt {
                request_id: 8_200,
                round: 0
            }
        )
    );
    assert!(
        matches!(trace[at + 2], Effect::ArmTimer(8_200, _)),
        "a delivered prompt is still armed: {trace:?}"
    );
    assert_one_line(&home, 8_200, "activate", &["w8c", OTHER]);
}

/// Metamorphic: the four subsets of `{emit_all, activate}` give the same trace
/// once ids are mapped, and log exactly the mapped failure names.
#[test]
fn wi8_failure_subsets_do_not_alter_the_trace() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi8m");
    let _home = set_home(&home);

    // ADR-0035 changes the spec: the event payload carries `round` (A5); the
    // normalised events keep it and zero only the request id.
    let normalise = |trace: Vec<Effect>, r: u64| -> Vec<Effect> {
        trace
            .into_iter()
            .map(|e| match e {
                Effect::EmitAll(QuitEvent::Requested { request_id, round }) if request_id == r => {
                    Effect::EmitAll(QuitEvent::Requested {
                        request_id: 0,
                        round,
                    })
                }
                Effect::EmitAll(QuitEvent::Cancelled { request_id, round }) if request_id == r => {
                    Effect::EmitAll(QuitEvent::Cancelled {
                        request_id: 0,
                        round,
                    })
                }
                Effect::EmitTo(l, QuitEvent::Prompt { request_id, round }) if request_id == r => {
                    Effect::EmitTo(
                        l,
                        QuitEvent::Prompt {
                            request_id: 0,
                            round,
                        },
                    )
                }
                Effect::ArmTimer(id, at) if id == r => Effect::ArmTimer(0, at),
                other => other,
            })
            .collect()
    };
    let mut baseline = None;
    for k in 0..4u64 {
        let (emit_fails, activate_fails) = (k & 1 != 0, k & 2 != 0);
        let r = 8_300 + 100 * k;
        let guard = guard_at(r);
        guard.effects().fail(|f| {
            f.activate = activate_fails;
            if emit_fails {
                f.emit_all = vec![REQUESTED, CANCELLED];
            }
        });
        let trace = normalise(run_script(&guard, r, "w8m"), r);
        match &baseline {
            None => baseline = Some(trace),
            Some(b) => assert_eq!(&trace, b, "subset k={k} changed the trace"),
        }
        let mut expected = BTreeSet::new();
        if emit_fails {
            expected.insert("emitRequested".to_string());
            expected.insert("emitCancelled".to_string());
        }
        if activate_fails {
            expected.insert("activate".to_string());
        }
        assert_eq!(failure_names(&home, r), expected, "subset k={k}");
    }
}

// Split out under rule 50 §6 when ADR-0035's `round` migration took this
// file past 300 lines; the test is moved unchanged.
#[path = "driver_effect_fail_ctx_tests.rs"]
mod driver_effect_fail_ctx_tests;
