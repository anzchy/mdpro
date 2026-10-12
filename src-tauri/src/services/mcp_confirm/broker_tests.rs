//! Example cases for the async broker (matrix B-4, B-6, B-7, B-8, B-9) on a
//! recording `ConfirmEffects` fake and tokio's paused clock.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::*;
use crate::models::{LogEntryPayload, LogStatus};
use crate::services::mcp_confirm::payload::{CONFIRM_REQUEST_EVENT, CONFIRM_RESOLVED_EVENT};
use crate::services::mcp_confirm::queue::{Cause, Outcome, ReplyVerdict};
use crate::services::mcp_confirm::test_effects::*;

#[test]
fn the_budget_is_sixty_seconds() {
    assert_eq!(CONFIRM_BUDGET, Duration::from_secs(60));
}

/// The B-4 script: 3 in A, 1 in B, answered r0 reject, r3, r1, r2.
async fn run_b4(fx: &RecordingEffects) -> (Vec<Outcome>, WireChecker) {
    let b = broker(fx);
    let mut checker = WireChecker::default();
    let mut handles = Vec::new();
    for w in ["A", "A", "A", "B"] {
        handles.push(spawn_confirm(&b, w));
        settle().await;
    }
    assert_eq!(b.shown("A").as_deref(), Some("r0"));
    assert_eq!(
        b.shown("B").as_deref(),
        Some("r3"),
        "both windows show at once"
    );
    checker.feed(&fx.calls()).expect("wire after enqueue");
    let answers = [
        ("r0", "A", false),
        ("r3", "B", true),
        ("r1", "A", true),
        ("r2", "A", true),
    ];
    for (id, w, approved) in answers {
        assert_eq!(b.reply(id, w, approved), Ok(ReplyVerdict::Resolved), "{id}");
        settle().await;
        checker.feed(&fx.calls()).expect("wire after reply");
    }
    let mut outcomes = Vec::new();
    for h in handles {
        assert!(h.is_finished());
        outcomes.push(outcome(h).await);
    }
    assert_eq!(b.pending_len(), 0);
    (outcomes, checker)
}

#[tokio::test(start_paused = true)]
async fn b4_three_in_a_and_one_in_b_resolve_in_reply_order() {
    let fx = RecordingEffects::new();
    let (outcomes, checker) = run_b4(&fx).await;
    use Outcome::{Approved, Rejected};
    assert_eq!(outcomes, vec![Rejected, Approved, Approved, Approved]);
    assert_eq!(checker.requested.len(), 4, "every request was shown once");
}

#[tokio::test(start_paused = true)]
async fn b8_attention_once_per_shown_prompt() {
    let fx = RecordingEffects::new();
    run_b4(&fx).await;
    let calls = fx.calls();
    let mut per_window = std::collections::HashMap::<String, usize>::new();
    for (i, call) in calls.iter().enumerate() {
        if let Call::Attention { window } = call {
            *per_window.entry(window.clone()).or_default() += 1;
            let prev = i.checked_sub(1).map(|p| &calls[p]);
            let after_request = matches!(prev, Some(Call::Emit { window: w, event, .. })
                if w == window && event == CONFIRM_REQUEST_EVENT);
            assert!(after_request, "attention {i} not right after a request");
        }
        if let Call::Emit { window, event, .. } = call {
            if event == CONFIRM_REQUEST_EVENT {
                assert_eq!(
                    calls.get(i + 1),
                    Some(&Call::Attention {
                        window: window.clone()
                    })
                );
            }
        }
    }
    assert_eq!(per_window.get("A"), Some(&3));
    assert_eq!(per_window.get("B"), Some(&1));
}

#[tokio::test(start_paused = true)]
async fn b6_aborting_the_shown_waiter_withdraws_and_shows_the_next() {
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let h0 = spawn_confirm(&b, "A");
    settle().await;
    let _h1 = spawn_confirm(&b, "A");
    settle().await;
    let before = fx.calls().len();
    h0.abort();
    settle().await;
    let calls = fx.calls();
    let emits: Vec<&Call> = calls[before..]
        .iter()
        .filter(|c| matches!(c, Call::Emit { .. }))
        .collect();
    assert_eq!(emits.len(), 2, "{emits:?}");
    assert_eq!(emits[0], &resolved("A", "r0", "withdrawn"));
    assert!(matches!(emits[1], Call::Emit { window, event, payload }
        if window == "A" && event == CONFIRM_REQUEST_EVENT && payload["requestId"] == "r1"));
    assert_eq!(resolved_for(&calls, "r0").len(), 1);
    assert_eq!(b.pending_len(), 1);
    assert_eq!(b.shown("A").as_deref(), Some("r1"));
}

