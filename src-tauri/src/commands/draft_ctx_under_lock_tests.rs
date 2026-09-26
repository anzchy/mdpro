//! D27-FIX-1: the command seams the Tauri shells call build the
//! `LiveContext` inside the quit gate and under the draft lock, in the order
//! gate (outer) → draft lock → context. A closed gate never builds one.
//!
//! Every case holds `crate::HOME_LOCK` (`TempHome`), so no other draft test
//! can be the holder `draft_lock_is_held` observes.
use std::cell::RefCell;

use super::draft_recovery::{
    cleanup_old_drafts_logged_with, discard_recovery_draft_logged_with, recover_draft_gated_with,
    recover_draft_logged_with,
};
use crate::models::ShadowStore;
use crate::services::draft::{
    draft_lock_is_held, DraftError, DraftOwner, LiveContext, OpenSet, ShadowUnavailable,
};
use crate::services::quit_guard::DraftGate;

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/draft/draft_test_home.rs"]
mod draft_test_home;
use draft_test_home::{ago, bundle_json, ctx, who, TempHome};

const S: &str = "sess-current";
const P: &str = "previous-run";

fn probe(seen: &RefCell<Vec<bool>>) -> impl FnOnce() -> LiveContext + '_ {
    move || {
        seen.borrow_mut().push(draft_lock_is_held());
        ctx(S, &["A", "B"], &ShadowStore::default())
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
fn gated_recover_builds_ctx_under_the_lock_inside_an_open_gate() {
    static GATE: DraftGate = DraftGate::new();
    let home = TempHome::new("cmd_ctx_lock_gated_open");
    home.write_raw(
        "d",
        &bundle_json("B", None, &ago(1), false, Some((P, "main"))),
    );
    let seen = RefCell::new(Vec::new());

    let r = recover_draft_gated_with(&GATE, "d", &who(S, "B"), probe(&seen));

    assert!(r.is_ok(), "{r:?}");
    assert_once_under_lock(&seen);
}

#[test]
fn a_closed_gate_never_builds_a_ctx() {
    static GATE: DraftGate = DraftGate::new();
    let home = TempHome::new("cmd_ctx_lock_gated_closed");
    home.write_raw(
        "d",
        &bundle_json("B", None, &ago(1), false, Some((P, "main"))),
    );
    let before = home.read_raw("d");
    drop(GATE.close());
    let seen = RefCell::new(Vec::new());

    let r = recover_draft_gated_with(&GATE, "d", &who(S, "B"), probe(&seen));

    assert!(matches!(r, Err(DraftError::IoError { .. })), "{r:?}");
    assert!(seen.borrow().is_empty(), "ctx built outside the gate");
    assert_eq!(home.read_raw("d"), before);
}

#[test]
fn the_logged_seams_build_ctx_under_the_lock() {
    static GATE: DraftGate = DraftGate::new();
    let home = TempHome::new("cmd_ctx_lock_logged");
    home.write_raw(
        "r",
        &bundle_json("R", None, &ago(1), false, Some((P, "main"))),
    );
    home.write_raw(
        "x",
        &bundle_json("X", None, &ago(1), false, Some((P, "main"))),
    );

    let seen = RefCell::new(Vec::new());
    let r = recover_draft_logged_with(&GATE, "r", &who(S, "B"), probe(&seen));
    assert!(r.is_ok(), "{r:?}");
    assert_once_under_lock(&seen);

    let seen = RefCell::new(Vec::new());
    assert!(matches!(
        discard_recovery_draft_logged_with("x", probe(&seen)),
        Ok(true)
    ));
    assert_once_under_lock(&seen);

    let seen = RefCell::new(Vec::new());
    assert!(cleanup_old_drafts_logged_with(probe(&seen)).is_ok());
    assert_once_under_lock(&seen);
}
