//! D27 WI-2 g18, g18b, g17(v), g18c: invariants that hold on every
//! interleaving when each check-then-act holds the draft lock throughout.
//! Loops read the stop flag *before* each call, so the last call is known to
//! start after the other thread finished.
use super::super::draft_test_home::{ago, bundle_json, ctx, who, TempHome};
use super::super::guarded::{discard_draft_guarded, recover_draft_guarded};
use super::super::{cleanup_old_drafts_for, save_draft_as, DraftError};
use crate::models::ShadowStore;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::Barrier;

const S: &str = "sess-current";
const P: &str = "previous-run";
const SAVES: usize = 200;
const ROUNDS: usize = 200;

fn owner_json(s: &str, l: &str) -> Value {
    json!({"sessionId": s, "windowLabel": l})
}

/// Thread A's 200 owned saves, each read back; sets `done` at the end.
fn autosave_a(home: &TempHome, start: &Barrier, done: &AtomicBool) -> Vec<Value> {
    start.wait();
    let mut backs = Vec::with_capacity(SAVES);
    for k in 1..=SAVES {
        save_draft_as(Some(who(S, "A")), "d", &format!("A-{k}"), None, "t").expect("save");
        backs.push(home.value("d"));
    }
    done.store(true, SeqCst);
    backs
}

fn assert_read_backs(backs: &[Value]) {
    assert_eq!(backs.len(), SAVES);
    for (i, v) in backs.iter().enumerate() {
        assert_eq!(v["owner"], owner_json(S, "A"), "read-back {}", i + 1);
        assert_eq!(v["recovered"], json!(false), "read-back {}", i + 1);
        assert_eq!(v["content"], json!(format!("A-{}", i + 1)));
    }
}

#[test]
fn g18_concurrent_owned_autosave_vs_foreign_recover() {
    let home = TempHome::new("lock_g18");
    home.write_raw(
        "d",
        &bundle_json("OLD", None, &ago(0), false, Some((P, "main"))),
    );
    let c = ctx(S, &["A", "B"], &ShadowStore::default());
    let (start, done) = (Barrier::new(2), AtomicBool::new(false));

    let (backs, results) = std::thread::scope(|scope| {
        let a = scope.spawn(|| autosave_a(&home, &start, &done));
        let b = scope.spawn(|| {
            start.wait();
            let mut out = Vec::new();
            loop {
                let finished = done.load(SeqCst);
                out.push(recover_draft_guarded("d", &who(S, "B"), &c));
                if finished {
                    break out;
                }
            }
        });
        (a.join().unwrap(), b.join().unwrap())
    });

    assert_read_backs(&backs);
    let oks: Vec<_> = results.iter().filter_map(|r| r.as_ref().ok()).collect();
    assert!(oks.len() <= 1, "B recovered {} times", oks.len());
    assert!(oks.iter().all(|r| r.content == "OLD"));
    for r in results.iter().filter(|r| r.is_err()) {
        assert!(matches!(r, Err(DraftError::OwnedByLiveWindow)), "{r:?}");
    }
    let last = home.value("d");
    assert_eq!(last["content"], json!("A-200"));
    assert_eq!(last["owner"], owner_json(S, "A"));
    assert_eq!(last["recovered"], json!(false));
}

