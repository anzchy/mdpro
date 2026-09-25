//! WI3-G1…G3 and D16-MUST2 G4…G6: the quit-committed gate on draft saving
//! (ADR-0025 §4).
//!
//! Once a quit has committed and the discarded drafts are gone, an auto-save
//! tick that still has the old content must not be able to write them back.
//! G4…G6 pin the *indivisibility* of that: the check and the write are one
//! step, and so are the close and the deletes.
//!
//! These cases write and delete real drafts, so each runs under
//! `crate::HOME_LOCK` in a temp `$HOME` and asserts that `dirs::data_dir()`
//! resolved inside it before touching the disk.

use super::draft::save_draft_gated;
use crate::services::draft::{save_draft as save_draft_service, DraftError};
use crate::services::quit_guard::{
    self, DraftGate, QuitAnswer, QuitEffects, QuitEvent, QuitGuard, QUIT_COMMITTED,
};
use crate::services::quit_guard::coordinator::QUIT_BACKSTOP_TIMEOUT_MS;
use crate::HOME_LOCK;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

/// How long a blocked party is given to prove it is blocked.
///
/// This is not a sleep-and-hope: once the gate is a lock, the blocked side can
/// *never* finish while the other side holds its guard, so the wait always
/// elapses and the test is deterministic. The window only has to be long enough
/// that an unblocked party — which finishes in microseconds — is unambiguous.
const BLOCKED_FOR: Duration = Duration::from_millis(500);

/// Generous upper bound for work that must finish once the gate is released.
const EVENTUALLY: Duration = Duration::from_secs(10);

/// A leaked gate for an isolated driver: `QuitGuard::with_gate` takes a
/// `&'static DraftGate`, and a test binary's leak is bounded by the test count.
fn leak_gate() -> &'static DraftGate {
    Box::leak(Box::new(DraftGate::new()))
}

