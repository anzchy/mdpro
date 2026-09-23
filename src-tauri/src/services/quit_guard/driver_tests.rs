//! Test cases for the WI-3 driver (`services::quit_guard::driver`), the
//! `on_window_event` seam and the pure log builders.
//!
//! Wired from `mod.rs` with `#[cfg(test)] #[path = ...]` so the specification
//! lives apart from the implementation it constrains.
//!
//! **Draft deletion is real here.** It is not behind `QuitEffects`, so every
//! case whose request reaches `Commit` with a non-empty id list runs under
//! `crate::HOME_LOCK`, in a temp `$HOME`, and asserts that `dirs::data_dir()`
//! resolved inside that temp HOME before it writes anything. Without that
//! guard these cases would delete the developer's own drafts.

use super::driver::*;
use super::logging::{answer_log_context, commit_log_context};
use super::{on_window_event, DraftGate, QUIT_COMMITTED};
use crate::services::draft;
use crate::HOME_LOCK;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier, Mutex, OnceLock, Weak};

// ── Fixtures ──────────────────────────────────────────────────────────────────

pub(super) struct HomeRestorer(Option<String>);
impl Drop for HomeRestorer {
    fn drop(&mut self) {
        match &self.0 {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

/// Sets HOME and returns a guard that restores the original value on drop.
/// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
pub(super) fn set_home(path: &Path) -> HomeRestorer {
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", path.to_str().unwrap()) };
    HomeRestorer(prev)
}

/// Fresh temp HOME: removed first, so a previous run cannot leak state in.
pub(super) fn make_temp_home(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("mdpro_test").join(label);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// `data_dir()/mdpro`, asserted to live inside the temp HOME first. On WSL with
/// `XDG_DATA_HOME` set, `data_dir()` ignores `$HOME` and the commit path would
/// delete the developer's real drafts; this makes that fail loudly.
pub(super) fn mdpro_dir(temp_home: &Path) -> PathBuf {
    let data = dirs::data_dir().unwrap();
    assert!(
        data.starts_with(temp_home),
        "data_dir() {data:?} escaped temp HOME {temp_home:?}"
    );
    data.join("mdpro")
}

pub(super) fn drafts_dir(temp_home: &Path) -> PathBuf {
    mdpro_dir(temp_home).join("drafts")
}

pub(super) fn bundle(drafts: &Path, id: &str) -> PathBuf {
    drafts.join(format!("{id}.draft.json"))
}

/// Restores the process-wide `QUIT_COMMITTED` however the test ends. Declared
/// after the HOME_LOCK guard so it drops before the lock is released.
pub(super) struct QuitCommittedReset;
impl Drop for QuitCommittedReset {
    fn drop(&mut self) {
        super::reset_quit_committed_for_tests();
    }
}

/// A fresh gate for an isolated driver. Leaked on purpose: `with_gate` takes a
/// `&'static DraftGate`, and a test binary's leak is bounded by the test count.
pub(super) fn leak_gate() -> &'static DraftGate {
    Box::leak(Box::new(DraftGate::new()))
}

pub(super) fn later(begin: Begin) -> u64 {
    match begin {
        Begin::Later { request_id } => request_id,
        other => panic!("expected Begin::Later, got {other:?}"),
    }
}

pub(super) fn ids(list: &[&str]) -> Option<Vec<String>> {
    Some(list.iter().map(|s| s.to_string()).collect())
}

// ── The recording effects implementation ──────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Effect {
    EmitAll(QuitEvent),
    EmitTo(String, QuitEvent),
    Activate(String),
    ArmTimer(u64, u64),
    Reply(bool),
    NativeFallback(u64, Vec<String>),
}

/// A real struct that appends to a `Vec`, not a mock of our own logic. It
/// stands in only for the Tauri emit, the window activation and the NSApp
/// reply. `on_delete` is an observation point: it asks the injected gate itself
/// whether the closing critical section is running, rather than believing a
/// value the driver hands it.
#[derive(Default)]
pub(super) struct RecordingEffects {
    log: Mutex<Vec<Effect>>,
    deletes: Mutex<Vec<(String, bool)>>,
    gate: Option<&'static DraftGate>,
}

impl RecordingEffects {
    pub(super) fn watching(gate: &'static DraftGate) -> Self {
        Self {
            log: Mutex::new(Vec::new()),
            deletes: Mutex::new(Vec::new()),
            gate: Some(gate),
        }
    }

    pub(super) fn effects(&self) -> Vec<Effect> {
        self.log.lock().unwrap().clone()
    }

    pub(super) fn deletes(&self) -> Vec<(String, bool)> {
        self.deletes.lock().unwrap().clone()
    }

    fn push(&self, effect: Effect) {
        self.log.lock().unwrap().push(effect);
    }
}

impl QuitEffects for RecordingEffects {
    fn emit_all(&self, event: QuitEvent) {
        self.push(Effect::EmitAll(event));
    }
    fn emit_to(&self, label: &str, event: QuitEvent) {
        self.push(Effect::EmitTo(label.to_string(), event));
    }
    fn activate(&self, label: &str) {
        self.push(Effect::Activate(label.to_string()));
    }
    fn arm_timer(&self, request_id: u64, deadline_ms: u64) {
        self.push(Effect::ArmTimer(request_id, deadline_ms));
    }
    fn reply(&self, terminate: bool) {
        self.push(Effect::Reply(terminate));
    }
    fn native_fallback(&self, request_id: u64, timed_out: Vec<String>) {
        self.push(Effect::NativeFallback(request_id, timed_out));
    }
    fn on_delete(&self, document_id: &str) {
        let held_closed = self.gate.map(|g| g.is_held_closed()).unwrap_or(false);
        self.deletes
            .lock()
            .unwrap()
            .push((document_id.to_string(), held_closed));
    }
}

pub(super) fn recording_guard(gate: &'static DraftGate) -> QuitGuard<RecordingEffects> {
    QuitGuard::with_gate(RecordingEffects::watching(gate), gate)
}

pub(super) fn effects_of(guard: &QuitGuard<RecordingEffects>) -> Vec<Effect> {
    guard.effects().effects()
}

// ── WI3-D1 ────────────────────────────────────────────────────────────────────

#[test]
fn d1_commit_deletes_exactly_the_discarded_drafts_and_never_the_global_gate() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d1");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;
    assert!(
        !QUIT_COMMITTED.is_closed(),
        "precondition: the global quit-committed gate must start open"
    );

    for id in ["a1", "a2", "b1", "keep"] {
        draft::save_draft(id, "BODY", None, "t").unwrap();
        assert!(bundle(&drafts, id).exists(), "setup: {id} was not saved");
    }

    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Dirty, None, 2)
        .unwrap();
    guard
        .handle_reply("A", r, QuitAnswer::Discard, ids(&["a1", "a2"]), 3)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Discard, ids(&["b1"]), 4)
        .unwrap();

    for id in ["a1", "a2", "b1"] {
        assert!(
            !bundle(&drafts, id).exists(),
            "discarded draft {id} survived the commit"
        );
    }
    assert!(
        bundle(&drafts, "keep").exists(),
        "a draft nobody discarded was deleted"
    );
    assert_eq!(draft::load_draft("keep").unwrap().unwrap().content, "BODY");

    let effects = effects_of(&guard);
    assert_eq!(
        effects.last(),
        Some(&Effect::Reply(true)),
        "the commit must end with YES; effects were {effects:?}"
    );
    assert!(
        gate.is_closed(),
        "the injected gate was not closed on commit"
    );
    assert!(
        !QUIT_COMMITTED.is_closed(),
        "a with_gate driver closed the global QUIT_COMMITTED"
    );
    for (id, inside_closing_section) in guard.effects().deletes() {
        assert!(
            inside_closing_section,
            "{id} was deleted outside the closing critical section, where a save could still write it back"
        );
    }
}

