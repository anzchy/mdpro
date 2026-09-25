//! ADR-0035 WI-5: backstop draft writes against the quit-committed gate
//! (DB-1 … DB-3; DB-4 lives in `draft_backstop_order_tests`, which shares the
//! helpers below). `commands/draft.rs` is unchanged by ADR-0035: the backstop
//! writes through the same gated `save_draft`, and these cases pin the ordering
//! that decision 4 depends on.
//!
//! Registered from `commands/mod.rs` beside `draft_gate_tests`. Every case
//! writes and deletes real drafts, so it runs under `crate::HOME_LOCK` in a
//! fresh temp `$HOME` and asserts that `dirs::data_dir()` resolved inside it
//! before touching the disk.
//!
//! Law: discard wins, unless the discarding window redrafted it. After the
//! commit no discarded document's bundle exists, whenever its backstop or
//! autosave write ran — except one the window that discarded it names in its
//! `drafted` reply because it was edited after the discard and redrafted (ADR-0035
//! review M-1; `draft_backstop_undiscard_tests`, DU-1 … DU-6). A non-discarded
//! document drafted in the backstop does exist.

use super::draft::save_draft_gated;
use crate::services::draft::{load_draft, save_draft as save_draft_service};
use crate::services::quit_guard::driver::Begin;
use crate::services::quit_guard::{DraftGate, QuitAnswer, QuitEffects, QuitEvent, QuitGuard};
use crate::HOME_LOCK;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

/// How long the in-flight backstop write holds the gate open (DB-3).
const WRITE_HOLDS_FOR: Duration = Duration::from_millis(300);
/// The least the commit must be seen to wait for that write.
const COMMIT_WAITS_AT_LEAST: Duration = Duration::from_millis(250);