struct HomeRestorer(Option<String>);
impl Drop for HomeRestorer {
    fn drop(&mut self) {
        match &self.0 {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

/// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
fn set_home(path: &Path) -> HomeRestorer {
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", path.to_str().unwrap()) };
    HomeRestorer(prev)
}

fn make_temp_home(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("mdpro_test").join(label);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// The drafts directory, proven to be inside the temp HOME first.
fn drafts_dir(temp_home: &Path) -> PathBuf {
    let data = dirs::data_dir().unwrap();
    assert!(
        data.starts_with(temp_home),
        "data_dir() {data:?} escaped temp HOME {temp_home:?}"
    );
    data.join("mdpro").join("drafts")
}

fn bundle(temp_home: &Path, id: &str) -> PathBuf {
    drafts_dir(temp_home).join(format!("{id}.draft.json"))
}

struct QuitCommittedReset;
impl Drop for QuitCommittedReset {
    fn drop(&mut self) {
        quit_guard::reset_quit_committed_for_tests();
    }
}

#[test]
fn g1_a_draft_saves_normally_while_no_quit_has_committed() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_gate_g1");
    let _home = set_home(&home);
    let _ = drafts_dir(&home);

    let gate = DraftGate::new();
    let result =
        save_draft_gated(&gate, "doc1", "BODY", None, "t").expect("an ungated save must succeed");
    assert!(result.success);
    assert!(bundle(&home, "doc1").exists(), "the bundle was not written");
}

#[test]
fn g2_a_committed_quit_stops_the_draft_from_being_rewritten() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_gate_g2");
    let _home = set_home(&home);
    let _ = drafts_dir(&home);

    let gate = DraftGate::new();
    save_draft_gated(&gate, "doc1", "OLD", None, "t").unwrap();
    save_draft_gated(&gate, "gone", "OLD", None, "t").unwrap();
    let untouched = fs::read(bundle(&home, "doc1")).unwrap();
    fs::remove_file(bundle(&home, "gone")).unwrap();

    // The commit's critical section, opened and closed again.
    drop(gate.close());

    // A draft the quit deleted must not come back...
    let err = save_draft_gated(&gate, "gone", "NEW", None, "t")
        .expect_err("a save after the quit committed must be refused");
    assert!(
        matches!(err, DraftError::IoError { .. }),
        "expected an IoError, got {err:?}"
    );
    assert!(
        err.to_string().to_lowercase().contains("quit"),
        "the refusal should say why; got {err}"
    );
    assert!(
        !bundle(&home, "gone").exists(),
        "a refused save recreated the deleted draft"
    );

    // ...and a draft that survived must not be rewritten either.
    assert!(save_draft_gated(&gate, "doc1", "NEW", None, "t").is_err());
    assert_eq!(
        fs::read(bundle(&home, "doc1")).unwrap(),
        untouched,
        "a refused save still rewrote the bundle"
    );
}

struct NoopEffects;
impl QuitEffects for NoopEffects {
    fn emit_all(&self, _event: QuitEvent) -> bool {
        true
    }
    fn emit_to(&self, _label: &str, _event: QuitEvent) -> bool {
        true
    }
    fn activate(&self, _label: &str) -> bool {
        true
    }
    fn arm_timer(&self, _request_id: u64, _deadline_ms: u64) {}
    fn reply(&self, _terminate: bool) -> bool {
        true
    }
    fn native_fallback(&self, _request_id: u64, _timed_out: Vec<String>) -> bool {
        true
    }
}

#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn g3_the_production_guard_and_the_save_command_share_one_gate() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_gate_g3");
    let _home = set_home(&home);
    let _ = drafts_dir(&home);
    let _reset = QuitCommittedReset;
    assert!(
        !QUIT_COMMITTED.is_closed(),
        "precondition: the shared gate must start open"
    );

    save_draft_service("doc1", "BODY", None, "t").unwrap();
    assert!(bundle(&home, "doc1").exists());

    // A guard built the production way — `new`, not `with_gate`.
    let guard = QuitGuard::new(NoopEffects);
    let request_id = match guard.begin(&["main"], 0) {
        quit_guard::driver::Begin::Later { request_id } => request_id,
        other => panic!("expected Begin::Later, got {other:?}"),
    };
    guard
        .handle_reply("main", request_id, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply(
            "main",
            request_id,
            QuitAnswer::Discard,
            Some(vec!["doc1".to_string()]),
            2,
        )
        .unwrap();
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    guard
        .handle_reply("main", request_id, QuitAnswer::Clean, None, 3)
        .unwrap();
    // ADR-0035 changes the spec: commit is now preceded by a re-check round (and
    // a backstop round). Its deadline commits; the answered backstop is pinned
    // by `draft_backstop_tests.rs` (DB-1 … DB-4).
    guard.tick(3 + QUIT_BACKSTOP_TIMEOUT_MS);

    assert!(
        QUIT_COMMITTED.is_closed(),
        "the production guard must close the gate the save command writes through"
    );
    assert!(!bundle(&home, "doc1").exists(), "the draft was not deleted");

    // The auto-save tick that was already in flight.
    let refused = super::draft::save_draft(
        "doc1".to_string(),
        "BODY".to_string(),
        None,
        "t".to_string(),
    )
    .await;
    assert!(
        refused.is_err(),
        "the save command wrote a draft after the quit committed"
    );
    assert!(
        !bundle(&home, "doc1").exists(),
        "the discarded draft was resurrected"
    );
}

// ── D16-MUST2: the gate is a lock, not a flag ────────────────────────────────

/// G4: the heart of the defect. A gate that is only *checked* before the write
/// lets a commit close it and delete the draft while the write is still in
/// flight, and the write then puts the discarded draft back on disk.
///
/// The observation runs from inside the write itself — the closure `if_open`
/// runs is exactly where `save_draft_gated` writes its bundle — so no sleeping
/// is involved: if the gate were released before the write, the closer would
/// have finished by the time we look.
#[test]
fn g4_the_gate_stays_held_open_for_the_whole_draft_write() {
    let gate = DraftGate::new();
    let (tx, rx) = mpsc::channel();

    let closed_during_the_write = std::thread::scope(|scope| {
        gate.if_open(|| {
            // We are standing where `save_draft_service` writes the bundle.
            scope.spawn(|| {
                let _closing = gate.close();
                let _ = tx.send(());
            });
            rx.recv_timeout(BLOCKED_FOR).is_ok()
        })
    });

    assert_eq!(
        closed_during_the_write,
        Some(false),
        "a quit closed the gate while a draft write was still in flight: \
         that write lands after the commit's deletes and resurrects the draft"
    );
    assert!(
        gate.is_closed(),
        "the closer must get through once the write releases the gate"
    );
    assert!(
        gate.if_open(|| ()).is_none(),
        "a closed gate must refuse the next save"
    );
}

/// G5: the other direction — while a commit holds the gate closed, a save
/// cannot even start, and nothing of it reaches the disk.
#[test]
fn g5_no_draft_is_written_while_a_commit_holds_the_gate_closed() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_gate_g5");
    let _home = set_home(&home);
    let _ = drafts_dir(&home);

    let gate = DraftGate::new();
    let (tx, rx) = mpsc::channel();
    let closing = gate.close();

    let refused = std::thread::scope(|scope| {
        let saver = scope.spawn(|| {
            let result = save_draft_gated(&gate, "doc1", "NEW", None, "t");
            let _ = tx.send(());
            result
        });

        assert!(
            rx.recv_timeout(BLOCKED_FOR).is_err(),
            "a save ran to completion inside the commit's critical section"
        );
        assert!(
            !bundle(&home, "doc1").exists(),
            "a draft was written while the commit was closing the gate"
        );

        drop(closing);
        saver.join().expect("the saver thread panicked")
    });

    let err = refused.expect_err("a save after the gate closed must be refused");
    assert!(
        matches!(err, DraftError::IoError { .. }),
        "expected an IoError, got {err:?}"
    );
    assert!(
        !bundle(&home, "doc1").exists(),
        "the refused save still wrote a bundle"
    );
}

/// G6: end to end through the real driver. A save that is in flight holds the
/// whole commit off — gate still open, discarded draft still on disk — and the
/// commit completes the moment the save is done.
#[test]
fn g6_a_commit_waits_for_the_save_that_is_already_in_flight() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_gate_g6");
    let _home = set_home(&home);
    let _ = drafts_dir(&home);