// ── WI3-D2 ────────────────────────────────────────────────────────────────────

#[test]
fn d2_abort_after_an_earlier_discard_touches_no_draft() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d2");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    let names = ["a1", "a2", "b1", "keep"];
    for id in names {
        draft::save_draft(id, "BODY", None, "t").unwrap();
    }
    let before: Vec<Vec<u8>> = names
        .iter()
        .map(|id| fs::read(bundle(&drafts, id)).unwrap())
        .collect();

    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Dirty, None, 2)
        .unwrap();
    guard
        .handle_reply("A", r, QuitAnswer::Discard, ids(&["a1", "a2"]), 3)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Cancel, None, 4)
        .unwrap();

    for (id, bytes) in names.iter().zip(before) {
        assert_eq!(
            fs::read(bundle(&drafts, id)).ok(),
            Some(bytes),
            "an aborted quit changed draft {id}"
        );
    }

    let effects = effects_of(&guard);
    assert!(
        effects.contains(&Effect::EmitAll(QuitEvent::Cancelled { request_id: r })),
        "an abort must tell every window to close its dialog; effects were {effects:?}"
    );
    assert_eq!(effects.last(), Some(&Effect::Reply(false)));
    assert!(!gate.is_closed(), "an abort must not close the gate");
    assert!(
        crate::commands::draft::save_draft_gated(gate, "after-abort", "x", None, "t").is_ok(),
        "saving drafts must still work after an aborted quit"
    );
}

