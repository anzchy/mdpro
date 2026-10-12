//! H-1..H-5 (ADR-0042 WI-5): the outcome -> HTTP mapping and `confirm_gate`
//! over a real shadow store and the real broker, with `RecordingEffects`
//! as the only fake. Also the shared helpers the reply and log cases use.

use std::collections::HashSet;
use std::sync::Arc;

use axum::response::Response;
use serde_json::Value;

use super::{confirm_gate, response_for, GateResult};
use crate::commands::mcp_confirm::reply_from;
use crate::models::mcp::DocumentState;
use crate::models::{SharedShadowStore, SyncDocumentsPayload};
use crate::services::mcp_confirm::broker::ConfirmBroker;
use crate::services::mcp_confirm::payload::{Operation, CONFIRM_REQUEST_EVENT};
use crate::services::mcp_confirm::queue::{Cause, IdSource, Outcome, ReplyVerdict};
use crate::services::mcp_confirm::test_effects::{
    advance_ms, paused_runtime, settle, Call, RecordingEffects, TestBroker,
};
use crate::services::shadow_store::{create_shadow_store, set_focused_window, sync_documents};

const SENTINEL: &str = "TITLE-SENTINEL";

/// The n-th id is the canonical uuid `00000000-0000-4000-8000-{n:012}`.
pub(crate) fn uuid_ids() -> impl IdSource + 'static {
    let mut n = 0u64;
    move || {
        let id = nth_uuid(n);
        n += 1;
        id
    }
}

pub(crate) fn nth_uuid(n: u64) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

/// A broker with canonical uuid ids (the reply core parses them).
pub(crate) fn uuid_broker(fx: &RecordingEffects) -> TestBroker {
    Arc::new(ConfirmBroker::new_with(fx.clone(), uuid_ids()))
}

/// A store where `window` holds document `d`, titled `title`.
pub(crate) fn store_with_d(window: &str, title: &str, content: &str) -> SharedShadowStore {
    let store = create_shadow_store();
    let doc = DocumentState {
        id: "d".to_string(),
        title: title.to_string(),
        path: Some("/tmp/PATH-SENTINEL.md".to_string()),
        content: content.to_string(),
        cursor: 0,
        is_dirty: false,
        is_active: true,
    };
    let payload = SyncDocumentsPayload {
        window_label: window.to_string(),
        documents: vec![doc],
        active_document_id: Some("d".to_string()),
        routable: true,
    };
    sync_documents(&store, payload).expect("sync d");
    store
}

pub(crate) type GateHandle = tokio::task::JoinHandle<Result<(), Response>>;

pub(crate) fn spawn_gate(broker: &TestBroker, store: &SharedShadowStore) -> GateHandle {
    let (b, s) = (Arc::clone(broker), Arc::clone(store));
    tokio::spawn(async move { confirm_gate(&b, &s, "d", Operation::Replace).await })
}

/// `(status, code, body text)` of an error response.
async fn parts(response: Response) -> (u16, String, String) {
    let status = response.status().as_u16();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body bytes");
    let text = String::from_utf8(bytes.to_vec()).expect("utf-8 body");
    let body: Value = serde_json::from_str(&text).expect("json body");
    let code = body["code"].as_str().unwrap_or("").to_string();
    (status, code, text)
}

async fn error_parts(result: Result<(), Response>) -> (u16, String) {
    match result {
        Ok(()) => (200, "PROCEED".to_string()),
        Err(response) => {
            let (status, code, _) = parts(response).await;
            (status, code)
        }
    }
}

// ---- H-1 ---------------------------------------------------------------

#[test]
fn h1_mapping_over_every_outcome() {
    let table: Vec<(GateResult, Option<(u16, &str)>)> = vec![
        (GateResult::ApplyNow, None),
        (GateResult::Confirmed(Outcome::Approved), None),
        (GateResult::NoOwner, Some((404, "NOT_FOUND"))),
        (
            GateResult::Confirmed(Outcome::Rejected),
            Some((403, "USER_REJECTED")),
        ),
        (
            GateResult::Confirmed(Outcome::TimedOut),
            Some((408, "CONFIRM_TIMEOUT")),
        ),
        (
            GateResult::Confirmed(Outcome::Cancelled(Cause::ServerStop)),
            Some((503, "CONFIRM_CANCELLED")),
        ),
        (
            GateResult::Confirmed(Outcome::Cancelled(Cause::AppExit)),
            Some((503, "CONFIRM_CANCELLED")),
        ),
        (
            GateResult::Confirmed(Outcome::Cancelled(Cause::WindowClosed)),
            Some((503, "CONFIRM_CANCELLED")),
        ),
        (
            GateResult::Confirmed(Outcome::Cancelled(Cause::EmitFailed)),
            Some((503, "CONFIRM_CANCELLED")),
        ),
    ];
    assert_eq!(table.len(), 9, "every gate result is enumerated");
    let rt = paused_runtime();
    let mut distinct = HashSet::new();
    for (input, expected) in table {
        match (response_for(input), expected) {
            (Ok(()), None) => {}
            (Ok(()), Some(want)) => panic!("{input:?} proceeded; want {want:?}"),
            (Err(_), None) => panic!("{input:?} must proceed"),
            (Err(response), Some((status, code))) => {
                let (got_status, got_code, text) = rt.block_on(parts(response));
                assert_eq!((got_status, got_code.as_str()), (status, code), "{input:?}");
                assert!(!text.contains(SENTINEL), "{input:?} body: {text}");
                let body: Value = serde_json::from_str(&text).expect("json");
                assert!(body["error"].as_str().is_some_and(|e| !e.is_empty()));
                distinct.insert((got_status, got_code));
            }
        }
    }
    assert_eq!(
        distinct.len(),
        4,
        "NoOwner/Rejected/TimedOut/Cancelled differ"
    );
    assert!(!distinct.contains(&(403, "CONFIRM_TIMEOUT".to_string())));
}

