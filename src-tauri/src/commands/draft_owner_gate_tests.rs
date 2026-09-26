//! D27 WI-3 c1-c5, c3b, c4b: owner stamping on the gated save, and the quit
//! gate around the guarded recover (ADR-0038 §1, §4; ADR-0025 §4).
//!
//! Every case writes real drafts in a temp `$HOME` under `crate::HOME_LOCK`
//! (`draft_test_home::TempHome`).
use super::draft::{save_draft_gated, save_draft_gated_as, save_draft_logged};
use super::draft_recovery::recover_draft_gated;
use crate::models::ShadowStore;
use crate::services::draft::{
    draft_lock, DraftError, DraftOwner, LiveContext, OpenSet, ShadowUnavailable,
};
use crate::services::quit_guard::{self, DraftGate, QUIT_COMMITTED};
use serde_json::json;
use std::sync::mpsc;
use std::time::Duration;

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/draft/draft_test_home.rs"]
mod draft_test_home;
use draft_test_home::{ago, bundle_json, ctx, who, TempHome};

const S: &str = "sess-current";
const P: &str = "previous-run";
const EVENTUALLY: Duration = Duration::from_secs(10);
const SETTLE: Duration = Duration::from_millis(200);

struct QuitCommittedReset;
impl Drop for QuitCommittedReset {
    fn drop(&mut self) {
        quit_guard::reset_quit_committed_for_tests();
    }
}

fn is_quit_refusal(err: &DraftError) -> bool {
    matches!(err, DraftError::IoError { .. }) && err.to_string().to_lowercase().contains("quit")
}

fn empty_ctx(live: &[&str]) -> LiveContext {
    ctx(S, live, &ShadowStore::default())
}

#[test]
fn c1_open_gate_with_an_owner_writes_an_owned_bundle() {
    let home = TempHome::new("owner_gate_c1");
    let result = save_draft_gated_as(&DraftGate::new(), Some(who(S, "W")), "d", "B", None, "t")
        .expect("an open gate saves");
    assert!(result.success);
    let v = home.value("d");
    assert_eq!(v["owner"], json!({"sessionId": S, "windowLabel": "W"}));
    assert_eq!(v["recovered"], json!(false));
    assert_eq!(v["content"], json!("B"));
}

#[test]
fn c2_a_committed_quit_refuses_the_owned_save_and_writes_nothing() {
    let home = TempHome::new("owner_gate_c2");
    let gate = DraftGate::new();
    save_draft_gated(&gate, "kept", "OLD", None, "t").expect("seed kept");
    let kept = home.read_raw("kept");
    drop(gate.close());

    for id in ["gone", "kept"] {
        let err = save_draft_gated_as(&gate, Some(who(S, "W")), id, "NEW", None, "t")
            .expect_err("a save after the quit committed must be refused");
        assert!(
            is_quit_refusal(&err),
            "{id}: expected a quit IoError, got {err:?}"
        );
    }
    assert!(!home.exists("gone"), "a refused save wrote a new draft");
    assert_eq!(
        home.read_raw("kept"),
        kept,
        "a refused save rewrote the bundle"
    );
}

#[test]
fn c3_save_draft_gated_still_writes_an_unowned_bundle() {
    let home = TempHome::new("owner_gate_c3");
    save_draft_gated(&DraftGate::new(), "d", "B", None, "t").expect("save");
    assert!(
        home.value("d").get("owner").is_none(),
        "save_draft_gated must not stamp an owner"
    );
}

#[test]
fn c3b_the_autosave_seam_writes_the_owner_it_is_given() {
    let home = TempHome::new("owner_gate_c3b");
    quit_guard::reset_quit_committed_for_tests();
    let _reset = QuitCommittedReset;
    assert!(!QUIT_COMMITTED.is_closed(), "precondition: gate open");

    save_draft_logged(Some(who(S, "W")), "d", "B", None, "t").expect("owned save");
    assert_eq!(
        home.value("d")["owner"],
        json!({"sessionId": S, "windowLabel": "W"})
    );

    save_draft_logged(None, "d", "B", None, "t").expect("unowned save");
    assert!(home.value("d").get("owner").is_none());
}

#[test]
fn c4_recover_after_a_committed_quit_is_refused_and_marks_nothing() {
    let home = TempHome::new("owner_gate_c4");
    home.write_raw(
        "d",
        &bundle_json("B", None, &ago(1), false, Some((P, "main"))),
    );
    let pre = home.read_raw("d");
    let gate = DraftGate::new();
    drop(gate.close());

    let err = recover_draft_gated(&gate, "d", &who(S, "B"), &empty_ctx(&["main", "B"]))
        .expect_err("a recover after the quit committed must be refused");
    assert!(
        is_quit_refusal(&err),
        "expected a quit IoError, got {err:?}"
    );
    assert_eq!(
        home.read_raw("d"),
        pre,
        "the refused recover rewrote the bundle"
    );
    assert_eq!(home.value("d")["recovered"], json!(false));
}

#[test]
fn c4b_the_quit_gate_is_held_across_the_whole_guarded_recover() {
    static GATE: DraftGate = DraftGate::new();
    let home = TempHome::new("owner_gate_c4b");
    home.write_raw(
        "d",
        &bundle_json("B", None, &ago(1), false, Some((P, "main"))),
    );
    let pre = home.read_raw("d");
    let path = home.bundle("d");
    let c = empty_ctx(&["main", "B"]);

    let dl = draft_lock();
    let (r_tx, r_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = r_tx.send(recover_draft_gated(&GATE, "d", &who(S, "B"), &c));
    });
    std::thread::sleep(SETTLE);
    let (k_tx, k_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let g = GATE.close();
        let at_close = std::fs::read(&path).expect("read at close");
        drop(g);
        let _ = k_tx.send(at_close);
    });
    std::thread::sleep(SETTLE);
    drop(dl);

    let r = r_rx
        .recv_timeout(EVENTUALLY)
        .expect("R finished (no deadlock)");
    let at_close = k_rx
        .recv_timeout(EVENTUALLY)
        .expect("K finished (no deadlock)");

    assert_eq!(
        home.read_raw("d"),
        at_close,
        "a recover wrote after close() returned"
    );
    match r {
        Ok(_) => {
            let v: serde_json::Value = serde_json::from_slice(&at_close).expect("parses");
            assert_eq!(v["recovered"], json!(true));
            assert_eq!(v["owner"], json!({"sessionId": S, "windowLabel": "B"}));
            assert_ne!(at_close, pre);
        }
        Err(err) => {
            assert!(
                is_quit_refusal(&err),
                "expected a quit IoError, got {err:?}"
            );
            assert_eq!(at_close, pre);
        }
    }
}

#[test]
fn c5_an_open_gate_passes_typed_refusals_through_unmasked() {
    let home = TempHome::new("owner_gate_c5");
    home.write_raw(
        "owned",
        &bundle_json("B", None, &ago(1), false, Some((S, "A"))),
    );
    let gate = DraftGate::new();
    let c = empty_ctx(&["A", "B"]);

    let owned = recover_draft_gated(&gate, "owned", &who(S, "B"), &c);
    assert!(
        matches!(owned, Err(DraftError::OwnedByLiveWindow)),
        "got {owned:?}"
    );
    let missing = recover_draft_gated(&gate, "missing", &who(S, "B"), &c);
    match missing {
        Err(DraftError::NotFound { document_id }) => assert_eq!(document_id, "missing"),
        other => panic!("expected NotFound, got {other:?}"),
    }
    assert!(home.exists("owned"));
}