// ── WI3-D3 ────────────────────────────────────────────────────────────────────

#[test]
fn d3_invalid_document_ids_are_rejected_whole_and_move_nothing_on_disk() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d3");
    let _home = set_home(&home);
    let dir = mdpro_dir(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    draft::save_draft("ok1", "BODY", None, "t").unwrap();
    let sentinel = dir.join("x.draft.json");
    fs::write(&sentinel, b"SENTINEL").unwrap();

    let corpus = ["", "a/b", "a\\b", "..", "../x", "..\\x", "x/../../y"];
    for bad in corpus {
        for payload in [
            vec![bad.to_string()],
            vec!["ok1".to_string(), bad.to_string()],
        ] {
            let gate = leak_gate();
            let guard = recording_guard(gate);
            let r = later(guard.begin(&["A"], 0));
            guard
                .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
                .unwrap();

            let refused = guard.handle_reply("A", r, QuitAnswer::Discard, Some(payload.clone()), 2);
            assert!(
                refused.is_err(),
                "id list {payload:?} reached the commit path"
            );
            assert!(
                !gate.is_closed(),
                "a refused reply committed the quit for {payload:?}"
            );

            // The coordinator is still waiting on A: it can still be answered.
            guard
                .handle_reply("A", r, QuitAnswer::Cancel, None, 3)
                .unwrap();
            assert_eq!(
                effects_of(&guard).last(),
                Some(&Effect::Reply(false)),
                "a rejected id list left the request unanswerable for {payload:?}"
            );
            assert_eq!(fs::read(&sentinel).unwrap(), b"SENTINEL");
            assert!(
                bundle(&drafts, "ok1").exists(),
                "ok1 was deleted by {payload:?}"
            );
        }
    }

    // Not vacuous: the same shape with a valid id does commit and does delete.
    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("A", r, QuitAnswer::Discard, ids(&["ok1"]), 2)
        .unwrap();
    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
    assert!(!bundle(&drafts, "ok1").exists());
    assert_eq!(fs::read(&sentinel).unwrap(), b"SENTINEL");
}

// ── WI3-D4 ────────────────────────────────────────────────────────────────────

#[test]
fn d4_document_ids_length_cap_boundary() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d4");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    let last = format!("d{}", MAX_DISCARD_IDS - 1);
    for id in ["d0", last.as_str(), "keep"] {
        draft::save_draft(id, "BODY", None, "t").unwrap();
    }

    // One over the cap: refused, and nothing is deleted.
    let over: Vec<String> = (0..=MAX_DISCARD_IDS).map(|i| format!("d{i}")).collect();
    let gate1 = leak_gate();
    let guard1 = recording_guard(gate1);
    let r1 = later(guard1.begin(&["A"], 0));
    guard1
        .handle_reply("A", r1, QuitAnswer::Dirty, None, 1)
        .unwrap();
    let refused = guard1.handle_reply("A", r1, QuitAnswer::Discard, Some(over), 2);
    let message = refused.expect_err("one id over the cap must be refused");
    assert!(
        message.contains("too many") && message.contains(&MAX_DISCARD_IDS.to_string()),
        "the refusal must name the cap; got {message:?}"
    );
    for id in ["d0", last.as_str(), "keep"] {
        assert!(
            bundle(&drafts, id).exists(),
            "a refused over-cap list deleted {id}"
        );
    }

    // Exactly at the cap: accepted, and those drafts go.
    let at: Vec<String> = (0..MAX_DISCARD_IDS).map(|i| format!("d{i}")).collect();
    let gate2 = leak_gate();
    let guard2 = recording_guard(gate2);
    let r2 = later(guard2.begin(&["A"], 0));
    guard2
        .handle_reply("A", r2, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard2
        .handle_reply("A", r2, QuitAnswer::Discard, Some(at), 2)
        .expect("exactly MAX_DISCARD_IDS ids must be accepted");
    assert_eq!(effects_of(&guard2).last(), Some(&Effect::Reply(true)));
    assert!(!bundle(&drafts, "d0").exists());
    assert!(!bundle(&drafts, &last).exists());
    assert!(bundle(&drafts, "keep").exists());
}

