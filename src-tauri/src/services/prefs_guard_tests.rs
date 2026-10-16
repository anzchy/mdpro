//! M1a WI-1: `PrefsGuard` and the public loader's re-entry refusal.
//!
//! Cases G0, G1, G1g, G2, G3, G3b, G-iso, C7b, G4, G5, G6, G7 and G9 of
//! `.claude/tdd-guardian/tests-20261016-202016.md`.
//!
//! **Law (S5):** on any thread, *marked* ⇔ *a `PrefsGuard` constructed on this
//! thread is still alive*. A failed acquire never changes the mark, and the
//! mark is per thread.
//!
//! Every panic runs under a **local** mutex through `acquire_in`, and no
//! assertion runs while the global `preferences_rw_lock` is held: one panic
//! under the global guard would poison it for the whole test binary
//! (`commands/logging.rs` R5 discipline).

use super::*;
use crate::models::{LogLevel, LogSettings, UserPreferences};
use crate::services::logger;
use crate::services::mcp_controller::test_support::GENEROUS;
use crate::services::preferences::{
    load_preferences, preferences_rw_lock, save_preferences, PreferencesError,
};
use crate::services::window_restore::test_home::{
    config_file, read_config_bytes, seed_config, TestHome,
};
use serde_json::{json, Value};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// A local mutex poisoned the `rd5` way (`window_restore_read_tests.rs`).
fn poisoned_mutex() -> Arc<Mutex<()>> {
    let m = Arc::new(Mutex::new(()));
    let m2 = Arc::clone(&m);
    let _ = std::thread::spawn(move || {
        let _g = m2.lock();
        panic!("poisoning a local test mutex on purpose");
    })
    .join();
    m
}

/// `Ok(())` / the error, so a guard result can be compared without `Debug`.
fn outcome(r: &Result<PrefsGuard<'_>, GuardError>) -> Result<(), GuardError> {
    r.as_ref().map(|_| ()).map_err(|e| *e)
}

fn marked() -> bool {
    reentry_check().is_err()
}

// ---------------------------------------------------------------------------
// G0: the marker law over every operation sequence up to length 5.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
enum Op {
    Acquire,
    DropNewest,
    AcquirePoisoned,
    PanicWhileHolding,
}

const OPS: [Op; 4] = [
    Op::Acquire,
    Op::DropNewest,
    Op::AcquirePoisoned,
    Op::PanicWhileHolding,
];

fn leak_mutex() -> &'static Mutex<()> {
    Box::leak(Box::new(Mutex::new(())))
}

/// Runs `seq` against the model on the calling thread. `Err` names the first
/// step whose observation disagrees with the model.
fn run_sequence(seq: &[Op]) -> Result<(), String> {
    let poisoned: &'static Mutex<()> = {
        let m = leak_mutex();
        let _ = catch_unwind(AssertUnwindSafe(|| {
            let _g = m.lock();
            panic!("G0: poisoning this sequence's local mutex");
        }));
        m
    };
    if !poisoned.is_poisoned() {
        return Err("precondition: the poisoned mutex is not poisoned".into());
    }
    let mut held: Option<PrefsGuard<'static>> = None;
    if marked() {
        return Err("a fresh thread starts marked".into());
    }
    for (i, op) in seq.iter().enumerate() {
        let was_marked = held.is_some();
        match op {
            Op::Acquire => {
                let r = PrefsGuard::acquire_in(leak_mutex());
                let got = outcome(&r);
                let want = if was_marked {
                    Err(GuardError::Reentrant)
                } else {
                    Ok(())
                };
                if got != want {
                    return Err(format!("step {i} {op:?}: got {got:?}, want {want:?}"));
                }
                if let Ok(g) = r {
                    held = Some(g);
                }
            }
            Op::DropNewest => {
                held = None;
            }
            Op::AcquirePoisoned => {
                let got = outcome(&PrefsGuard::acquire_in(poisoned));
                let want = if was_marked {
                    Err(GuardError::Reentrant)
                } else {
                    Err(GuardError::Poisoned)
                };
                if got != want {
                    return Err(format!("step {i} {op:?}: got {got:?}, want {want:?}"));
                }
            }
            Op::PanicWhileHolding => {
                let fresh = leak_mutex();
                let mut seen: Option<Result<(), GuardError>> = None;
                let caught = catch_unwind(AssertUnwindSafe(|| {
                    let r = PrefsGuard::acquire_in(fresh);
                    seen = Some(outcome(&r));
                    panic!("G0: unwinding with the acquire result alive");
                }));
                let want = if was_marked {
                    Err(GuardError::Reentrant)
                } else {
                    Ok(())
                };
                if caught.is_ok() || seen != Some(want) {
                    return Err(format!("step {i} {op:?}: saw {seen:?}, want {want:?}"));
                }
                if !was_marked && !fresh.is_poisoned() {
                    return Err(format!(
                        "step {i} {op:?}: the guard was not held in the panic"
                    ));
                }
            }
        }
        if marked() != held.is_some() {
            return Err(format!(
                "step {i} {op:?}: marked() == {}, model holds a guard == {}",
                marked(),
                held.is_some()
            ));
        }
    }
    drop(held);
    if marked() {
        return Err("marked after every guard dropped".into());
    }
    Ok(())
}