#[tokio::test(start_paused = true)]
async fn b6_aborting_a_queued_waiter_leaves_silently() {
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let _h0 = spawn_confirm(&b, "A");
    settle().await;
    let h1 = spawn_confirm(&b, "A");
    settle().await;
    assert_eq!(b.pending_len(), 2);
    let before = fx.calls().len();
    h1.abort();
    settle().await;
    assert_eq!(fx.calls().len(), before, "no new calls");
    assert_eq!(b.pending_len(), 1);
    assert_eq!(b.shown("A").as_deref(), Some("r0"));
}

#[tokio::test(start_paused = true)]
async fn b7_emit_failure_cascades_without_stalling() {
    let fx = RecordingEffects::failing(&["r0", "r1"]);
    let b = broker(&fx);
    let hs: Vec<_> = (0..3).map(|_| spawn_confirm(&b, "A")).collect();
    settle().await;
    let mut hs = hs.into_iter();
    let (h0, h1, h2) = (hs.next().unwrap(), hs.next().unwrap(), hs.next().unwrap());
    assert!(
        h0.is_finished() && h1.is_finished(),
        "no time advance needed"
    );
    assert_eq!(outcome(h0).await, Outcome::Cancelled(Cause::EmitFailed));
    assert_eq!(outcome(h1).await, Outcome::Cancelled(Cause::EmitFailed));
    assert_eq!(b.shown("A").as_deref(), Some("r2"));
    assert_eq!(b.reply("r2", "A", true), Ok(ReplyVerdict::Resolved));
    settle().await;
    assert_eq!(outcome(h2).await, Outcome::Approved);
}

#[tokio::test(start_paused = true)]
async fn b7_every_emit_failing_cancels_all_three() {
    let fx = RecordingEffects::failing(&["r0", "r1", "r2"]);
    let b = broker(&fx);
    let hs: Vec<_> = (0..3).map(|_| spawn_confirm(&b, "A")).collect();
    settle().await;
    for h in hs {
        assert!(h.is_finished());
        assert_eq!(outcome(h).await, Outcome::Cancelled(Cause::EmitFailed));
    }
    assert_eq!(b.pending_len(), 0);
}

#[test]
fn b9_poisoned_table_fails_closed() {
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    b.poison_for_test();
    let rt = paused_runtime();
    let confirmed = catch_unwind(AssertUnwindSafe(|| rt.block_on(b.confirm("A", meta()))));
    assert_eq!(confirmed.ok(), Some(Outcome::Cancelled(Cause::EmitFailed)));
    let replied = catch_unwind(AssertUnwindSafe(|| b.reply("r0", "A", true)));
    assert!(matches!(replied, Ok(Err(_))), "{replied:?}");
}

#[tokio::test(start_paused = true)]
async fn the_broker_logs_start_and_end_through_its_sink() {
    let fx = RecordingEffects::new();
    let lines: Arc<Mutex<Vec<LogEntryPayload>>> = Arc::default();
    let sink = Arc::clone(&lines);
    let b = Arc::new(
        ConfirmBroker::new_with(fx.clone(), seq_ids())
            .with_log_sink(Arc::new(move |e| sink.lock().expect("sink").push(e))),
    );
    let h0 = spawn_confirm(&b, "A");
    settle().await;
    let h1 = spawn_confirm(&b, "A");
    settle().await;
    advance_ms(250).await;
    assert_eq!(b.reply("r0", "A", true), Ok(ReplyVerdict::Resolved));
    settle().await;
    assert_eq!(outcome(h0).await, Outcome::Approved);
    h1.abort();
    settle().await;
    let lines = lines.lock().expect("lines").clone();
    let summary: Vec<(LogStatus, String, String)> = lines
        .iter()
        .map(|e| {
            let ctx = e.context.clone().expect("context");
            let id = ctx["requestId"].as_str().unwrap_or("").to_string();
            let out = ctx["outcome"].as_str().unwrap_or("").to_string();
            (e.status, id, out)
        })
        .collect();
    let s = |st, id: &str, out: &str| (st, id.to_string(), out.to_string());
    assert_eq!(
        summary,
        vec![
            s(LogStatus::Start, "r0", ""),
            s(LogStatus::Start, "r1", ""),
            s(LogStatus::Success, "r0", "approved"),
            s(LogStatus::Fail, "r1", "withdrawn"),
        ]
    );
    let waited = lines[2].context.as_ref().expect("ctx")["waitedMs"].as_u64();
    assert_eq!(waited, Some(250));
    assert!(fx
        .calls()
        .iter()
        .all(|c| !matches!(c, Call::Emit { window, event, .. }
        if event == CONFIRM_RESOLVED_EVENT && window != "A")));
}