// ── WI3-D5 ────────────────────────────────────────────────────────────────────

#[test]
fn d5_document_ids_are_accepted_only_with_discard() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d5");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    // (answer, ids, accepted, deletes a1)
    let rows: [(QuitAnswer, Option<Vec<String>>, bool, bool); 12] = [
        (QuitAnswer::Clean, None, true, false),
        (QuitAnswer::Clean, Some(vec![]), false, false),
        (QuitAnswer::Clean, ids(&["a1"]), false, false),
        (QuitAnswer::Dirty, None, true, false),
        (QuitAnswer::Dirty, Some(vec![]), false, false),
        (QuitAnswer::Dirty, ids(&["a1"]), false, false),
        (QuitAnswer::Discard, None, true, false),
        (QuitAnswer::Discard, Some(vec![]), true, false),
        (QuitAnswer::Discard, ids(&["a1"]), true, true),
        (QuitAnswer::Cancel, None, true, false),
        (QuitAnswer::Cancel, Some(vec![]), false, false),
        (QuitAnswer::Cancel, ids(&["a1"]), false, false),
    ];

    for (answer, payload, accepted, deletes) in rows {
        for id in ["a1", "keep"] {
            draft::save_draft(id, "BODY", None, "t").unwrap();
        }
        let phase_two = matches!(answer, QuitAnswer::Discard | QuitAnswer::Cancel);
        let gate = leak_gate();
        let guard = recording_guard(gate);
        let r = later(guard.begin(&["A"], 0));
        if phase_two {
            guard
                .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
                .unwrap();
        }

        let row = format!("{answer:?} with {payload:?}");
        let result = guard.handle_reply("A", r, answer, payload.clone(), 2);
        assert_eq!(
            result.is_ok(),
            accepted,
            "row {row}: expected accepted={accepted}, got {result:?}"
        );

        if !accepted {
            // The refusal left the request answerable.
            let valid = if phase_two {
                QuitAnswer::Cancel
            } else {
                QuitAnswer::Clean
            };
            guard.handle_reply("A", r, valid, None, 3).unwrap();
            assert!(
                matches!(effects_of(&guard).last(), Some(&Effect::Reply(_))),
                "row {row}: a refused reply left the request unresolved"
            );
        }

        assert_eq!(
            bundle(&drafts, "a1").exists(),
            !deletes,
            "row {row}: wrong outcome for the a1 draft"
        );
        assert!(
            bundle(&drafts, "keep").exists(),
            "row {row}: keep was deleted"
        );
    }
}

// ── WI3-D7 ────────────────────────────────────────────────────────────────────

