//! `stop_hook` (ADR-0042 WI-4): the controller's `StopCause` maps onto the
//! broker. `ServerStop` cancels what is pending and leaves the table usable
//! (Q-10 at the hook); `AppExit` closes it for good (Q-11 at the hook). A
//! poisoned broker makes neither the hook nor `on_window_event` panic.

use std::panic::{catch_unwind, AssertUnwindSafe};

use tauri::WindowEvent;

use super::{on_window_event, stop_hook};
use crate::services::mcp_confirm::payload::CONFIRM_REQUEST_EVENT;
use crate::services::mcp_confirm::queue::{Cause, Outcome, ReplyVerdict};
use crate::services::mcp_confirm::test_effects::*;
use crate::services::mcp_controller::controller::StopCause;

fn requests_after(calls: &[Call], from: usize) -> usize {
    calls[from..]
        .iter()
        .filter(|c| matches!(c, Call::Emit { event, .. } if event == CONFIRM_REQUEST_EVENT))
        .count()
}

#[tokio::test(start_paused = true)]
async fn server_stop_cancels_pending_and_the_broker_still_confirms() {
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let hook = stop_hook(b.clone());
    let first = spawn_confirm(&b, "B");
    settle().await;

    hook(StopCause::ServerStop);
    settle().await;

    assert_eq!(outcome(first).await, Outcome::Cancelled(Cause::ServerStop));
    assert_eq!(b.pending_len(), 0);
    let before = fx.calls().len();
    let second = spawn_confirm(&b, "B");
    settle().await;
    assert_eq!(b.shown("B").as_deref(), Some("r1"), "a new prompt is shown");
    assert_eq!(requests_after(&fx.calls(), before), 1);
    assert_eq!(b.reply("r1", "B", true), Ok(ReplyVerdict::Resolved));
    assert_eq!(outcome(second).await, Outcome::Approved);
}

#[tokio::test(start_paused = true)]
async fn app_exit_cancels_pending_and_closes_the_broker() {
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let hook = stop_hook(b.clone());
    let first = spawn_confirm(&b, "B");
    settle().await;

    hook(StopCause::AppExit);
    settle().await;

    assert_eq!(outcome(first).await, Outcome::Cancelled(Cause::AppExit));
    let before = fx.calls().len();
    hook(StopCause::ServerStop);
    let later = b.confirm("A", meta()).await;
    assert_eq!(later, Outcome::Cancelled(Cause::AppExit), "first cause wins");
    assert_eq!(requests_after(&fx.calls(), before), 0, "nothing shown after exit");
    assert_eq!(b.pending_len(), 0);
}

#[test]
fn a_poisoned_broker_never_panics_the_hook_or_the_window_event() {
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    b.poison_for_test();
    let hook = stop_hook(b.clone());
    let ran = catch_unwind(AssertUnwindSafe(|| {
        hook(StopCause::ServerStop);
        hook(StopCause::AppExit);
        on_window_event(b.as_ref(), "A", &WindowEvent::Destroyed);
    }));
    assert!(ran.is_ok(), "a poisoned broker must fail quietly");
}

/// The line a failed cancel writes: error level, `fail`, the cause in
/// `error`, and only allowed context keys (never a title or content).
#[test]
fn a_failed_cancel_logs_its_cause_and_nothing_else() {
    use crate::models::{LogLevel, LogStatus};
    use crate::services::mcp_confirm::logging::{cancel_failed_entry, CONFIRM_LOG_EVENT};
    let cases = [
        (Cause::ServerStop, None, "serverStop cancel failed"),
        (Cause::AppExit, None, "appExit cancel failed"),
        (Cause::WindowClosed, Some("A"), "windowClosed cancel failed"),
    ];
    for (cause, window, error) in cases {
        let line = cancel_failed_entry(cause, window);
        assert_eq!(line.event, CONFIRM_LOG_EVENT, "{cause:?}");
        assert!(matches!(line.level, LogLevel::Error), "{cause:?}");
        assert!(matches!(line.status, LogStatus::Fail), "{cause:?}");
        assert_eq!(line.error.as_deref(), Some(error));
        let context = line.context.expect("context");
        let mut expected = serde_json::json!({ "outcome": "cancelled" });
        if let Some(w) = window {
            expected["windowLabel"] = serde_json::json!(w);
        }
        assert_eq!(context, expected, "{cause:?}");
    }
}
