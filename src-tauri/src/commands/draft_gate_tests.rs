//! WI3-G1/G2/G3: the quit-committed gate on draft saving (ADR-0025 §4).
//!
//! Once a quit has committed and the discarded drafts are gone, an auto-save
//! tick that still has the old content must not be able to write them back.
//!
//! These cases write and delete real drafts, so each runs under
//! `crate::HOME_LOCK` in a temp `$HOME` and asserts that `dirs::data_dir()`
//! resolved inside it before touching the disk.

use super::draft::save_draft_gated;
use crate::services::draft::{save_draft as save_draft_service, DraftError};
use crate::services::quit_guard::{
    self, QuitAnswer, QuitEffects, QuitEvent, QuitGuard, QUIT_COMMITTED,
};
use crate::HOME_LOCK;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};

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

    let committed = AtomicBool::new(false);
    let result = save_draft_gated(&committed, "doc1", "BODY", None, "t")
        .expect("an ungated save must succeed");
    assert!(result.success);
    assert!(bundle(&home, "doc1").exists(), "the bundle was not written");
}

#[test]
fn g2_a_committed_quit_stops_the_draft_from_being_rewritten() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_gate_g2");
    let _home = set_home(&home);
    let _ = drafts_dir(&home);

    let committed = AtomicBool::new(false);
    save_draft_gated(&committed, "doc1", "OLD", None, "t").unwrap();
    save_draft_gated(&committed, "gone", "OLD", None, "t").unwrap();
    let untouched = fs::read(bundle(&home, "doc1")).unwrap();
    fs::remove_file(bundle(&home, "gone")).unwrap();

    committed.store(true, SeqCst);

    // A draft the quit deleted must not come back...
    let err = save_draft_gated(&committed, "gone", "NEW", None, "t")
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
    assert!(save_draft_gated(&committed, "doc1", "NEW", None, "t").is_err());
    assert_eq!(
        fs::read(bundle(&home, "doc1")).unwrap(),
        untouched,
        "a refused save still rewrote the bundle"
    );
}

struct NoopEffects;
impl QuitEffects for NoopEffects {
    fn emit_all(&self, _event: QuitEvent) {}
    fn emit_to(&self, _label: &str, _event: QuitEvent) {}
    fn activate(&self, _label: &str) {}
    fn arm_timer(&self, _request_id: u64, _deadline_ms: u64) {}
    fn reply(&self, _terminate: bool) {}
    fn native_fallback(&self, _request_id: u64, _timed_out: Vec<String>) {}
}

#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn g3_the_production_guard_and_the_save_command_share_one_flag() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_gate_g3");
    let _home = set_home(&home);
    let _ = drafts_dir(&home);
    let _reset = QuitCommittedReset;
    assert!(
        !QUIT_COMMITTED.load(SeqCst),
        "precondition: the shared flag must start clear"
    );

    save_draft_service("doc1", "BODY", None, "t").unwrap();
    assert!(bundle(&home, "doc1").exists());

    // A guard built the production way — `new`, not `with_flag`.
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

    assert!(
        QUIT_COMMITTED.load(SeqCst),
        "the production guard must set the flag the save command reads"
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