#[test]
fn g0_marker_law_over_every_sequence_up_to_length_five() {
    let mut failures = Vec::new();
    let mut count = 0usize;
    for len in 1..=5u32 {
        for code in 0..4usize.pow(len) {
            let mut c = code;
            let seq: Vec<Op> = (0..len)
                .map(|_| {
                    let op = OPS[c % 4];
                    c /= 4;
                    op
                })
                .collect();
            count += 1;
            let seq_for_thread = seq.clone();
            let res = std::thread::spawn(move || run_sequence(&seq_for_thread))
                .join()
                .unwrap_or_else(|_| Err("the sequence thread panicked".into()));
            if let Err(e) = res {
                failures.push(format!("{seq:?}: {e}"));
            }
        }
    }
    assert_eq!(count, 1364, "the enumerated domain changed size");
    assert!(
        failures.is_empty(),
        "{} of {count} sequences broke the marker law; first: {:?}",
        failures.len(),
        failures.iter().take(3).collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------
// G1, G1g, G2, G3, G3b, G-iso, C7b, G5: single transitions.
// ---------------------------------------------------------------------------

#[test]
fn g1_acquire_marks_the_thread_drop_clears_it_and_reacquire_works() {
    let m = Mutex::new(());
    let before = reentry_check();
    let g = PrefsGuard::acquire_in(&m);
    let first = outcome(&g);
    let during = reentry_check();
    drop(g);
    let after = reentry_check();
    let again = outcome(&PrefsGuard::acquire_in(&m));

    assert!(before.is_ok(), "unmarked before: {before:?}");
    assert_eq!(first, Ok(()));
    assert!(
        matches!(during, Err(PreferencesError::ReentrantLoad)),
        "marked while held: {during:?}"
    );
    assert!(after.is_ok(), "unmarked after the drop: {after:?}");
    assert_eq!(again, Ok(()));
}

#[test]
fn g1g_the_global_acquire_marks_the_thread_too() {
    let _h = TestHome::new("g1g_global_acquire");
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let g = PrefsGuard::acquire();
        let g_ok = g.is_ok();
        let r1 = matches!(reentry_check(), Err(PreferencesError::ReentrantLoad));
        let r2 = PrefsGuard::acquire();
        let r2_reentrant = matches!(r2, Err(GuardError::Reentrant));
        drop(r2);
        drop(g);
        let r3 = reentry_check().is_ok();
        let _ = tx.send((g_ok, r1, r2_reentrant, r3));
    });
    let got = rx.recv_timeout(GENEROUS);
    if got.is_ok() {
        let _ = worker.join();
    }
    assert_eq!(
        got,
        Ok((true, true, true, true)),
        "(acquired, marked while held, second acquire Reentrant, unmarked after drop)"
    );
}

#[test]
fn g2_a_guard_dropped_by_a_panic_leaves_the_thread_unmarked() {
    let local = Mutex::new(());
    let caught = catch_unwind(AssertUnwindSafe(|| {
        let _g = PrefsGuard::acquire_in(&local);
        panic!("G2: unwinding under a guard");
    }));
    let after = reentry_check();
    let fresh = Mutex::new(());
    let again = outcome(&PrefsGuard::acquire_in(&fresh));

    assert!(caught.is_err(), "the panic must propagate to catch_unwind");
    assert!(
        local.is_poisoned(),
        "precondition: the guard was held during the panic"
    );
    assert!(after.is_ok(), "unmarked after unwinding: {after:?}");
    assert_eq!(again, Ok(()));
}