// ADR-0027 supersedes ADR-0025 §3: an ack timeout hands the request to the
// native alert instead of counting as `cancel`. The plan's WI-3 bullet still
// says the tick itself emits cancelled and replies NO; that text predates
// Revision 3 and contradicts the WI-2 coordinator, whose `on_tick` returns
// `NativeFallback`. The contract asserted here is the Rev-3 one: the tick hands
// over, and the *alert's* KeepOpen answer emits cancelled and then replies NO,
// exactly once.
#[test]
fn d7_a_silent_window_hands_the_request_to_the_native_alert_and_replies_once() {
    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));

    assert_eq!(
        effects_of(&guard),
        vec![
            Effect::EmitAll(QuitEvent::Requested { request_id: r }),
            Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS),
        ],
        "begin must ask every window and arm the ack timer"
    );

    guard
        .handle_reply("A", r, QuitAnswer::Clean, None, 10)
        .unwrap();
    let before_deadline = effects_of(&guard);

    guard.tick(QUIT_ACK_TIMEOUT_MS - 1);
    assert_eq!(
        effects_of(&guard),
        before_deadline,
        "a tick before the deadline must do nothing"
    );

    guard.tick(QUIT_ACK_TIMEOUT_MS);
    let after_deadline = effects_of(&guard);
    assert_eq!(
        after_deadline[before_deadline.len()..],
        [Effect::NativeFallback(r, vec!["B".to_string()])],
        "the deadline must hand the request to the native alert, naming the silent window"
    );

    guard.tick(QUIT_ACK_TIMEOUT_MS + 1);
    guard
        .handle_reply("B", r, QuitAnswer::Dirty, None, 2_002)
        .unwrap();
    assert_eq!(
        effects_of(&guard),
        after_deadline,
        "a second tick and a late reply must not touch a request the alert owns"
    );

    guard.fallback_answer(r, FallbackAnswer::KeepOpen);
    let end = effects_of(&guard);
    assert_eq!(
        end[after_deadline.len()..],
        [
            Effect::EmitAll(QuitEvent::Cancelled { request_id: r }),
            Effect::Reply(false),
        ],
        "Keep Open must close the dialogs before it refuses the quit"
    );
    assert_eq!(
        end.iter().filter(|e| matches!(e, Effect::Reply(_))).count(),
        1,
        "AppKit must be answered exactly once per request"
    );
    assert!(!gate.is_closed(), "Keep Open must not commit the quit");
}

// ── WI3-D9 ────────────────────────────────────────────────────────────────────

#[test]
fn d9_a_draft_delete_that_fails_still_commits_and_replies_yes() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d9");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    draft::save_draft("a2", "BODY", None, "t").unwrap();
    // A directory where the bundle should be: `remove_file` on it fails.
    let blocked = bundle(&drafts, "a1");
    fs::create_dir_all(&blocked).unwrap();

    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("A", r, QuitAnswer::Discard, ids(&["a1", "a2"]), 2)
        .unwrap();

    assert_eq!(
        effects_of(&guard).last(),
        Some(&Effect::Reply(true)),
        "a failed delete must not block the quit"
    );
    assert!(
        !bundle(&drafts, "a2").exists(),
        "one failed delete short-circuited the rest"
    );
    assert!(blocked.is_dir(), "the blocked path was destroyed");

    let report = guard
        .last_commit_report()
        .expect("the commit must report what it deleted");
    assert_eq!(
        report,
        CommitReport {
            deleted: 1,
            failed: 1
        }
    );
    assert_eq!(
        commit_log_context(&report),
        serde_json::json!({ "deleted": 1, "failed": 1 })
    );
}

// ── WI3-D10 ───────────────────────────────────────────────────────────────────

#[test]
fn d10_log_contexts_carry_counts_never_ids_or_content() {
    let answers = [
        (QuitAnswer::Clean, "clean"),
        (QuitAnswer::Dirty, "dirty"),
        (QuitAnswer::Discard, "discard"),
        (QuitAnswer::Cancel, "cancel"),
    ];
    for (answer, wire) in answers {
        for n in [0usize, 1, 50] {
            let list: Vec<String> = (0..n).map(|i| format!("secret-id-{i}")).collect();
            let context = answer_log_context("main", answer, 7, &list);
            assert_eq!(context["windowLabel"], "main", "{answer:?}/{n}");
            assert_eq!(context["answer"], wire, "{answer:?}/{n}");
            assert_eq!(context["requestId"], 7, "{answer:?}/{n}");
            assert_eq!(context["idCount"], n, "{answer:?}/{n}");
            let rendered = serde_json::to_string(&context).unwrap();
            assert!(
                !rendered.contains("secret-id"),
                "the answer log leaked document ids: {rendered}"
            );
        }
    }

    assert_eq!(
        commit_log_context(&CommitReport {
            deleted: 3,
            failed: 1
        }),
        serde_json::json!({ "deleted": 3, "failed": 1 })
    );
}

// ── WI3-D11 ───────────────────────────────────────────────────────────────────