// ---- H-2 ---------------------------------------------------------------

#[test]
fn h2_owner_focused_proceeds_with_no_prompt_and_no_attention() {
    let rt = paused_runtime();
    rt.block_on(async {
        let fx = RecordingEffects::new();
        let broker = uuid_broker(&fx);
        let store = store_with_d("A", SENTINEL, "x");
        set_focused_window(&store, "A").expect("focus A");
        let start = tokio::time::Instant::now();
        let result = confirm_gate(&broker, &store, "d", Operation::Replace).await;
        assert!(result.is_ok(), "an owner-focused write proceeds");
        assert_eq!(start.elapsed(), std::time::Duration::ZERO, "at once");
        assert_eq!(fx.calls(), Vec::<Call>::new());
        assert_eq!(broker.pending_len(), 0);
    });
}

// ---- H-3 ---------------------------------------------------------------

/// `d` in B, A focused; `end` ends the shown request; returns the mapping.
fn h3_run(fx: RecordingEffects, end: fn(&TestBroker, &str)) -> (u16, String) {
    let rt = paused_runtime();
    rt.block_on(async move {
        let broker = uuid_broker(&fx);
        let store = store_with_d("B", SENTINEL, "x");
        set_focused_window(&store, "A").expect("focus A");
        let handle = spawn_gate(&broker, &store);
        settle().await;
        end(&broker, &nth_uuid(0));
        settle().await;
        if !handle.is_finished() {
            advance_ms(60_000).await;
        }
        error_parts(handle.await.expect("gate task")).await
    })
}

#[test]
fn h3_each_real_outcome_through_the_gate_yields_its_status() {
    let rejected = h3_run(RecordingEffects::new(), |b, id| {
        assert_eq!(reply_from(b, "B", id, false), Ok(ReplyVerdict::Resolved));
    });
    assert_eq!(rejected, (403, "USER_REJECTED".to_string()), "(a) reject");

    let timed_out = h3_run(RecordingEffects::new(), |_, _| {});
    assert_eq!(
        timed_out,
        (408, "CONFIRM_TIMEOUT".to_string()),
        "(b) timeout"
    );

    let stopped = h3_run(RecordingEffects::new(), |b, _| {
        b.cancel_all(Cause::ServerStop).expect("cancel_all");
    });
    assert_eq!(stopped, (503, "CONFIRM_CANCELLED".to_string()), "(c) stop");

    let first = nth_uuid(0);
    let emit_failed = h3_run(RecordingEffects::failing(&[&first]), |_, _| {});
    assert_eq!(
        emit_failed,
        (503, "CONFIRM_CANCELLED".to_string()),
        "(d) emit"
    );
}

// ---- H-4 ---------------------------------------------------------------

#[test]
fn h4_not_found_and_poisoned_store_fail_closed_with_no_prompt() {
    let rt = paused_runtime();
    rt.block_on(async {
        let fx = RecordingEffects::new();
        let broker = uuid_broker(&fx);
        let store = store_with_d("B", SENTINEL, "x");
        let missing = confirm_gate(&broker, &store, "missing", Operation::Replace).await;
        assert_eq!(error_parts(missing).await, (404, "NOT_FOUND".to_string()));

        let poisoned = Arc::clone(&store);
        let _ = std::thread::spawn(move || {
            let _held = poisoned.lock();
            panic!("poisoning the shadow store for a test");
        })
        .join();
        let result = confirm_gate(&broker, &store, "d", Operation::Replace).await;
        assert_eq!(
            error_parts(result).await,
            (500, "INTERNAL_ERROR".to_string())
        );
        assert_eq!(fx.calls(), Vec::<Call>::new());
        assert_eq!(broker.pending_len(), 0);
    });
}

// ---- H-5 ---------------------------------------------------------------

#[test]
fn h5_owner_unfocused_prompts_in_the_owner_and_approval_proceeds() {
    let rt = paused_runtime();
    rt.block_on(async {
        let fx = RecordingEffects::new();
        let broker = uuid_broker(&fx);
        let store = store_with_d("B", SENTINEL, "x");
        let handle = spawn_gate(&broker, &store);
        settle().await;
        let id = broker.shown("B").expect("a request shown in B");
        let calls = fx.calls();
        assert!(calls.len() >= 2, "calls: {calls:?}");
        match &calls[0] {
            Call::Emit {
                window,
                event,
                payload,
            } => {
                assert_eq!(
                    (window.as_str(), event.as_str()),
                    ("B", CONFIRM_REQUEST_EVENT)
                );
                assert_eq!(payload["requestId"], id.as_str());
                assert_eq!(payload["documentId"], "d");
                assert_eq!(payload["documentTitle"], SENTINEL);
                assert_eq!(payload["operation"], "replace");
                assert_eq!(payload["expiresInMs"], 60_000);
            }
            other => panic!("first call is the request emit, got {other:?}"),
        }
        let attention = Call::Attention {
            window: "B".to_string(),
        };
        assert_eq!(calls[1], attention);
        assert_eq!(
            reply_from(&broker, "B", &id, true),
            Ok(ReplyVerdict::Resolved)
        );
        let result = handle.await.expect("gate task");
        assert!(result.is_ok(), "an approved write proceeds");
    });
}