#[test]
fn g3_a_second_acquire_on_a_marked_thread_is_reentrant_and_does_not_hang() {
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let m = Mutex::new(());
        let g = PrefsGuard::acquire_in(&m);
        let first = outcome(&g);
        let second = outcome(&PrefsGuard::acquire_in(&m));
        drop(g);
        let _ = tx.send((first, second));
    });
    let got = rx.recv_timeout(GENEROUS);
    if got.is_ok() {
        let _ = worker.join();
    }
    assert_eq!(got, Ok((Ok(()), Err(GuardError::Reentrant))));
}

#[test]
fn g3b_a_refused_reentrant_acquire_keeps_the_outer_mark() {
    let a = Mutex::new(());
    let b = Mutex::new(());
    let g = PrefsGuard::acquire_in(&a);
    let outer = outcome(&g);
    let inner = outcome(&PrefsGuard::acquire_in(&b));
    let after_refusal = reentry_check();
    let b_free = b.try_lock().is_ok();
    drop(g);
    let after_drop = reentry_check();

    assert_eq!(outer, Ok(()));
    assert_eq!(
        inner,
        Err(GuardError::Reentrant),
        "the mark belongs to the thread, not to a mutex"
    );
    assert!(
        matches!(after_refusal, Err(PreferencesError::ReentrantLoad)),
        "the refusal cleared the outer mark: {after_refusal:?}"
    );
    assert!(b_free, "the refused acquire took `b`");
    assert!(
        after_drop.is_ok(),
        "unmarked after the drop: {after_drop:?}"
    );
}

#[test]
fn g_iso_the_mark_is_per_thread() {
    let a = Mutex::new(());
    let g = PrefsGuard::acquire_in(&a);
    let main_marked = marked();
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let unmarked = reentry_check().is_ok();
        let b = Mutex::new(());
        let r = outcome(&PrefsGuard::acquire_in(&b));
        let _ = tx.send((unmarked, r));
    });
    let got = rx.recv_timeout(GENEROUS);
    drop(g);
    if got.is_ok() {
        let _ = worker.join();
    }
    assert!(main_marked, "precondition: the main thread is marked");
    assert_eq!(got, Ok((true, Ok(()))));
}

#[test]
fn c7b_a_poisoned_mutex_is_poisoned_not_reentrant_and_leaves_the_thread_unmarked() {
    let poisoned = poisoned_mutex();
    assert!(poisoned.is_poisoned(), "precondition: lock is poisoned");
    let r = outcome(&PrefsGuard::acquire_in(&poisoned));
    let after = reentry_check();
    let fresh = Mutex::new(());
    let again = outcome(&PrefsGuard::acquire_in(&fresh));

    assert_eq!(r, Err(GuardError::Poisoned));
    assert!(after.is_ok(), "a poisoned acquire marked the thread");
    assert_eq!(again, Ok(()));
}

#[test]
fn g5_reentry_check_is_ok_unmarked_and_reentrant_load_marked() {
    let unmarked = reentry_check();
    let local = Mutex::new(());
    let g = PrefsGuard::acquire_in(&local);
    let held = outcome(&g);
    let marked_result = reentry_check();
    drop(g);

    assert!(unmarked.is_ok(), "unmarked: {unmarked:?}");
    assert_eq!(held, Ok(()));
    assert!(
        matches!(marked_result, Err(PreferencesError::ReentrantLoad)),
        "marked: {marked_result:?}"
    );
}

// ---------------------------------------------------------------------------
// G7: the IPC shape of the new variant.
// ---------------------------------------------------------------------------

#[test]
fn g7_reentrant_load_serialises_as_its_bare_variant_name() {
    let v = serde_json::to_value(&PreferencesError::ReentrantLoad).expect("serialises");
    assert_eq!(v, json!("ReentrantLoad"));
}

// ---------------------------------------------------------------------------
// G4, G6, G9: the public loader.
// ---------------------------------------------------------------------------