#[test]
fn d11_concurrent_last_answers_produce_exactly_one_reply() {
    let labels: Vec<String> = (0..8).map(|i| format!("w{i}")).collect();

    for iteration in 0..200 {
        let gate = leak_gate();
        let guard = Arc::new(recording_guard(gate));
        let r = later(guard.begin(&labels, 0));
        let barrier = Arc::new(Barrier::new(labels.len()));
        let mut handles = Vec::new();
        for label in &labels {
            let guard = Arc::clone(&guard);
            let barrier = Arc::clone(&barrier);
            let label = label.clone();
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                guard
                    .handle_reply(&label, r, QuitAnswer::Clean, None, 1)
                    .unwrap();
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        let effects = effects_of(&guard);
        let replies: Vec<&Effect> = effects
            .iter()
            .filter(|e| matches!(e, Effect::Reply(_)))
            .collect();
        assert_eq!(
            replies.len(),
            1,
            "iteration {iteration}: eight racing answers gave {replies:?}"
        );
    }

    for iteration in 0..200 {
        let gate = leak_gate();
        let guard = Arc::new(recording_guard(gate));
        let r = later(guard.begin(&labels, 0));
        for label in labels.iter().skip(1) {
            guard
                .handle_reply(label, r, QuitAnswer::Clean, None, 1)
                .unwrap();
        }
        let barrier = Arc::new(Barrier::new(2));
        let answerer = {
            let guard = Arc::clone(&guard);
            let barrier = Arc::clone(&barrier);
            let label = labels[0].clone();
            std::thread::spawn(move || {
                barrier.wait();
                guard
                    .handle_reply(&label, r, QuitAnswer::Clean, None, 1)
                    .unwrap();
            })
        };
        let ticker = {
            let guard = Arc::clone(&guard);
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                guard.tick(QUIT_ACK_TIMEOUT_MS);
            })
        };
        answerer.join().unwrap();
        ticker.join().unwrap();

        let effects = effects_of(&guard);
        let replies: Vec<bool> = effects
            .iter()
            .filter_map(|e| match e {
                Effect::Reply(v) => Some(*v),
                _ => None,
            })
            .collect();
        let fallbacks = effects
            .iter()
            .filter(|e| matches!(e, Effect::NativeFallback(..)))
            .count();
        assert!(
            (replies.len() == 1 && fallbacks == 0) || (replies.is_empty() && fallbacks == 1),
            "iteration {iteration}: a last answer racing a tick must resolve once, \
             either by replying or by handing over; got {effects:?}"
        );
    }
}

// ── WI3-D12 ───────────────────────────────────────────────────────────────────

/// Effects that call back into the guard while they run. If the driver held its
/// lock across the effects, this deadlocks on a non-reentrant `std::Mutex`.
#[derive(Default)]
struct ReentrantEffects {
    log: Mutex<Vec<Effect>>,
    guard: OnceLock<Weak<QuitGuard<ReentrantEffects>>>,
    begins: Mutex<Vec<Begin>>,
}

impl ReentrantEffects {
    fn reenter(&self) {
        if let Some(guard) = self.guard.get().and_then(|w| w.upgrade()) {
            let outcome = guard.begin(&["x"], 0);
            self.begins.lock().unwrap().push(outcome);
            guard.tick(1);
        }
    }
}

impl QuitEffects for ReentrantEffects {
    fn emit_all(&self, event: QuitEvent) {
        self.log.lock().unwrap().push(Effect::EmitAll(event));
    }
    fn emit_to(&self, label: &str, event: QuitEvent) {
        self.log
            .lock()
            .unwrap()
            .push(Effect::EmitTo(label.to_string(), event));
        self.reenter();
    }
    fn activate(&self, label: &str) {
        self.log
            .lock()
            .unwrap()
            .push(Effect::Activate(label.to_string()));
    }
    fn arm_timer(&self, request_id: u64, deadline_ms: u64) {
        self.log
            .lock()
            .unwrap()
            .push(Effect::ArmTimer(request_id, deadline_ms));
    }
    fn reply(&self, terminate: bool) {
        self.log.lock().unwrap().push(Effect::Reply(terminate));
        self.reenter();
    }
    fn native_fallback(&self, request_id: u64, timed_out: Vec<String>) {
        self.log
            .lock()
            .unwrap()
            .push(Effect::NativeFallback(request_id, timed_out));
    }
}

