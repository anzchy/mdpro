//! R-1..R-6 (ADR-0042 WI-5): the `mcp_confirm_reply` core `reply_from`,
//! its log line, and the Rust side of the contract fixture's `verdicts`
//! (CT-1). The label is always the caller's; the fake is `RecordingEffects`.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::{reply_from, reply_log, verdict_name, REPLY_LOG_EVENT};
use crate::models::{LogEntryPayload, LogStatus};
use crate::services::mcp_confirm::broker::ConfirmBroker;
use crate::services::mcp_confirm::http::tests::{nth_uuid, uuid_broker, uuid_ids};
use crate::services::mcp_confirm::payload::{ConfirmMeta, Operation};
use crate::services::mcp_confirm::queue::{Outcome, ReplyVerdict};
use crate::services::mcp_confirm::test_effects::{
    outcome, paused_runtime, settle, spawn_confirm, RecordingEffects,
};

const CONTRACT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/mcp-confirm-contract.json"
));

const ALL_VERDICTS: [ReplyVerdict; 4] = [
    ReplyVerdict::Resolved,
    ReplyVerdict::IgnoredUnknown,
    ReplyVerdict::IgnoredWrongWindow,
    ReplyVerdict::IgnoredNotShown,
];

// ---- CT-1 (Rust side) ------------------------------------------------------

#[test]
fn ct1_verdict_serialization_equals_the_fixture_verdicts() {
    let fixture: Value = serde_json::from_str(CONTRACT).expect("fixture parses");
    let want: Vec<String> = fixture["verdicts"]
        .as_array()
        .expect("verdicts list")
        .iter()
        .map(|v| v.as_str().expect("string").to_string())
        .collect();
    assert_eq!(want.len(), ALL_VERDICTS.len(), "every verdict is enumerated");
    let serialized: Vec<String> = ALL_VERDICTS
        .iter()
        .map(|v| serde_json::to_value(v).expect("serializes"))
        .map(|v| v.as_str().expect("a string").to_string())
        .collect();
    assert_eq!(serialized, want);
    let named: Vec<&str> = ALL_VERDICTS.iter().map(|v| verdict_name(*v)).collect();
    assert_eq!(named, want, "the log name is the wire name");
}

// ---- R-1 -------------------------------------------------------------------

#[test]
fn r1_malformed_ids_are_err_with_no_state_change_and_no_panic() {
    let long = "a".repeat(10_240);
    let canonical_plus_x = format!("{}x", nth_uuid(0));
    let inputs: [&str; 7] = ["", " ", &long, "not-a-uuid", "42", &canonical_plus_x, "\u{0}"];
    assert_eq!(inputs.len(), 7);
    let rt = paused_runtime();
    rt.block_on(async {
        let fx = RecordingEffects::new();
        let broker = uuid_broker(&fx);
        let _waiter = spawn_confirm(&broker, "A");
        settle().await;
        let r0 = broker.shown("A").expect("r0 shown in A");
        let pending = broker.pending_len();
        for input in inputs {
            let result = catch_unwind(AssertUnwindSafe(|| reply_from(&broker, "A", input, true)))
                .unwrap_or_else(|_| panic!("reply_from panicked on {:?}", &input[..input.len().min(16)]));
            let msg = result.expect_err("a malformed id is an Err");
            assert!(msg.len() < 200, "short error");
            assert!(!msg.contains(&long), "the input is not echoed");
            if !input.trim().is_empty() {
                assert!(!msg.contains(input), "the input is not echoed");
            }
            assert_eq!(broker.shown("A"), Some(r0.clone()));
            assert_eq!(broker.pending_len(), pending);
        }
    });
}

// ---- R-2 -------------------------------------------------------------------

#[test]
fn r2_a_well_formed_unknown_id_is_ignored_unknown() {
    let fx = RecordingEffects::new();
    let broker = uuid_broker(&fx);
    let unknown = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        reply_from(&broker, "A", &unknown, true),
        Ok(ReplyVerdict::IgnoredUnknown)
    );
}

// ---- R-3 -------------------------------------------------------------------

#[test]
fn r3_wrong_label_is_ignored_and_the_right_label_resolves() {
    let rt = paused_runtime();
    rt.block_on(async {
        let fx = RecordingEffects::new();
        let broker = uuid_broker(&fx);
        let waiter = spawn_confirm(&broker, "B");
        settle().await;
        let r0 = broker.shown("B").expect("r0 shown in B");
        assert_eq!(
            reply_from(&broker, "A", &r0, true),
            Ok(ReplyVerdict::IgnoredWrongWindow)
        );
        settle().await;
        assert!(!waiter.is_finished(), "a sibling's reply leaves it pending");
        assert_eq!(reply_from(&broker, "B", &r0, true), Ok(ReplyVerdict::Resolved));
        assert_eq!(outcome(waiter).await, Outcome::Approved);
    });
}

