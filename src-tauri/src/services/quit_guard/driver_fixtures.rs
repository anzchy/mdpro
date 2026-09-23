//! Shared fixtures for the driver test modules (`driver_tests.rs` and its siblings).
//!
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
use super::DraftGate;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

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

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// A directory no other call — in this process or a concurrent `cargo test`
/// process — has been or will be handed: `label-pid-seq`, with `seq` from a
/// process-wide atomic counter. Only the new path is ever removed (a stale
/// leftover from an earlier run with a recycled pid), never a shared one.
fn unique_temp_dir(label: &str) -> PathBuf {
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let name = format!("{label}-{}-{seq}", std::process::id());
    let dir = std::env::temp_dir().join("mdpro_test").join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("temp home is creatable");
    dir
}

/// Fresh, empty temp HOME, unique per call (see `unique_temp_dir`).
pub(super) fn make_temp_home(label: &str) -> PathBuf {
    unique_temp_dir(label)
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

/// Which liveness-critical effects this fixture should report as *not*
/// dispatched. ADR-0029 §4 makes those failures visible to the driver, so a
/// test needs to be able to produce one.
#[derive(Default)]
pub(super) struct FailingEffects {
    pub emit_to: Vec<String>,
    /// Event names (`QuitEvent::name`) whose broadcast reports failure.
    pub emit_all: Vec<&'static str>,
    pub activate: bool,
    pub reply: bool,
    pub native_fallback: bool,
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
    failing: Mutex<FailingEffects>,
}

impl RecordingEffects {
    pub(super) fn watching(gate: &'static DraftGate) -> Self {
        Self {
            log: Mutex::new(Vec::new()),
            deletes: Mutex::new(Vec::new()),
            gate: Some(gate),
            failing: Mutex::new(FailingEffects::default()),
        }
    }

    /// Make one effect report failure from now on.
    pub(super) fn fail(&self, set: impl FnOnce(&mut FailingEffects)) {
        set(&mut self.failing.lock().unwrap());
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
    fn emit_all(&self, event: QuitEvent) -> bool {
        self.push(Effect::EmitAll(event));
        !self
            .failing
            .lock()
            .unwrap()
            .emit_all
            .contains(&event.name())
    }
    fn emit_to(&self, label: &str, event: QuitEvent) -> bool {
        self.push(Effect::EmitTo(label.to_string(), event));
        !self
            .failing
            .lock()
            .unwrap()
            .emit_to
            .iter()
            .any(|l| l == label)
    }
    fn activate(&self, label: &str) -> bool {
        self.push(Effect::Activate(label.to_string()));
        !self.failing.lock().unwrap().activate
    }
    fn arm_timer(&self, request_id: u64, deadline_ms: u64) {
        self.push(Effect::ArmTimer(request_id, deadline_ms));
    }
    fn reply(&self, terminate: bool) -> bool {
        self.push(Effect::Reply(terminate));
        !self.failing.lock().unwrap().reply
    }
    fn native_fallback(&self, request_id: u64, timed_out: Vec<String>) -> bool {
        self.push(Effect::NativeFallback(request_id, timed_out));
        !self.failing.lock().unwrap().native_fallback
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

// ── Log-file helpers (moved from `driver_deadline_tests.rs`) ─────────────────

/// A fresh, empty temp `$HOME` for log assertions, unique per call. It does not
/// create the log file or touch the logging settings; callers that need
/// logging on must enable it themselves.
pub(super) fn fresh_log_home(label: &str) -> PathBuf {
    unique_temp_dir(label)
}

pub(super) fn log_lines(home: &Path) -> Vec<Value> {
    let raw = fs::read_to_string(home.join(".mdpro").join("mdpro.log")).unwrap_or_default();
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .collect()
}

/// Lines for one event and request id, narrowed further by `distinguishes` —
/// a `$HOME` is process-wide, so a test running in parallel writes into this
/// same file, and request ids restart at 1 for every guard. The extra predicate
/// is what makes the count assertions below about this test's own lines.
pub(super) fn entries_where(
    home: &Path,
    event: &str,
    request_id: u64,
    distinguishes: impl Fn(&Value) -> bool,
) -> Vec<Value> {
    log_lines(home)
        .into_iter()
        .filter(|v| {
            v.get("event").and_then(Value::as_str) == Some(event)
                && v.pointer("/context/requestId").and_then(Value::as_u64) == Some(request_id)
                && distinguishes(v)
        })
        .collect()
}

/// A guard whose next request id is exactly `floor`, so a log-reading test can
/// filter on a request id no other guard in the process will reach. It burns
/// `floor - 1` requests (`begin(["burn"])` then `window_gone("burn")`) with
/// logging off, then turns logging back on at `Info`.
/// SAFETY: caller must hold HOME_LOCK — the logging settings are process-wide.
pub(super) fn guard_at(floor: u64) -> QuitGuard<RecordingEffects> {
    use crate::models::{LogLevel, LogSettings};
    use crate::services::logger;
    logger::set_log_settings(LogSettings {
        enabled: false,
        level: LogLevel::Info,
    });
    let guard = recording_guard(leak_gate());
    for _ in 1..floor {
        later(guard.begin(&["burn"], 0));
        guard.window_gone("burn", 0);
    }
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    guard
}