pub(super) struct HomeRestorer(Option<String>);
impl Drop for HomeRestorer {
    fn drop(&mut self) {
        match &self.0 {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

/// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
pub(super) fn set_home(path: &Path) -> HomeRestorer {
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", path.to_str().unwrap()) };
    HomeRestorer(prev)
}

static SEQ: AtomicU64 = AtomicU64::new(0);

/// A temp HOME no other call has been handed (`label-pid-seq`).
pub(super) fn make_temp_home(label: &str) -> PathBuf {
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let name = format!("{label}-{}-{seq}", std::process::id());
    let dir = std::env::temp_dir().join("mdpro_test").join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A draft's bundle path, with the drafts directory proven to be inside the
/// temp HOME first.
pub(super) fn bundle(temp_home: &Path, id: &str) -> PathBuf {
    let data = dirs::data_dir().unwrap();
    assert!(
        data.starts_with(temp_home),
        "data_dir() {data:?} escaped temp HOME {temp_home:?}"
    );
    data.join("mdpro")
        .join("drafts")
        .join(format!("{id}.draft.json"))
}

pub(super) fn leak_gate() -> &'static DraftGate {
    Box::leak(Box::new(DraftGate::new()))
}

/// The platform stand-in: every effect succeeds; each deletion records whether
/// the gate was held closed at that instant.
pub(super) struct Watch {
    gate: &'static DraftGate,
    deletes: Mutex<Vec<(String, bool)>>,
    replies: Mutex<Vec<bool>>,
}

impl QuitEffects for Watch {
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
    fn reply(&self, terminate: bool) -> bool {
        self.replies.lock().unwrap().push(terminate);
        true
    }
    fn native_fallback(&self, _request_id: u64, _timed_out: Vec<String>) -> bool {
        true
    }
    fn on_delete(&self, document_id: &str) {
        let held = self.gate.is_held_closed();
        self.deletes
            .lock()
            .unwrap()
            .push((document_id.to_string(), held));
    }
}

pub(super) fn guard_over(gate: &'static DraftGate) -> QuitGuard<Watch> {
    QuitGuard::with_gate(
        Watch {
            gate,
            deletes: Mutex::new(Vec::new()),
            replies: Mutex::new(Vec::new()),
        },
        gate,
    )
}

/// Window `a` is dirty, is prompted, and discards `discarded`; the re-check
/// round is opened. Returns the request id.
pub(super) fn discard_then_recheck(guard: &QuitGuard<Watch>, discarded: &str) -> u64 {
    let r = match guard.begin(&["a"], 0) {
        Begin::Later { request_id } => request_id,
        other => panic!("expected Begin::Later, got {other:?}"),
    };
    guard
        .handle_reply("a", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("a", r, QuitAnswer::Delivered, None, 2)
        .unwrap();
    guard
        .handle_reply(
            "a",
            r,
            QuitAnswer::Discard,
            Some(vec![discarded.to_string()]),
            3,
        )
        .unwrap();
    r
}

/// The re-check answers clean, which opens the backstop round.
pub(super) fn recheck_clean(guard: &QuitGuard<Watch>, r: u64) {
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 4)
        .unwrap();
    assert!(guard.effects().replies.lock().unwrap().is_empty());
}

pub(super) fn replies(guard: &QuitGuard<Watch>) -> Vec<bool> {
    guard.effects().replies.lock().unwrap().clone()
}

// ── DB-1 ──────────────────────────────────────────────────────────────────────

#[test]
fn db1_a_discarded_doc_rewritten_in_the_backstop_is_gone_and_a_drafted_one_stays() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_backstop_db1");
    let _home = set_home(&home);

    let gate = leak_gate();
    let guard = guard_over(gate);
    let r = discard_then_recheck(&guard, "X");
    recheck_clean(&guard, r);

    // The backstop round: this window drafts both documents it holds.
    save_draft_gated(gate, "X", "late", None, "t").expect("the gate is open in the backstop");
    save_draft_gated(gate, "Y", "keep", None, "t").expect("the gate is open in the backstop");
    assert!(bundle(&home, "X").exists(), "setup: X was not written");
    guard.handle_drafted("a", r, (2, 0), 5);

    assert_eq!(replies(&guard), vec![true], "the quit must commit");
    assert!(!bundle(&home, "X").exists(), "the discarded draft survived");
    let kept = load_draft("Y")
        .unwrap()
        .expect("Y's backstop draft is on disk");
    assert_eq!(kept.content, "keep");
}

// ── DB-2 ──────────────────────────────────────────────────────────────────────

#[test]
fn db2_save_draft_gated_after_the_commit_is_refused_and_leaves_no_file() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_backstop_db2");
    let _home = set_home(&home);

    let gate = leak_gate();
    let guard = guard_over(gate);
    let r = discard_then_recheck(&guard, "X");
    recheck_clean(&guard, r);
    guard.handle_drafted("a", r, (0, 0), 5);
    assert_eq!(replies(&guard), vec![true]);

    assert!(
        save_draft_gated(gate, "Z", "z", None, "t").is_err(),
        "autosave must stay shut out after the commit"
    );
    assert!(
        !bundle(&home, "Z").exists(),
        "a refused save wrote a bundle"
    );
}

// ── DB-3 ──────────────────────────────────────────────────────────────────────

#[test]
fn db3_an_in_flight_backstop_write_delays_the_deletes_and_is_still_deleted() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_backstop_db3");
    let _home = set_home(&home);
    save_draft_service("X", "OLD", None, "t").unwrap();
    assert!(bundle(&home, "X").exists(), "setup: X was not saved");

    let gate = leak_gate();
    let guard = guard_over(gate);
    let r = discard_then_recheck(&guard, "X");
    recheck_clean(&guard, r);

    let (tx, rx) = mpsc::channel();
    let writer = std::thread::spawn(move || {
        // Standing where `save_draft_gated` stands while it writes.
        gate.if_open(|| {
            let _ = tx.send(());
            let written = save_draft_service("X", "backstop", None, "t");
            std::thread::sleep(WRITE_HOLDS_FOR);
            written.is_ok()
        })
    });
    rx.recv().expect("the writer never entered the gate");

    let started = Instant::now();
    guard.handle_drafted("a", r, (1, 0), 5);
    let waited = started.elapsed();

    assert_eq!(
        writer.join().expect("the writer panicked"),
        Some(true),
        "the backstop write ran with the gate open"
    );
    assert!(
        waited >= COMMIT_WAITS_AT_LEAST,
        "the commit did not wait for the in-flight write: {waited:?}"
    );
    assert_eq!(
        guard.effects().deletes.lock().unwrap().clone(),
        vec![("X".to_string(), true)],
        "the delete must run with the gate held closed"
    );
    assert!(!bundle(&home, "X").exists(), "the discarded draft survived");
    assert_eq!(replies(&guard), vec![true]);
}
