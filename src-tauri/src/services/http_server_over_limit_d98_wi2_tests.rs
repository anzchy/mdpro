//! D98-WI-2 (audit b122 M1, M2): the over-cap refusal must hold on the
//! snapshot each handler actually uses. The pre-gate check reads the store
//! once; a document that crosses the cap while the confirm prompt is open, or
//! between the read route's check and its lookup, was then served or written
//! from that later snapshot.

use super::{over_limit_refusal, refuse_over_limit_doc, DOCUMENT_TOO_LARGE};
use crate::models::{DocumentState, SharedShadowStore, SyncDocumentsPayload};
use crate::services::shadow_store;
use axum::http::StatusCode;

fn doc(over_limit: bool) -> DocumentState {
    DocumentState {
        id: "d".to_string(),
        title: "d".to_string(),
        path: None,
        content: if over_limit {
            String::new()
        } else {
            "# hi".to_string()
        },
        cursor: 0,
        is_dirty: true,
        is_active: true,
        over_limit,
    }
}

fn sync(store: &SharedShadowStore, over_limit: bool) {
    shadow_store::sync_documents(
        store,
        SyncDocumentsPayload {
            window_label: "main".to_string(),
            documents: vec![doc(over_limit)],
            active_document_id: Some("d".to_string()),
            routable: true,
        },
    )
    .expect("sync");
}

#[tokio::test]
async fn w1_a_capped_snapshot_is_refused_with_413() {
    let refused = refuse_over_limit_doc(&doc(true), "mcp.write").expect("refused");
    assert_eq!(refused.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let body = axum::body::to_bytes(refused.into_body(), usize::MAX)
        .await
        .expect("body");
    let wire: serde_json::Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(wire["code"], serde_json::json!(DOCUMENT_TOO_LARGE));
}

#[test]
fn w2_a_normal_snapshot_is_not_refused() {
    assert!(refuse_over_limit_doc(&doc(false), "mcp.write").is_none());
}

#[test]
fn w3_a_document_that_crosses_the_cap_while_the_prompt_is_open_is_refused_after() {
    let store = shadow_store::create_shadow_store();
    sync(&store, false);
    assert!(
        over_limit_refusal(&store, "d", "mcp.write").is_none(),
        "pre-gate: fine"
    );

    // The user approves while the document grows past the cap.
    sync(&store, true);

    let reread = shadow_store::get_document(&store, "d")
        .unwrap()
        .expect("open");
    assert!(refuse_over_limit_doc(&reread, "mcp.write").is_some());
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
fn w4_write_and_insert_recheck_the_snapshot_they_use_after_the_gate() {
    for (handler, reread) in [
        ("update_document", "shadow_store::get_document("),
        ("insert_content", "shadow_store::get_document("),
    ] {
        let body = handler_body(handler);
        let gate = body.find("confirm_gate(").expect(handler);
        let after = &body[gate..];
        let read = after.find(reread).expect(handler);
        let check = after.find("refuse_over_limit_doc(").expect(handler);
        assert!(read < check, "{handler}: recheck the re-read snapshot");
    }
    let insert = handler_body("insert_content");
    let check = insert.find("refuse_over_limit_doc(").expect("insert check");
    let resolve = insert
        .find("resolve_insert_in(")
        .expect("insert resolves its snapshot");
    assert!(
        check < resolve,
        "insert_content: refuse before computing the insert"
    );
}

#[test]
fn w5_table_actions_recheck_after_the_gate() {
    let body = handler_body("dispatch_table_action");
    let gate = body.find("confirm_gate(").expect("gate");
    assert!(
        body[gate..].contains("over_limit_refusal("),
        "dispatch_table_action: recheck after approval"
    );
}

#[test]
fn w6_the_read_route_checks_the_snapshot_it_returns() {
    let body = handler_body("get_document");
    let lookup = body.find("shadow_store::get_document(").expect("lookup");
    let check = body[lookup..].find("refuse_over_limit_doc(&doc");
    assert!(check.is_some(), "get_document: check the doc it serves");
}
