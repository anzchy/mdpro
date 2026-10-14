//! D98: one document over 10 MiB no longer stops a window's sync. The sync
//! keeps every other document current and marks the large one `over_limit`
//! with its content dropped, so MCP refuses it instead of serving stale text
//! (`services/http_server_over_limit.rs`). Mixed-size payloads throughout.

use super::super::validate_sync_payload;
use super::{cap_oversize_documents, MAX_DOCUMENT_CONTENT_BYTES};
use crate::models::{DocumentState, SyncDocumentsPayload};
use crate::services::shadow_store;

fn doc(id: &str, content: String, is_dirty: bool) -> DocumentState {
    DocumentState {
        id: id.to_string(),
        title: id.to_string(),
        path: Some(format!("/d98/{id}.md")),
        content,
        cursor: 3,
        is_dirty,
        is_active: id == "a",
        over_limit: false,
    }
}

fn mixed(big_len: usize) -> SyncDocumentsPayload {
    SyncDocumentsPayload {
        window_label: "main".to_string(),
        documents: vec![
            doc("a", "# small a".to_string(), false),
            doc("big", "x".repeat(big_len), true),
            doc("c", "# small c".to_string(), false),
        ],
        active_document_id: Some("a".to_string()),
        routable: true,
    }
}

#[test]
fn s1_a_payload_with_one_oversize_document_is_accepted() {
    assert!(validate_sync_payload(&mixed(MAX_DOCUMENT_CONTENT_BYTES + 1)).is_ok());
}

#[test]
fn s2_only_the_oversize_document_is_capped() {
    let mut payload = mixed(MAX_DOCUMENT_CONTENT_BYTES + 1);
    let capped = cap_oversize_documents(&mut payload);

    assert_eq!(
        capped,
        vec![("big".to_string(), MAX_DOCUMENT_CONTENT_BYTES + 1)]
    );
    let big = &payload.documents[1];
    assert!(big.over_limit);
    assert!(big.content.is_empty());
    assert_eq!(big.cursor, 0);
    assert!(big.is_dirty, "the dirty flag is the frontend's and is kept");
    for (i, text) in [(0, "# small a"), (2, "# small c")] {
        assert!(!payload.documents[i].over_limit);
        assert_eq!(payload.documents[i].content, text);
        assert_eq!(payload.documents[i].cursor, 3);
    }
}

#[test]
fn s3_a_document_of_exactly_the_cap_is_not_capped() {
    let mut payload = mixed(MAX_DOCUMENT_CONTENT_BYTES);
    assert!(cap_oversize_documents(&mut payload).is_empty());
    assert_eq!(
        payload.documents[1].content.len(),
        MAX_DOCUMENT_CONTENT_BYTES
    );
    assert!(!payload.documents[1].over_limit);
}

#[test]
fn s4_after_a_capped_sync_the_store_has_the_small_documents_current() {
    let store = shadow_store::create_shadow_store();
    let mut payload = mixed(MAX_DOCUMENT_CONTENT_BYTES + 1);
    cap_oversize_documents(&mut payload);
    shadow_store::sync_documents(&store, payload).expect("sync");

    let a = shadow_store::get_document(&store, "a")
        .unwrap()
        .expect("a is synced");
    assert_eq!(a.content, "# small a");
    let big = shadow_store::get_document(&store, "big")
        .unwrap()
        .expect("big is listed");
    assert!(big.over_limit);
    assert!(big.content.is_empty());
}

#[test]
fn s5_a_document_back_under_the_cap_syncs_normally_again() {
    let store = shadow_store::create_shadow_store();
    let mut over = mixed(MAX_DOCUMENT_CONTENT_BYTES + 1);
    cap_oversize_documents(&mut over);
    shadow_store::sync_documents(&store, over).expect("sync");

    let mut under = mixed(16);
    cap_oversize_documents(&mut under);
    shadow_store::sync_documents(&store, under).expect("sync");

    let big = shadow_store::get_document(&store, "big")
        .unwrap()
        .expect("big");
    assert!(!big.over_limit);
    assert_eq!(big.content, "x".repeat(16));
}

#[test]
fn s6_every_oversize_document_is_reported() {
    let mut payload = mixed(MAX_DOCUMENT_CONTENT_BYTES + 1);
    payload.documents[2].content = "y".repeat(MAX_DOCUMENT_CONTENT_BYTES + 7);
    let capped = cap_oversize_documents(&mut payload);
    assert_eq!(
        capped,
        vec![
            ("big".to_string(), MAX_DOCUMENT_CONTENT_BYTES + 1),
            ("c".to_string(), MAX_DOCUMENT_CONTENT_BYTES + 7),
        ]
    );
    assert_eq!(payload.documents[0].content, "# small a");
}

#[test]
fn s7_the_cap_is_logged_as_ids_and_sizes_with_no_content() {
    use crate::models::{LogLevel, LogStatus};
    let capped = vec![("big".to_string(), MAX_DOCUMENT_CONTENT_BYTES + 1)];
    let entry = super::capped_entry("main", &capped);
    assert_eq!(entry.event, "mcp.sync");
    assert_eq!(entry.level, LogLevel::Warn);
    assert_eq!(entry.status, LogStatus::Fail);
    assert_eq!(
        entry.context,
        Some(serde_json::json!({
            "windowLabel": "main",
            "reason": "over limit",
            "limitBytes": MAX_DOCUMENT_CONTENT_BYTES,
            "documents": [{ "documentId": "big", "bytes": MAX_DOCUMENT_CONTENT_BYTES + 1 }],
        }))
    );
}
