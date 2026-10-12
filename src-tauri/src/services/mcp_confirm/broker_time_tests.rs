//! The 60 s deadline on tokio's paused clock (matrix B-1, B-2): measured
//! from each request's arrival, never from when it was shown.

use serde_json::json;

use crate::services::mcp_confirm::payload::CONFIRM_REQUEST_EVENT;
use crate::services::mcp_confirm::queue::{Outcome, ReplyVerdict};
use crate::services::mcp_confirm::test_effects::*;

#[tokio::test(start_paused = true)]
async fn b1_a_reply_at_59_999_ms_is_approved() {
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let h = spawn_confirm(&b, "A");
    settle().await;
    advance_ms(59_999).await;
    assert!(!h.is_finished(), "still pending one millisecond before");
    assert_eq!(b.reply("r0", "A", true), Ok(ReplyVerdict::Resolved));
    settle().await;
    assert_eq!(outcome(h).await, Outcome::Approved);
}

#[tokio::test(start_paused = true)]
async fn b1_a_fresh_request_times_out_at_60_s() {
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let h = spawn_confirm(&b, "A");
    settle().await;
    advance_ms(60_000).await;
    assert!(h.is_finished(), "ended at exactly 60 s");
    assert_eq!(outcome(h).await, Outcome::TimedOut);
    assert_eq!(fx.calls().last(), Some(&resolved("A", "r0", "timedOut")));
    assert_eq!(b.pending_len(), 0);
}

fn request_payload(calls: &[Call], id: &str) -> Option<serde_json::Value> {
    calls.iter().find_map(|c| match c {
        Call::Emit { event, payload, .. }
            if event == CONFIRM_REQUEST_EVENT && payload["requestId"] == id =>
        {
            Some(payload.clone())
        }
        Call::Emit { .. } | Call::FailedEmit { .. } | Call::Attention { .. } => None,
    })
}

#[tokio::test(start_paused = true)]
async fn b2_a_queued_request_times_out_from_its_own_arrival() {
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let h0 = spawn_confirm(&b, "A");
    settle().await;
    advance_ms(15_000).await;
    let h1 = spawn_confirm(&b, "A");
    settle().await;
    let first = request_payload(&fx.calls(), "r0").expect("r0 shown");
    assert_eq!(first["expiresInMs"], json!(60_000));
    assert_eq!(request_payload(&fx.calls(), "r1"), None, "r1 queued");

    advance_ms(45_000).await; // t = 60 s
    assert!(h0.is_finished());
    assert_eq!(outcome(h0).await, Outcome::TimedOut);
    let second = request_payload(&fx.calls(), "r1").expect("r1 shown");
    assert_eq!(second["expiresInMs"], json!(15_000), "remaining budget");

    advance_ms(14_999).await; // t = 74.999 s
    assert!(!h1.is_finished(), "r1 still pending");
    advance_ms(1).await; // t = 75 s
    assert!(h1.is_finished());
    assert_eq!(outcome(h1).await, Outcome::TimedOut);
}