#[test]
fn g18b_concurrent_owned_autosave_vs_guarded_discard() {
    let home = TempHome::new("lock_g18b");
    home.write_raw(
        "d",
        &bundle_json("OLD", None, &ago(0), false, Some((P, "main"))),
    );
    let c = ctx(S, &["A", "B"], &ShadowStore::default());
    let (start, done) = (Barrier::new(2), AtomicBool::new(false));

    let (backs, results) = std::thread::scope(|scope| {
        let a = scope.spawn(|| autosave_a(&home, &start, &done));
        let b = scope.spawn(|| {
            start.wait();
            let mut out = Vec::new();
            loop {
                let finished = done.load(SeqCst);
                out.push(discard_draft_guarded("d", &c));
                if finished {
                    break out;
                }
            }
        });
        (a.join().unwrap(), b.join().unwrap())
    });

    assert_read_backs(&backs);
    let deleted = results.iter().filter(|r| matches!(r, Ok(true))).count();
    let absent = results.iter().filter(|r| matches!(r, Ok(false))).count();
    assert!(deleted <= 1, "(2) deleted {deleted} times");
    assert!(absent == 0 || deleted == 1, "(3) absent without a delete");
    let first_err = results.iter().position(|r| r.is_err());
    if let Some(i) = first_err {
        for r in &results[i..] {
            assert!(matches!(r, Err(DraftError::OwnedByLiveWindow)), "(4) {r:?}");
        }
    }
    assert!(
        matches!(results.last(), Some(Err(DraftError::OwnedByLiveWindow))),
        "(5) last {:?}",
        results.last()
    );
    let last = home.value("d");
    assert_eq!(last["content"], json!("A-200"));
    assert_eq!(last["owner"], owner_json(S, "A"));
    assert_eq!(last["recovered"], json!(false));
}

#[test]
fn g17_v_cleanup_and_recover_are_linearizable() {
    let home = TempHome::new("lock_g17_v");
    let c = ctx(S, &["B"], &ShadowStore::default());
    for round in 0..ROUNDS {
        home.write_raw(
            "s",
            &bundle_json("S", None, &ago(8), true, Some((P, "main"))),
        );
        let start = Barrier::new(2);
        let (cleaned, recovered) = std::thread::scope(|scope| {
            let cl = scope.spawn(|| {
                start.wait();
                cleanup_old_drafts_for(&c)
            });
            let r = scope.spawn(|| {
                start.wait();
                recover_draft_guarded("s", &who(S, "B"), &c)
            });
            (cl.join().unwrap(), r.join().unwrap())
        });
        let cleaned = cleaned.expect("cleanup ok");
        match recovered {
            Ok(_) => {
                assert!(home.exists("s"), "round {round}: recovered bundle deleted");
                let v = home.value("s");
                assert_eq!(v["owner"], owner_json(S, "B"), "round {round}");
                assert_eq!(v["recovered"], json!(true), "round {round}");
                assert_eq!(cleaned.deleted, 0, "round {round}");
            }
            Err(DraftError::NotFound { .. }) => {
                assert_eq!(cleaned.deleted, 1, "round {round}");
                assert!(!home.exists("s"), "round {round}");
            }
            Err(other) => panic!("round {round}: unexpected {other:?}"),
        }
    }
}

#[test]
fn g18c_recover_recover_discard_exclusivity() {
    let home = TempHome::new("lock_g18c");
    let c = ctx(S, &["B1", "B2"], &ShadowStore::default());
    for round in 0..ROUNDS {
        home.write_raw(
            "d",
            &bundle_json("D", None, &ago(0), false, Some((P, "main"))),
        );
        let start = Barrier::new(3);
        let (r1, r2, d) = std::thread::scope(|scope| {
            let recover = |label: &'static str| {
                let (start, c) = (&start, &c);
                scope.spawn(move || {
                    start.wait();
                    recover_draft_guarded("d", &who(S, label), c)
                })
            };
            let (h1, h2) = (recover("B1"), recover("B2"));
            let hd = scope.spawn(|| {
                start.wait();
                discard_draft_guarded("d", &c)
            });
            (h1.join().unwrap(), h2.join().unwrap(), hd.join().unwrap())
        });
        let winners: Vec<&str> = [("B1", &r1), ("B2", &r2)]
            .iter()
            .filter(|(_, r)| r.is_ok())
            .map(|(l, _)| *l)
            .collect();
        assert!(winners.len() <= 1, "round {round}: two recovers won");
        if let Some(label) = winners.first() {
            let v = home.value("d");
            assert_eq!(v["owner"], owner_json(S, label), "round {round}");
            assert_eq!(v["recovered"], json!(true), "round {round}");
        }
        if matches!(d, Ok(true)) {
            for r in [&r1, &r2] {
                assert!(
                    matches!(r, Err(DraftError::NotFound { .. })),
                    "round {round}: {r:?}"
                );
            }
            assert!(!home.exists("d"), "round {round}");
        }
    }
}
