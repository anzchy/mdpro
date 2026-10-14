//! D98: an over-cap document is refused with 413 `DOCUMENT_TOO_LARGE` on
//! every MCP read and write route, before any confirmation prompt; a normal
//! or missing document is left to the handler as before. The handlers need an
//! `AppHandle`, so the refusal is pinned at function level and its call
//! sites by source order.

use super::{over_limit_refusal, DOCUMENT_TOO_LARGE};
use crate::models::{DocumentInfo, DocumentState, SharedShadowStore, SyncDocumentsPayload};
use crate::services::shadow_store;
use axum::http::StatusCode;

fn doc(id: &str, over_limit: bool) -> DocumentState {
    DocumentState {
        id: id.to_string(),
        title: id.to_string(),
        path: None,
        content: if over_limit {
            String::new()
        } else {
            "# hi".to_string()
        },
        cursor: 0,
        is_dirty: false,
        is_active: false,
        over_limit,
    }
}

fn store() -> SharedShadowStore {
    let store = shadow_store::create_shadow_store();
    shadow_store::sync_documents(
        &store,
        SyncDocumentsPayload {
            window_label: "main".to_string(),
            documents: vec![doc("big", true), doc("small", false)],
            active_document_id: None,
            routable: true,
        },
    )
    .expect("sync");
    store
}

#[tokio::test]
async fn o1_an_over_cap_document_is_refused_with_413_document_too_large() {
    let refused = over_limit_refusal(&store(), "big", "mcp.read").expect("refused");
    assert_eq!(refused.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let body = axum::body::to_bytes(refused.into_body(), usize::MAX)
        .await
        .expect("body");
    let wire: serde_json::Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(wire["code"], serde_json::json!(DOCUMENT_TOO_LARGE));
    assert!(wire["error"].as_str().is_some_and(|e| e.contains("big")));
}

#[test]
fn o2_a_normal_document_is_not_refused() {
    assert!(over_limit_refusal(&store(), "small", "mcp.read").is_none());
}

#[test]
fn o3_a_document_that_is_not_open_is_left_to_the_handler() {
    assert!(over_limit_refusal(&store(), "gone", "mcp.read").is_none());
}

#[test]
fn o4_the_document_list_flags_an_over_cap_document_and_only_that_one() {
    let big = serde_json::to_value(DocumentInfo::from(&doc("big", true))).expect("json");
    assert_eq!(big["over_limit"], serde_json::json!(true));
    let small = serde_json::to_value(DocumentInfo::from(&doc("small", false))).expect("json");
    assert!(
        small.get("over_limit").is_none(),
        "unchanged wire for normal documents"
    );
}

#[test]
fn o5_the_capped_flag_never_reaches_a_serialized_document_state() {
    let wire = serde_json::to_value(doc("big", true)).expect("json");
    assert!(wire.get("over_limit").is_none());
}

/// The body of `fn <name>` in `http_server.rs`, up to the next top-level item.
fn handler_body(name: &str) -> &'static str {
    let src = include_str!("http_server.rs");
    let start = src.find(&format!("fn {name}(")).expect("handler present");
    let rest = &src[start..];
    let end = rest[1..].find("\nasync fn ").map_or(rest.len(), |i| i + 1);
    &rest[..end]
}

#[test]
fn o6_every_mcp_read_and_write_route_refuses_before_the_confirmation_gate() {
    for handler in ["update_document", "insert_content", "dispatch_table_action"] {
        let body = handler_body(handler);
        let refusal = body.find("over_limit_refusal(").expect(handler);
        let gate = body.find("confirm_gate(").expect(handler);
        assert!(
            refusal < gate,
            "{handler}: refusal must come before the prompt"
        );
    }
    let read = handler_body("get_document");
    let refusal = read.find("over_limit_refusal(").expect("get_document");
    let lookup = read
        .find("shadow_store::get_document(")
        .expect("get_document");
    assert!(refusal < lookup);
}