#[test]
fn d12_effects_run_outside_the_coordinator_lock() {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let gate = leak_gate();
        let guard = Arc::new(QuitGuard::with_gate(ReentrantEffects::default(), gate));
        guard
            .effects()
            .guard
            .set(Arc::downgrade(&guard))
            .unwrap_or_else(|_| panic!("guard slot already filled"));

        let r = later(guard.begin(&["A"], 0));
        guard
            .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
            .unwrap();
        guard
            .handle_reply("A", r, QuitAnswer::Discard, Some(vec![]), 2)
            .unwrap();
        let begins = guard.effects().begins.lock().unwrap().clone();
        let _ = tx.send(begins);
    });

    let begins = rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .expect("the driver deadlocked: effects ran while the coordinator lock was held");

    assert_eq!(
        begins.len(),
        2,
        "expected one re-entrant begin from the prompt and one from the reply"
    );
    assert_eq!(
        begins[0],
        Begin::AlreadyPending,
        "a begin during the pending request must not start a second one"
    );
    assert!(
        matches!(begins[1], Begin::Later { .. }),
        "a begin after the request resolved must start a fresh one, got {:?}",
        begins[1]
    );
}

// ── WI3-W1 ────────────────────────────────────────────────────────────────────

#[test]
fn w1_destroyed_for_a_queued_window_advances_the_quit_without_prompting_it() {
    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Dirty, None, 2)
        .unwrap();
    let before_gone = effects_of(&guard);

    on_window_event(&guard, "B", &tauri::WindowEvent::Destroyed);
    assert_eq!(
        effects_of(&guard),
        before_gone,
        "a destroyed queued window must not produce an effect of its own"
    );

    guard
        .handle_reply("A", r, QuitAnswer::Discard, Some(vec![]), 3)
        .unwrap();

    assert_eq!(
        effects_of(&guard),
        vec![
            Effect::EmitAll(QuitEvent::Requested { request_id: r }),
            Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS),
            Effect::Activate("A".to_string()),
            Effect::EmitTo("A".to_string(), QuitEvent::Prompt { request_id: r }),
            Effect::Reply(true),
        ],
        "B must never be activated and never be prompted"
    );
    assert!(gate.is_closed());
}

// ── WI3-W2 ────────────────────────────────────────────────────────────────────

#[test]
fn w2_only_destroyed_reaches_the_coordinator() {
    // `WindowEvent::CloseRequested` is skipped: its `CloseRequestApi` has no
    // public constructor outside the tauri crate, so no test in this crate can
    // feed it. Manual gate G20 and the WI-9 grep cover that variant.
    // `ScaleFactorChanged` is skipped for the same reason: the variant is
    // `#[non_exhaustive]` in tauri 2.9.5.
    let inert = [
        tauri::WindowEvent::Focused(true),
        tauri::WindowEvent::Focused(false),
        tauri::WindowEvent::Moved(tauri::PhysicalPosition::new(1, 2)),
        tauri::WindowEvent::Resized(tauri::PhysicalSize::new(3, 4)),
        tauri::WindowEvent::ThemeChanged(tauri::Theme::Dark),
    ];

    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A"], 0));
    let effects_before = effects_of(&guard);
    let state_before = guard.snapshot();

    for event in &inert {
        on_window_event(&guard, "A", event);
        assert_eq!(
            effects_of(&guard),
            effects_before,
            "{event:?} produced an effect"
        );
        assert_eq!(
            guard.snapshot(),
            state_before,
            "{event:?} changed the coordinator state"
        );
    }

    guard
        .handle_reply("A", r, QuitAnswer::Clean, None, 5)
        .unwrap();
    assert_eq!(
        effects_of(&guard)
            .iter()
            .filter(|e| matches!(e, Effect::Reply(_)))
            .collect::<Vec<_>>(),
        vec![&Effect::Reply(true)],
        "A was still awaited, so no inert event may have been taken for a gone"
    );

    // A `Destroyed` with no request pending is a no-op, not a panic.
    let idle = recording_guard(leak_gate());
    on_window_event(&idle, "A", &tauri::WindowEvent::Destroyed);
    assert!(effects_of(&idle).is_empty());

    // Control: the same event during phase 1 really does resolve the request,
    // so the assertions above are not vacuous.
    let control = recording_guard(leak_gate());
    later(control.begin(&["A"], 0));
    on_window_event(&control, "A", &tauri::WindowEvent::Destroyed);
    assert_eq!(effects_of(&control).last(), Some(&Effect::Reply(true)));
}
