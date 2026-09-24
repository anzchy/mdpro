//! Specification for how `sync_documents` writes the `routable` flag (D29
//! WI-1, ADR-0033). Law: last write wins, per window. After any sequence of
//! syncs and removals for a label, its `routable` and `documents` equal the
//! most recent payload for that label, and other labels are untouched.

use super::*;

fn doc(id: &str) -> DocumentState {
    DocumentState {
        id: id.to_string(),
        title: id.to_string(),
        path: Some(format!("/test/{}.md", id)),
        content: String::new(),
        cursor: 0,
        is_dirty: false,
        is_active: true,
    }
}

fn sync(store: &SharedShadowStore, label: &str, doc_id: &str, routable: bool) {
    let payload = SyncDocumentsPayload {
        window_label: label.to_string(),
        documents: vec![doc(doc_id)],
        active_document_id: Some(doc_id.to_string()),
        routable,
    };
    sync_documents(store, payload).unwrap();
}

/// Every flag sequence of length 1 to 3 over {true, false}: 14 sequences.
fn all_sequences() -> Vec<Vec<bool>> {
    let mut out = Vec::new();
    for len in 1..=3u32 {
        for bits in 0..(1u32 << len) {
            out.push((0..len).map(|i| bits & (1 << i) != 0).collect());
        }
    }
    out
}

#[test]
fn sync_routable_last_write_wins_exhaustive() {
    let sequences = all_sequences();
    assert_eq!(sequences.len(), 14);
    for seq in sequences {
        let store = create_shadow_store();
        for (i, flag) in seq.iter().enumerate() {
            sync(&store, "mdpro-a", &format!("d{}", i), *flag);
        }
        let shadow = store.lock().unwrap();
        let window = shadow.windows.get("mdpro-a").expect("window synced");
        assert_eq!(window.routable, *seq.last().unwrap(), "sequence {seq:?}");
        assert_eq!(
            window.documents[0].id,
            format!("d{}", seq.len() - 1),
            "sequence {seq:?}"
        );
    }
}

#[test]
fn sync_after_remove_window_recreates_entry() {
    for r in [true, false] {
        let store = create_shadow_store();
        sync(&store, "mdpro-a", "d1", true);
        remove_window(&store, "mdpro-a").unwrap();
        assert!(
            !store.lock().unwrap().windows.contains_key("mdpro-a"),
            "remove_window must drop the entry"
        );

        sync(&store, "mdpro-a", "d2", r);

        let shadow = store.lock().unwrap();
        let window = shadow.windows.get("mdpro-a").expect("entry recreated");
        let ids: Vec<&str> = window.documents.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, vec!["d2"], "routable={r}");
        assert_eq!(window.routable, r);
        assert_eq!(window.active_document_id.as_deref(), Some("d2"));
    }
}

#[test]
fn resync_preserves_last_focused_at() {
    let store = create_shadow_store();
    sync(&store, "mdpro-a", "d1", false);
    store
        .lock()
        .unwrap()
        .windows
        .get_mut("mdpro-a")
        .unwrap()
        .last_focused_at = 42;

    sync(&store, "mdpro-a", "d2", true);

    let shadow = store.lock().unwrap();
    let window = shadow.windows.get("mdpro-a").unwrap();
    assert_eq!(window.last_focused_at, 42);
    assert!(window.routable);
    assert_eq!(window.documents[0].id, "d2");
}

#[test]
fn sync_routable_is_per_window() {
    let store = create_shadow_store();
    sync(&store, "mdpro-a", "d1", true);
    sync(&store, "mdpro-b", "d2", false);

    let shadow = store.lock().unwrap();
    assert!(shadow.windows["mdpro-a"].routable);
    assert!(!shadow.windows["mdpro-b"].routable);
}
