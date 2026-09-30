//! ADR-0042 WI-9, finding F1: an approved insert applies to the content that
//! is current *after* the confirmation, never to the handler's pre-confirm
//! snapshot, and that post-approval content is the rollback baseline
//! (matrix F1-1 .. F1-4).
//!
//! Wired from `http_server.rs` with `#[cfg(test)] #[path = ...]`, so
//! `http_server.rs` does not grow. Real shadow store, no mocks. The handler
//! itself needs an `AppHandle`; that it passes the re-read `current` to its
//! rollback is pinned structurally by `tests/mcp_confirm_single_gate.rs`
//! SG-1(vii-a).

use super::resolve_insert_current;
use crate::models::{DocumentState, InsertPosition, SharedShadowStore, SyncDocumentsPayload};
use crate::services::shadow_store::{
    create_shadow_store, get_all_documents, get_document, remove_document, sync_documents,
    update_document_content,
};

/// Sync document `d` into window `W` with `content` and `cursor`.
fn put(store: &SharedShadowStore, content: &str, cursor: usize) {
    let doc = DocumentState {
        id: "d".to_string(),
        title: "Doc".to_string(),
        path: Some("/test/d.md".to_string()),
        content: content.to_string(),
        cursor,
        is_dirty: false,
        is_active: true,
    };
    let payload = SyncDocumentsPayload {
        window_label: "W".to_string(),
        documents: vec![doc],
        active_document_id: Some("d".to_string()),
        routable: true,
    };
    sync_documents(store, payload).expect("sync d into W");
}

fn content_of(store: &SharedShadowStore) -> Option<String> {
    get_document(store, "d")
        .expect("store lock")
        .map(|d| d.content)
}

#[test]
fn f1_1_an_edit_made_during_confirmation_is_kept_by_the_approved_insert() {
    let store = create_shadow_store();
    put(&store, "A", 1);
    // The handler's pre-gate snapshot would be "A"; the user then edits.
    let snapshot = content_of(&store).expect("d present");
    assert_eq!(snapshot, "A", "premise: pre-gate snapshot");
    put(&store, "AB", 1);

    // Approval happened; the handler resolves against the store.
    let resolved = resolve_insert_current(&store, "d", &InsertPosition::End, "!");
    // The third element is the byte offset the text goes in at (see F1-2:
    // `new[off..off + text.len()] == text`), so End of "AB" is 2.
    assert_eq!(
        resolved,
        Ok(Some(("AB".to_string(), "AB!".to_string(), 2))),
        "the insert must be computed from the post-approval content"
    );

    let (_current, new, _off) = resolved.expect("ok").expect("some");
    let applied = update_document_content(&store, "d", new).expect("store lock");
    assert!(applied, "d is still open");
    assert_eq!(content_of(&store).as_deref(), Some("AB!"), "not \"A!\"");
}

#[test]
fn f1_2_law_round_trip_and_snapshot_independence() {
    let contents = ["", "A", "AB", "café", "a😀b"];
    let positions = [
        InsertPosition::Start,
        InsertPosition::End,
        InsertPosition::Cursor,
        InsertPosition::Offset(0),
        InsertPosition::Offset(2),
        InsertPosition::Offset(99),
    ];
    let texts = ["!", "é", "😀\n"];
    let mut cases = 0usize;

    for current in contents {
        for position in &positions {
            for text in texts {
                let mut first: Option<(String, String, usize)> = None;
                for snapshot in contents {
                    cases += 1;
                    let store = create_shadow_store();
                    put(&store, snapshot, 1);
                    put(&store, current, 1);
                    let (cur, new, off) = resolve_insert_current(&store, "d", position, text)
                        .unwrap_or_else(|e| panic!("store error: {e}"))
                        .unwrap_or_else(|| panic!("d missing for {current:?}"));
                    let ctx = format!(
                        "snapshot={snapshot:?} current={current:?} pos={position:?} text={text:?}"
                    );

                    assert_eq!(cur, current, "cur is the current content: {ctx}");
                    assert!(cur.is_char_boundary(off), "off on a char boundary: {ctx}");
                    assert!(off + text.len() <= new.len(), "off in range: {ctx}");
                    assert_eq!(&new[off..off + text.len()], text, "text at off: {ctx}");
                    let removed = format!("{}{}", &new[..off], &new[off + text.len()..]);
                    assert_eq!(removed, cur, "round trip: {ctx}");

                    match &first {
                        None => first = Some((cur, new, off)),
                        Some(expected) => assert_eq!(
                            (&cur, &new, &off),
                            (&expected.0, &expected.1, &expected.2),
                            "independent of the snapshot: {ctx}"
                        ),
                    }
                }
            }
        }
    }
    assert_eq!(cases, 450, "the enumeration must cover every combination");
}

#[test]
fn f1_3_a_document_closed_during_confirmation_resolves_to_none() {
    let store = create_shadow_store();
    put(&store, "A", 0);
    assert!(
        remove_document(&store, "d").expect("store lock"),
        "premise: removed"
    );
    let before = get_all_documents(&store).expect("store lock").len();

    let resolved = resolve_insert_current(&store, "d", &InsertPosition::End, "!");

    assert_eq!(
        resolved,
        Ok(None),
        "a gone document is NOT_FOUND, not an insert"
    );
    assert_eq!(get_all_documents(&store).expect("store lock").len(), before);
    assert_eq!(content_of(&store), None, "nothing was written back");
}

#[test]
fn f1_4_the_rollback_baseline_is_the_post_approval_content() {
    let store = create_shadow_store();
    put(&store, "A", 1);
    let snapshot = content_of(&store).expect("d present");
    put(&store, "AB", 1);

    let (current, new, _off) = resolve_insert_current(&store, "d", &InsertPosition::End, "!")
        .expect("store ok")
        .expect("d present");
    assert_eq!(
        current, "AB",
        "the baseline is the re-read, not {snapshot:?}"
    );

    // The handler's apply, then its rollback after a failed emit.
    assert!(update_document_content(&store, "d", new).expect("lock"));
    assert!(update_document_content(&store, "d", current.clone()).expect("lock"));

    assert_eq!(
        content_of(&store).as_deref(),
        Some("AB"),
        "rollback must not erase the edit made during confirmation"
    );
}