    save_draft_service("doc1", "OLD", None, "t").unwrap();
    assert!(bundle(&home, "doc1").exists(), "setup: doc1 was not saved");

    let gate = leak_gate();
    let guard = QuitGuard::with_gate(NoopEffects, gate);
    let (tx, rx) = mpsc::channel();

    // Stand exactly where `save_draft_gated` stands while it writes. The commit
    // thread is started from *inside* that window, so the save is provably in
    // flight before the quit begins.
    let commit = gate
        .if_open(|| {
            let commit = std::thread::spawn(move || {
                let request_id = match guard.begin(&["main"], 0) {
                    quit_guard::driver::Begin::Later { request_id } => request_id,
                    other => panic!("expected Begin::Later, got {other:?}"),
                };
                guard
                    .handle_reply("main", request_id, QuitAnswer::Dirty, None, 1)
                    .unwrap();
                guard
                    .handle_reply(
                        "main",
                        request_id,
                        QuitAnswer::Discard,
                        Some(vec!["doc1".to_string()]),
                        2,
                    )
                    .unwrap();
                // ADR-0035 changes the spec: commit is now preceded by a
                // re-check round.
                guard
                    .handle_reply("main", request_id, QuitAnswer::Clean, None, 3)
                    .unwrap();
                // ADR-0035 changes the spec: commit is now preceded by a
                // re-check round (and a backstop round), whose deadline commits.
                guard.tick(3 + QUIT_BACKSTOP_TIMEOUT_MS);
                let _ = tx.send(());
            });

            assert!(
                rx.recv_timeout(BLOCKED_FOR).is_err(),
                "the commit ran while a save was in flight"
            );
            assert!(
                bundle(&home, "doc1").exists(),
                "the commit deleted a draft while a save of it was in flight"
            );
            commit
        })
        .expect("the gate was closed before the save started");

    // The gate is released now, so the commit can finish.
    commit.join().expect("the commit thread panicked");
    rx.recv_timeout(EVENTUALLY)
        .expect("the commit never finished after the save released the gate");
    assert!(
        gate.is_closed(),
        "the commit must close the gate once the save releases it"
    );
    assert!(
        !bundle(&home, "doc1").exists(),
        "the discarded draft survived the commit"
    );
}
