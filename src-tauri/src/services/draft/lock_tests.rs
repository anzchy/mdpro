//! D27 WI-2 g17, g17(iv), g19: while the draft lock is held, saves, guarded
//! recover/discard, cleanup and `delete_draft` cannot finish; a poisoned
//! lock does not wedge saving.
use super::super::draft_test_home::{ago, bundle_json, ctx, who, TempHome};
use super::super::guarded::{discard_draft_guarded, recover_draft_guarded};
use super::super::{cleanup_old_drafts_for, delete_draft, save_draft_as, CleanupCounts};
use super::*;
use crate::models::ShadowStore;
use std::sync::mpsc;
use std::time::Duration;

const S: &str = "sess-current";
const P: &str = "previous-run";
const BLOCKED_FOR: Duration = Duration::from_millis(500);
const FINISHES_IN: Duration = Duration::from_secs(10);

#[test]
fn g17_operations_block_while_the_lock_is_held_including_delete_draft() {
    let home = TempHome::new("lock_g17");
    let fresh = ago(0);
    home.write_raw(
        "e",
        &bundle_json("E", None, &fresh, false, Some((P, "main"))),
    );
    home.write_raw(
        "f",
        &bundle_json("F", None, &fresh, false, Some((P, "main"))),
    );
    home.write_raw("g", &bundle_json("G", None, &fresh, false, None));
    let e_before = home.read_raw("e");
    let c = ctx(S, &["A", "B"], &ShadowStore::default());

    let guard = draft_lock();
    std::thread::scope(|scope| {
        let (tx, rx) = mpsc::channel();
        let save = scope.spawn({
            let tx = tx.clone();
            move || {
                let r = save_draft_as(Some(who(S, "A")), "d", "D", None, "t");
                let _ = tx.send(());
                r
            }
        });
        assert!(
            rx.recv_timeout(BLOCKED_FOR).is_err(),
            "save ran under the lock"
        );
        assert!(!home.exists("d"), "save wrote under the lock");

        let recover = scope.spawn({
            let (tx, c) = (tx.clone(), &c);
            move || {
                let r = recover_draft_guarded("e", &who(S, "B"), c);
                let _ = tx.send(());
                r
            }
        });
        assert!(
            rx.recv_timeout(BLOCKED_FOR).is_err(),
            "recover ran under the lock"
        );
        assert_eq!(home.read_raw("e"), e_before, "recover wrote under the lock");

        let discard = scope.spawn({
            let (tx, c) = (tx.clone(), &c);
            move || {
                let r = discard_draft_guarded("f", c);
                let _ = tx.send(());
                r
            }
        });
        assert!(
            rx.recv_timeout(BLOCKED_FOR).is_err(),
            "discard ran under the lock"
        );
        assert!(home.exists("f"), "discard deleted under the lock");

        let (dtx, drx) = mpsc::channel();
        let delete = scope.spawn(move || {
            let _ = dtx.send(delete_draft("g"));
        });
        assert!(
            drx.recv_timeout(BLOCKED_FOR).is_err(),
            "delete ran under the lock"
        );
        assert!(home.exists("g"));

        drop(guard);
        let deleted = drx
            .recv_timeout(FINISHES_IN)
            .expect("delete finishes after release");
        assert!(matches!(deleted, Ok(true)), "{deleted:?}");
        delete.join().unwrap();
        for _ in 0..3 {
            rx.recv_timeout(FINISHES_IN)
                .expect("finishes after release");
        }
        assert!(save.join().unwrap().is_ok());
        assert_eq!(recover.join().unwrap().expect("recover").content, "E");
        assert!(matches!(discard.join().unwrap(), Ok(true)));
    });
    assert!(home.exists("d"));
    assert!(!home.exists("f"));
}

#[test]
fn g17_iv_cleanup_blocks_while_the_lock_is_held() {
    let home = TempHome::new("lock_g17_iv");
    home.write_raw(
        "s",
        &bundle_json("S", None, &ago(8), true, Some((P, "main"))),
    );
    let before = home.read_raw("s");
    let c = ctx(S, &["A"], &ShadowStore::default());

    let guard = draft_lock();
    std::thread::scope(|scope| {
        let (tx, rx) = mpsc::channel();
        let c = &c;
        scope.spawn(move || {
            let _ = tx.send(cleanup_old_drafts_for(c));
        });
        assert!(
            matches!(
                rx.recv_timeout(BLOCKED_FOR),
                Err(mpsc::RecvTimeoutError::Timeout)
            ),
            "cleanup finished while the lock was held"
        );
        assert_eq!(home.read_raw("s"), before);

        drop(guard);
        let counts = rx.recv_timeout(FINISHES_IN).expect("cleanup finishes");
        assert_eq!(
            counts.expect("cleanup ok"),
            CleanupCounts {
                deleted: 1,
                skipped_live: 0
            }
        );
    });
    assert!(!home.exists("s"));
}

#[test]
fn g19_a_poisoned_lock_does_not_wedge_saving() {
    let home = TempHome::new("lock_g19");
    let poisoner = std::thread::spawn(|| {
        let _g = draft_lock();
        panic!("poison the draft lock (expected by g19)");
    });
    assert!(poisoner.join().is_err());
    let r = save_draft_as(Some(who(S, "A")), "d", "x", None, "t");
    assert!(r.is_ok(), "{r:?}");
    assert_eq!(home.value("d")["content"], serde_json::json!("x"));
}
