//! Specification for `owner_and_focus` (ADR-0042 WI-1). Law: with nothing
//! else running, `owner_and_focus(s, d)` equals
//! `(get_window_for_document(s, d)?, focused_window)`, both read under one
//! lock, and a poisoned lock is an `Err`, never a panic.

use super::*;
use crate::services::mcp_confirm::gate::{decide, Gate};
use std::panic::{catch_unwind, AssertUnwindSafe};

fn doc(id: &str) -> DocumentState {
    DocumentState {
        id: id.to_string(),
        title: id.to_string(),
        path: Some(format!("/test/{}.md", id)),
        content: String::new(),
        cursor: 0,
        is_dirty: false,
        is_active: true,
        over_limit: false,
    }
}

fn sync(store: &SharedShadowStore, label: &str, ids: &[&str]) {
    let payload = SyncDocumentsPayload {
        window_label: label.to_string(),
        documents: ids.iter().map(|id| doc(id)).collect(),
        active_document_id: ids.first().map(|id| id.to_string()),
        routable: true,
    };
    sync_documents(store, payload).unwrap();
}

#[derive(Debug, Clone, Copy)]
enum Op {
    SyncAd,
    SyncAEmpty,
    SyncBd,
    SyncBEmpty,
    FocusA,
    FocusB,
    BlurIfA,
    RemoveWindowA,
}

const OPS: [Op; 8] = [
    Op::SyncAd,
    Op::SyncAEmpty,
    Op::SyncBd,
    Op::SyncBEmpty,
    Op::FocusA,
    Op::FocusB,
    Op::BlurIfA,
    Op::RemoveWindowA,
];

fn apply(store: &SharedShadowStore, op: Op) {
    match op {
        Op::SyncAd => sync(store, "A", &["d"]),
        Op::SyncAEmpty => sync(store, "A", &[]),
        Op::SyncBd => sync(store, "B", &["d"]),
        Op::SyncBEmpty => sync(store, "B", &[]),
        Op::FocusA => set_focused_window(store, "A").unwrap(),
        Op::FocusB => set_focused_window(store, "B").unwrap(),
        Op::BlurIfA => clear_focused_window_if(store, "A").unwrap(),
        Op::RemoveWindowA => remove_window(store, "A").unwrap(),
    }
}

/// Every op sequence of length 0 to 4 over the 8-op alphabet.
fn all_sequences() -> Vec<Vec<Op>> {
    let mut out: Vec<Vec<Op>> = vec![Vec::new()];
    let mut frontier: Vec<Vec<Op>> = vec![Vec::new()];
    for _ in 0..4 {
        let mut next = Vec::new();
        for seq in &frontier {
            for op in OPS {
                let mut s = seq.clone();
                s.push(op);
                next.push(s);
            }
        }
        out.extend(next.iter().cloned());
        frontier = next;
    }
    out
}

/// OF-1: agreement with the separate readers after every step.
#[test]
fn of1_agrees_with_separate_readers_across_transitions() {
    let seqs = all_sequences();
    assert_eq!(seqs.len(), 4681, "1+8+64+512+4096 sequences");
    let mut runs = 0;
    for seq in &seqs {
        let store = create_shadow_store();
        let mut trace: Vec<Op> = Vec::new();
        let check = |trace: &[Op]| {
            let owner = get_window_for_document(&store, "d").unwrap();
            let focused = store.lock().unwrap().focused_window.clone();
            assert_eq!(
                owner_and_focus(&store, "d").unwrap(),
                (owner, focused),
                "trace {trace:?}"
            );
        };
        check(&trace);
        for &op in seq {
            let was_focused_a = store.lock().unwrap().focused_window.as_deref() == Some("A");
            apply(&store, op);
            trace.push(op);
            check(&trace);
            if matches!(op, Op::RemoveWindowA) && was_focused_a {
                assert_eq!(
                    owner_and_focus(&store, "d").unwrap().1,
                    None,
                    "removing the focused window clears focus: {trace:?}"
                );
            }
        }
        runs += 1;
    }
    assert_eq!(runs, 4681);
}

/// Pins the pair to concrete values so OF-1 cannot pass against a reader
/// that shares a bug with `get_window_for_document`.
#[test]
fn of1_concrete_owner_b_focus_a() {
    let store = create_shadow_store();
    sync(&store, "A", &["x"]);
    sync(&store, "B", &["d"]);
    set_focused_window(&store, "A").unwrap();
    assert_eq!(
        owner_and_focus(&store, "d").unwrap(),
        (Some("B".to_string()), Some("A".to_string()))
    );
}

/// OF-2: a poisoned lock is an `Err` mentioning the lock, not a panic.
#[test]
fn of2_poisoned_lock_is_err_not_panic() {
    let store = create_shadow_store();
    let poisoner = store.clone();
    let joined = std::thread::spawn(move || {
        let _guard = poisoner.lock().unwrap();
        panic!("poison the shadow store for OF-2");
    })
    .join();
    assert!(joined.is_err(), "the poisoning thread must have panicked");
    assert!(store.is_poisoned(), "precondition: the mutex is poisoned");

    let outcome = catch_unwind(AssertUnwindSafe(|| owner_and_focus(&store, "d")));
    let result = outcome.expect("owner_and_focus must not panic on a poisoned lock");
    let msg = result.expect_err("a poisoned lock must be reported as Err");
    assert!(msg.contains("lock"), "message names the lock: {msg}");
}

/// OF-3 (a): focus without any synced window, unknown document.
#[test]
fn of3a_focus_without_synced_window() {
    let store = create_shadow_store();
    set_focused_window(&store, "A").unwrap();
    let pair = owner_and_focus(&store, "d").unwrap();
    assert_eq!(pair, (None, Some("A".to_string())));
    assert_eq!(decide(pair.0.as_deref(), pair.1.as_deref()), Gate::NoOwner);
}

/// OF-3 (b): window A synced with another document and focused.
#[test]
fn of3b_unknown_document_in_focused_window() {
    let store = create_shadow_store();
    sync(&store, "A", &["x"]);
    set_focused_window(&store, "A").unwrap();
    let pair = owner_and_focus(&store, "d").unwrap();
    assert_eq!(pair, (None, Some("A".to_string())));
    assert_eq!(decide(pair.0.as_deref(), pair.1.as_deref()), Gate::NoOwner);
}
