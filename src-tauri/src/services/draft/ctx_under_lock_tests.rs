//! D27-FIX-1: the `_with` variants build the `LiveContext` while holding the
//! draft lock, exactly once, and decide exactly as the `&LiveContext` path
//! does (ADR-0038 §4: one lock from the check until the act).
//!
//! Every case holds `crate::HOME_LOCK` (`TempHome`), so no other draft test
//! can be the holder `draft_lock_is_held` observes.
use std::cell::RefCell;

use super::super::draft_test_home::{ago, bundle_json, ctx, who, TempHome};
use super::super::{
    cleanup_old_drafts_for, cleanup_old_drafts_for_with, discard_draft_guarded,
    discard_draft_guarded_with, recover_draft_guarded, recover_draft_guarded_with, CleanupCounts,
    DraftError, LiveContext,
};
use super::draft_lock_is_held;
use crate::models::ShadowStore;

const S: &str = "sess-current";
const P: &str = "previous-run";

fn live_ctx() -> LiveContext {
    ctx(S, &["A", "B"], &ShadowStore::default())
}

/// A context provider that records, per call, whether the lock was held.
fn probe(seen: &RefCell<Vec<bool>>) -> impl FnOnce() -> LiveContext + '_ {
    move || {
        seen.borrow_mut().push(draft_lock_is_held());
        live_ctx()
    }
}

fn assert_once_under_lock(seen: &RefCell<Vec<bool>>) {
    assert_eq!(
        *seen.borrow(),
        vec![true],
        "make_ctx must run exactly once, with the draft lock held"
    );
}

#[test]
fn recover_with_builds_ctx_under_lock_and_acts_like_the_ctx_path() {
    let home = TempHome::new("ctx_lock_recover_ok");
    for id in ["a", "b"] {
        home.write_raw(
            id,
            &bundle_json("BODY", Some("/x.md"), &ago(1), false, Some((P, "main"))),
        );
    }
    let seen = RefCell::new(Vec::new());

    let via_with = recover_draft_guarded_with("a", &who(S, "B"), probe(&seen)).expect("with");
    let via_ctx = recover_draft_guarded("b", &who(S, "B"), &live_ctx()).expect("ctx");

    assert_once_under_lock(&seen);
    assert_eq!(via_with.content, via_ctx.content);
    assert_eq!(via_with.original_path, via_ctx.original_path);
    assert_eq!(via_with.title, via_ctx.title);
    for id in ["a", "b"] {
        let v = home.value(id);
        assert_eq!(v["recovered"], serde_json::json!(true), "{id}");
        assert_eq!(v["owner"]["windowLabel"], serde_json::json!("B"), "{id}");
    }
}

#[test]
fn recover_with_refuses_owned_by_live_window_like_the_ctx_path() {
    let home = TempHome::new("ctx_lock_recover_refused");
    for id in ["a", "b"] {
        home.write_raw(
            id,
            &bundle_json("BODY", None, &ago(1), false, Some((S, "A"))),
        );
    }
    let before = home.snapshot();
    let seen = RefCell::new(Vec::new());

    let via_with = recover_draft_guarded_with("a", &who(S, "B"), probe(&seen));
    let via_ctx = recover_draft_guarded("b", &who(S, "B"), &live_ctx());

    assert_once_under_lock(&seen);
    assert!(matches!(via_with, Err(DraftError::OwnedByLiveWindow)));
    assert!(matches!(via_ctx, Err(DraftError::OwnedByLiveWindow)));
    assert_eq!(home.snapshot(), before, "a refusal writes nothing");
}

#[test]
fn discard_with_builds_ctx_under_lock_and_acts_like_the_ctx_path() {
    let home = TempHome::new("ctx_lock_discard_ok");
    for id in ["a", "b"] {
        home.write_raw(
            id,
            &bundle_json("BODY", None, &ago(1), false, Some((P, "main"))),
        );
    }
    let seen = RefCell::new(Vec::new());

    let via_with = discard_draft_guarded_with("a", probe(&seen)).expect("with");
    let via_ctx = discard_draft_guarded("b", &live_ctx()).expect("ctx");

    assert_once_under_lock(&seen);
    assert!(via_with && via_ctx);
    assert!(!home.exists("a") && !home.exists("b"));
}

#[test]
fn discard_with_refuses_owned_by_live_window_like_the_ctx_path() {
    let home = TempHome::new("ctx_lock_discard_refused");
    for id in ["a", "b"] {
        home.write_raw(
            id,
            &bundle_json("BODY", None, &ago(1), false, Some((S, "A"))),
        );
    }
    let before = home.snapshot();
    let seen = RefCell::new(Vec::new());

    let via_with = discard_draft_guarded_with("a", probe(&seen));
    let via_ctx = discard_draft_guarded("b", &live_ctx());

    assert_once_under_lock(&seen);
    assert!(matches!(via_with, Err(DraftError::OwnedByLiveWindow)));
    assert!(matches!(via_ctx, Err(DraftError::OwnedByLiveWindow)));
    assert_eq!(home.snapshot(), before, "a refusal deletes nothing");
}

/// One stale recovered bundle nobody uses, and one a live window owns.
fn write_cleanup_pair(home: &TempHome) {
    home.write_raw(
        "dead",
        &bundle_json("D", None, &ago(8), true, Some((P, "main"))),
    );
    home.write_raw(
        "live",
        &bundle_json("L", None, &ago(8), true, Some((S, "A"))),
    );
}

#[test]
fn cleanup_with_builds_ctx_under_lock_and_counts_like_the_ctx_path() {
    let home = TempHome::new("ctx_lock_cleanup");
    let expected = CleanupCounts {
        deleted: 1,
        skipped_live: 1,
    };

    write_cleanup_pair(&home);
    let seen = RefCell::new(Vec::new());
    let via_with = cleanup_old_drafts_for_with(probe(&seen)).expect("with");
    assert_once_under_lock(&seen);
    assert_eq!(via_with, expected);
    assert!(!home.exists("dead") && home.exists("live"));

    write_cleanup_pair(&home);
    let via_ctx = cleanup_old_drafts_for(&live_ctx()).expect("ctx");
    assert_eq!(via_ctx, via_with);
    assert!(!home.exists("dead") && home.exists("live"));
}
