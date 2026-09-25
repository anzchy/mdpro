//! D16F WI-6 (audit row 23): `QuitGuard::fallback_answer` writes exactly one
//! `app.quit.fallback` line per call.
//!
//! Law: context exactly `{requestId, answer}` with the bare wire answer
//! (`keepOpen` | `quitWithoutSaving`); `success` iff the coordinator accepted
//! the answer, otherwise `fail` at level `error` with error `why.as_str()`; a
//! refusal changes neither the snapshot nor the effects.
//!
//! Real JSONL file under `HOME_LOCK` in a temp `$HOME`. Request ids come from
//! the 6_000 band this module owns (`guard_at`), so no other guard's line can
//! match.

use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, fresh_log_home, guard_at, later, log_lines, set_home, Effect,
    RecordingEffects,
};
use crate::HOME_LOCK;
use serde_json::{json, Value};

pub(super) const WIN: &str = "wi6win";
pub(super) const OTHER: &str = "wi6b";

pub(super) fn all(_: &Value) -> bool {
    true
}

pub(super) fn wire(answer: FallbackAnswer) -> &'static str {
    match answer {
        FallbackAnswer::KeepOpen => "keepOpen",
        FallbackAnswer::QuitAnyway => "quitWithoutSaving",
    }
}

/// The q10 shape: WIN is dirty and its prompt cannot be delivered, so the
/// request goes straight to the native alert.
pub(super) fn in_fallback(floor: u64) -> QuitGuard<RecordingEffects> {
    let guard = guard_at(floor);
    let r = later(guard.begin(&[WIN, OTHER], 0));
    assert_eq!(r, floor, "guard_at did not land on its floor");
    guard.effects().fail(|f| f.emit_to.push(WIN.to_string()));
    guard
        .handle_reply(WIN, r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply(OTHER, r, QuitAnswer::Clean, None, 2)
        .unwrap();
    assert!(
        matches!(effects_of(&guard).last(), Some(Effect::NativeFallback(id, _)) if *id == r),
        "setup did not reach the native alert"
    );
    guard
}

/// The one `app.quit.fallback` line for `request_id`, checked against the law.
pub(super) fn assert_fallback_line(
    home: &std::path::Path,
    request_id: u64,
    answer: FallbackAnswer,
    refusal: Option<&str>,
) -> Value {
    let lines = entries_where(home, "app.quit.fallback", request_id, all);
    assert_eq!(
        lines.len(),
        1,
        "request {request_id}: expected one fallback line, got {lines:?}"
    );
    let line = lines[0].clone();
    assert_eq!(
        line["context"],
        json!({ "requestId": request_id, "answer": wire(answer) }),
        "request {request_id}: context must be exactly requestId and the bare answer"
    );
    let error = line
        .get("error")
        .filter(|e| !e.is_null())
        .and_then(Value::as_str);
    match refusal {
        None => {
            assert_eq!(line["status"], "success", "{line}");
            assert_eq!(line["level"], "info", "{line}");
            assert_eq!(error, None, "a success line carries no error: {line}");
        }
        Some(why) => {
            assert_eq!(line["status"], "fail", "{line}");
            assert_eq!(line["level"], "error", "{line}");
            assert_eq!(error, Some(why), "wrong refusal reason: {line}");
        }
    }
    let raw = line.to_string();
    for marker in [WIN, OTHER, "burn"] {
        assert!(
            !raw.contains(marker),
            "{marker:?} leaked into the fallback line: {raw}"
        );
    }
    line
}

#[test]
fn wi6_keep_open_accepted_logs_one_success_line() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi6keep");
    let _home = set_home(&home);
    let guard = in_fallback(6_000);
    let base = effects_of(&guard).len();

    guard.fallback_answer(6_000, FallbackAnswer::KeepOpen);

    assert_eq!(
        effects_of(&guard)[base..],
        [
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitAll(QuitEvent::Cancelled {
                request_id: 6_000,
                round: 0
            }),
            Effect::Reply(false)
        ]
    );
    assert_eq!(
        guard.begin(&[WIN], 3),
        Begin::Later { request_id: 6_001 },
        "KeepOpen must leave no live request"
    );
    assert_fallback_line(&home, 6_000, FallbackAnswer::KeepOpen, None);
}

#[test]
fn wi6_quit_anyway_accepted_logs_quit_without_saving_before_the_commit() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi6quit");
    let _home = set_home(&home);
    let guard = in_fallback(6_100);

    guard.fallback_answer(6_100, FallbackAnswer::QuitAnyway);

    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
    assert_fallback_line(&home, 6_100, FallbackAnswer::QuitAnyway, None);
    let position = |event: &str| {
        log_lines(&home).iter().position(|v| {
            v["event"] == event && v.pointer("/context/requestId") == Some(&json!(6_100))
        })
    };
    let fallback = position("app.quit.fallback").expect("fallback line");
    let commit = position("app.quit.commit").expect("commit line");
    assert!(
        fallback < commit,
        "the answer must be logged before the commit it causes"
    );
}

#[test]
fn wi6_stale_request_id_is_refused_logged_and_changes_nothing() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi6stale");
    let _home = set_home(&home);
    let guard = in_fallback(6_200);
    let before = guard.snapshot();
    let base = effects_of(&guard).len();

    guard.fallback_answer(6_201, FallbackAnswer::KeepOpen);
    assert_eq!(
        guard.snapshot(),
        before,
        "a stale answer must not touch the coordinator"
    );
    assert_eq!(
        effects_of(&guard).len(),
        base,
        "a stale answer must have no effect"
    );
    assert_fallback_line(&home, 6_201, FallbackAnswer::KeepOpen, Some("staleRequest"));

    guard.fallback_answer(6_200, FallbackAnswer::KeepOpen);
    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(false)));
    assert_fallback_line(&home, 6_200, FallbackAnswer::KeepOpen, None);
}

#[test]
fn wi6_out_of_phase_answer_is_refused_and_deletes_nothing() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi6phase");
    let _home = set_home(&home);
    let guard = guard_at(6_300);
    let r = later(guard.begin(&[WIN], 0));
    assert_eq!(r, 6_300, "guard_at did not land on its floor");
    let before = guard.snapshot();
    let base = effects_of(&guard).len();
    let deletes = guard.effects().deletes().len();

    guard.fallback_answer(6_300, FallbackAnswer::QuitAnyway);

    assert_eq!(guard.snapshot(), before);
    assert_eq!(effects_of(&guard).len(), base, "no effects");
    assert_eq!(guard.effects().deletes().len(), deletes, "no deletes");
    assert_fallback_line(&home, 6_300, FallbackAnswer::QuitAnyway, Some("outOfPhase"));
}