/// What a worker that holds a local guard saw when it called the public loader.
fn load_on_a_marked_thread() -> Result<(bool, &'static str), RecvTimeoutError> {
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let local = Mutex::new(());
        let g = PrefsGuard::acquire_in(&local);
        let held = g.is_ok();
        let r = catch_unwind(AssertUnwindSafe(load_preferences));
        drop(g);
        let summary = match r {
            Err(_) => "panicked",
            Ok(Err(PreferencesError::ReentrantLoad)) => "reentrant",
            Ok(Ok(_)) => "loaded",
            Ok(Err(_)) => "other error",
        };
        let _ = tx.send((held, summary));
    });
    let got = rx.recv_timeout(GENEROUS);
    if got.is_ok() {
        let _ = worker.join();
    }
    got
}

#[cfg(debug_assertions)]
const MARKED_LOAD: &str = "panicked";
#[cfg(not(debug_assertions))]
const MARKED_LOAD: &str = "reentrant";

#[test]
fn g4_the_public_loader_refuses_on_a_marked_thread_and_never_blocks() {
    let h = TestHome::new("g4_marked_load");
    let before = seed_config(&h.dir, |v| v["autoSaveInterval"] = json!(111));

    let got = load_on_a_marked_thread();

    assert_eq!(
        got,
        Ok((true, MARKED_LOAD)),
        "debug: the debug_assert fires; release: Err(ReentrantLoad)"
    );
    // The worker has finished, so it holds nothing; a loader that took the
    // global lock before checking the mark would have panicked under it.
    assert!(
        !preferences_rw_lock().is_poisoned(),
        "the global preferences lock was poisoned"
    );
    assert_eq!(read_config_bytes(&h.dir), before, "bytes unchanged");
}

#[test]
fn g6_a_load_waits_for_a_held_guard_and_sees_only_the_post_write_state() {
    let h = TestHome::new("g6_writer_holds");
    seed_config(&h.dir, |v| v["autoSaveInterval"] = json!(111));

    let g = PrefsGuard::acquire();
    let held = g.is_ok();
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let r = load_preferences()
            .map(|p| p.auto_save_interval)
            .map_err(|e| format!("{e:?}"));
        let _ = tx.send(r);
    });
    let while_held = rx.recv_timeout(Duration::from_millis(300));
    let doc = UserPreferences {
        auto_save_interval: 333,
        ..UserPreferences::default()
    };
    let saved = save_preferences(&doc).is_ok();
    drop(g);
    let after = rx.recv_timeout(GENEROUS);
    if after.is_ok() {
        let _ = reader.join();
    }

    assert!(held, "precondition: the writer took the guard");
    assert!(
        matches!(while_held, Err(RecvTimeoutError::Timeout)),
        "the load returned while the guard was held: {while_held:?}"
    );
    assert!(saved, "the writer's save failed");
    assert_eq!(after, Ok(Ok(333)));
    let on_disk: Value =
        serde_json::from_slice(&read_config_bytes(&h.dir)).expect("config is JSON");
    assert_eq!(on_disk["autoSaveInterval"], json!(333));
}

/// Restores the process-wide log settings on drop.
struct LoggerSettingsRestorer(LogSettings);
impl Drop for LoggerSettingsRestorer {
    fn drop(&mut self) {
        logger::set_log_settings(self.0.clone());
    }
}

fn log_records(home: &Path, event: &str) -> Vec<Value> {
    let raw = std::fs::read_to_string(home.join(".mdpro").join("mdpro.log")).unwrap_or_default();
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["event"] == json!(event))
        .collect()
}

#[test]
fn g9_a_reentrant_load_writes_one_fail_record_with_no_path() {
    let h = TestHome::new("g9_reentrant_log");
    seed_config(&h.dir, |v| v["autoSaveInterval"] = json!(111));
    assert!(config_file(&h.dir).exists(), "precondition: seeded");
    let _restore = LoggerSettingsRestorer(logger::get_log_settings());
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    let _ = std::fs::remove_file(h.dir.join(".mdpro").join("mdpro.log"));

    let got = load_on_a_marked_thread();
    let records = log_records(&h.dir, "preferences.load");

    assert_eq!(got, Ok((true, MARKED_LOAD)));
    assert_eq!(records.len(), 1, "records: {records:?}");
    assert_eq!(records[0]["status"], json!("fail"));
    assert_eq!(records[0]["error"], json!("ReentrantLoad"));
    let dir = h.dir.to_str().expect("utf-8 temp dir");
    assert!(
        !records[0].to_string().contains(dir),
        "the record carries the home path: {}",
        records[0]
    );
}
