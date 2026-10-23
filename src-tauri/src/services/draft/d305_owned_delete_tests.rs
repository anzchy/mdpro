//! D305: explicit Discard deletes only this window's current, unclaimed draft.
use super::draft_test_home::TempHome;
use super::protection::delete_draft_owned_with_read_hook;
use super::*;
use std::sync::mpsc;
use std::time::Duration;

fn owner(label: &str) -> DraftOwner {
    DraftOwner {
        session_id: session_id().into(),
        window_label: label.into(),
    }
}

#[test]
fn d305_own_discard_deletes_and_other_window_survives() {
    let home = TempHome::new("d305_own_discard");
    save_draft_as(Some(owner("A")), "own", "A", None, "A").unwrap();
    save_draft_as(Some(owner("B")), "other", "B", None, "B").unwrap();
    assert_eq!(delete_draft_owned("own", "A").unwrap(), true);
    assert!(!home.exists("own"));
    let before = home.read_raw("other");
    assert_eq!(delete_draft_owned("other", "A").unwrap(), false);
    assert_eq!(home.read_raw("other"), before);
}

#[test]
fn d305_same_id_foreign_save_survives_own_write_and_discard() {
    let home = TempHome::new("d305_same_id");
    save_draft_as(Some(owner("B")), "X", "B bytes", None, "B").unwrap();
    save_draft_as(Some(owner("A")), "X", "A bytes", None, "A").unwrap();
    assert_eq!(delete_draft_owned("X", "A").unwrap(), true);
    let remaining: Vec<_> = home.snapshot().into_values().collect();
    assert_eq!(remaining.len(), 1);
    assert!(String::from_utf8_lossy(&remaining[0]).contains("B bytes"));
}

#[test]
fn d305_recovery_claim_is_not_deleted() {
    let home = TempHome::new("d305_claim");
    save_draft_as(Some(owner("A")), "X", "recovery", None, "R").unwrap();
    let mut bundle: DraftBundle = serde_json::from_slice(&home.read_raw("X")).unwrap();
    bundle.claim = Some(DraftClaimToken {
        source_id: "X".into(),
        nonce: "n".into(),
        session_id: session_id().into(),
    });
    home.write_raw("X", &serde_json::to_string(&bundle).unwrap());
    let before = home.read_raw("X");
    assert_eq!(delete_draft_owned("X", "A").unwrap(), false);
    assert_eq!(home.read_raw("X"), before);
}

#[test]
fn d305_owner_check_occurs_after_lock_acquisition() {
    let home = TempHome::new("d305_lock_order");
    save_draft_as(Some(owner("A")), "X", "A", None, "A").unwrap();
    let lock = draft_lock();
    let (proceed_tx, proceed_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (read_tx, read_rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        delete_draft_owned_with_read_hook(
            "X",
            "A",
            || {
                ready_tx.send(()).unwrap();
                proceed_rx.recv().unwrap();
                draft_lock()
            },
            || {
                assert!(super::lock::draft_lock_is_held());
                read_tx.send(()).unwrap();
            },
        )
        .unwrap()
    });
    // The worker has reached the point immediately before lock acquisition.
    // A pre-lock owner read would already have seen A here.
    ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let mut replacement: DraftBundle = serde_json::from_slice(&home.read_raw("X")).unwrap();
    replacement.owner = Some(owner("B"));
    replacement.content = "B after A waited".into();
    home.write_raw("X", &serde_json::to_string(&replacement).unwrap());
    let b_bytes = home.read_raw("X");
    proceed_tx.send(()).unwrap();
    drop(lock);
    read_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(worker.join().unwrap(), false);
    assert_eq!(home.read_raw("X"), b_bytes);
}

#[test]
fn d305_b_save_before_a_discard_survives() {
    let home = TempHome::new("d305_b_save_first");
    save_draft_as(Some(owner("A")), "X", "A", None, "A").unwrap();
    save_draft_as(Some(owner("B")), "X", "B wins", None, "B").unwrap();
    let before = home.read_raw("X");
    assert!(!delete_draft_owned("X", "A").unwrap());
    assert_eq!(home.read_raw("X"), before);
}

#[test]
fn d305_b_save_after_a_discard_survives() {
    let home = TempHome::new("d305_b_save_after");
    save_draft_as(Some(owner("A")), "X", "A", None, "A").unwrap();
    assert!(delete_draft_owned("X", "A").unwrap());
    save_draft_as(Some(owner("B")), "X", "B saved after delete", None, "B").unwrap();
    let b_bytes = home.read_raw("X");
    assert!(!delete_draft_owned("X", "A").unwrap());
    assert_eq!(home.read_raw("X"), b_bytes);
}

#[test]
fn d305_old_session_and_ownerless_recovery_survive() {
    let home = TempHome::new("d305_recovery_owners");
    save_draft_as(Some(owner("A")), "old", "old bytes", None, "old").unwrap();
    let mut bundle: DraftBundle = serde_json::from_slice(&home.read_raw("old")).unwrap();
    bundle.owner.as_mut().unwrap().session_id = "previous-session".into();
    home.write_raw("old", &serde_json::to_string(&bundle).unwrap());
    save_draft_as(None, "ownerless", "ownerless bytes", None, "ownerless").unwrap();
    for id in ["old", "ownerless"] {
        let before = home.read_raw(id);
        assert!(!delete_draft_owned(id, "A").unwrap());
        assert_eq!(home.read_raw(id), before);
    }
}

#[test]
fn d305_invalid_document_id_is_rejected_without_mutating_drafts() {
    let home = TempHome::new("d305_invalid_id");
    save_draft_as(Some(owner("A")), "X", "keep", None, "X").unwrap();
    let before = home.read_raw("X");
    assert!(delete_draft_owned("../X", "A").is_err());
    assert_eq!(home.read_raw("X"), before);
}