// ---- R-4 -------------------------------------------------------------------

#[test]
fn r4_law_reply_idempotence() {
    let firsts = [(true, Outcome::Approved), (false, Outcome::Rejected)];
    let seconds = [("B", true), ("B", false), ("A", true)];
    let mut ran = 0;
    for (first, first_outcome) in firsts {
        for (label, second) in seconds {
            let rt = paused_runtime();
            rt.block_on(async {
                let fx = RecordingEffects::new();
                let broker = uuid_broker(&fx);
                let waiter = spawn_confirm(&broker, "B");
                settle().await;
                let r0 = broker.shown("B").expect("r0 shown");
                assert_eq!(reply_from(&broker, "B", &r0, first), Ok(ReplyVerdict::Resolved));
                let again = reply_from(&broker, label, &r0, second);
                assert_eq!(again, Ok(ReplyVerdict::IgnoredUnknown), "{first} then {label}/{second}");
                assert_eq!(outcome(waiter).await, first_outcome);
            });
            ran += 1;
        }
    }
    assert_eq!(ran, 6);
}

// ---- R-5 -------------------------------------------------------------------

/// Decision: the key is the parsed `Uuid` value, so textual variants of a
/// pending id (upper case, braces) resolve that request, and only it.
#[test]
fn r5_textual_variants_of_a_pending_uuid_resolve_it() {
    let variants: [fn(&str) -> String; 2] = [|id| id.to_uppercase(), |id| format!("{{{id}}}")];
    for variant in variants {
        let rt = paused_runtime();
        rt.block_on(async {
            let fx = RecordingEffects::new();
            let broker = uuid_broker(&fx);
            let waiter = spawn_confirm(&broker, "B");
            let other = spawn_confirm(&broker, "C");
            settle().await;
            let r0 = broker.shown("B").expect("r0 shown");
            let text = variant(&r0);
            assert_eq!(reply_from(&broker, "B", &text, true), Ok(ReplyVerdict::Resolved));
            assert_eq!(outcome(waiter).await, Outcome::Approved);
            settle().await;
            assert!(!other.is_finished(), "a variant never resolves another request");
        });
    }
}

// ---- R-6 -------------------------------------------------------------------

#[test]
fn r6_reply_log_builder_has_request_id_and_verdict_only() {
    let r0 = nth_uuid(0);
    let line = reply_log(&r0, &Ok(ReplyVerdict::Resolved), true);
    assert_eq!(line.event, REPLY_LOG_EVENT);
    assert_eq!(line.status, LogStatus::Success);
    let want = json!({ "requestId": r0, "verdict": "resolved", "approved": true });
    assert_eq!(line.context, Some(want));
}

#[test]
fn r6_reply_lines_through_the_core_never_carry_the_title() {
    let rt = paused_runtime();
    rt.block_on(async {
        let lines: Arc<Mutex<Vec<LogEntryPayload>>> = Arc::default();
        let sink_lines = Arc::clone(&lines);
        let fx = RecordingEffects::new();
        let broker = Arc::new(
            ConfirmBroker::new_with(fx, uuid_ids()).with_log_sink(Arc::new(move |line| {
                sink_lines.lock().expect("lines").push(line);
            })),
        );
        let meta = ConfirmMeta {
            document_id: "doc-1".to_string(),
            document_title: "TITLE-SENTINEL".to_string(),
            operation: Operation::Replace,
        };
        let b = Arc::clone(&broker);
        let waiter = tokio::spawn(async move { b.confirm("B", meta).await });
        settle().await;
        let r0 = broker.shown("B").expect("r0 shown");
        assert_eq!(reply_from(&broker, "B", &r0, true), Ok(ReplyVerdict::Resolved));
        assert_eq!(waiter.await.expect("waiter"), Outcome::Approved);
        let lines = lines.lock().expect("lines");
        let replies: Vec<&LogEntryPayload> =
            lines.iter().filter(|l| l.event == REPLY_LOG_EVENT).collect();
        assert_eq!(replies.len(), 2, "a start and an end line: {replies:?}");
        assert_eq!(replies[0].status, LogStatus::Start);
        assert_eq!(replies[1].status, LogStatus::Success);
        for line in replies {
            let text = serde_json::to_string(line).expect("serializes");
            assert!(!text.contains("TITLE-SENTINEL"), "{text}");
            assert!(text.contains(&r0), "{text}");
        }
    });
}
