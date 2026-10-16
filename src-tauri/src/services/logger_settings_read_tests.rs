//! M1a WI-1: the logger's lock-free, read-only settings read.
//!
//! Cases L1, L1b, L2, L5, L4/L6, L7 and L8 of
//! `.claude/tdd-guardian/tests-20261016-202016.md` (L3 is the re-pointed
//! `logger_corrupt_config_tests.rs`).
//!
//! **Law (S6, delegator ruling 1):** for every document `d`,
//! `read_initial_logging(d) == load_preferences(d).ok().map(|p| p.logging)`,
//! except that a missing file reads as `Some(LogSettings::default())`. The read
//! never writes. So any document the loader refuses makes the logger fail
//! closed (ADR-0042 decision 6).
//!
//! Lives under `logger` to reach `resolve_initial_settings`; the settings
//! cache itself is a process-wide `OnceLock` that a test cannot re-initialise.

use super::*;
use crate::models::UserPreferences;
use crate::services::mcp_controller::test_support::GENEROUS;
use crate::services::preferences::PreferencesError;
use crate::services::preferences::{load_preferences, preferences_rw_lock};
use crate::services::prefs_guard::{reentry_check, PrefsGuard};
use crate::services::window_restore::test_home::{
    config_file, read_config_bytes, seed_config, write_raw_config, TestHome,
};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{self, RecvTimeoutError};

type Pair = (bool, LogLevel);

fn pair(s: LogSettings) -> Pair {
    (s.enabled, s.level)
}

fn seed_warn_off(h: &TestHome) -> Vec<u8> {
    seed_config(&h.dir, |v| {
        v["logging"] = json!({ "enabled": false, "level": "warn" });
    })
}

/// Runs `f` on a worker that holds a guard on a **local** mutex, so a wrong
/// implementation panics without poisoning the global lock.
fn on_a_marked_thread<T: Send + 'static>(
    f: fn() -> T,
) -> Result<(bool, Option<T>), RecvTimeoutError> {
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let local = Mutex::new(());
        let g = PrefsGuard::acquire_in(&local);
        let held = g.is_ok();
        let r = catch_unwind(AssertUnwindSafe(f)).ok();
        drop(g);
        let _ = tx.send((held, r));
    });
    let got = rx.recv_timeout(GENEROUS);
    if got.is_ok() {
        let _ = worker.join();
    }
    got
}

#[test]
fn l1_a_cold_logger_read_on_a_marked_thread_returns_the_stored_value() {
    let h = TestHome::new("l1_marked_read");
    let before = seed_warn_off(&h);

    let got = on_a_marked_thread(|| read_initial_logging().map(pair));

    assert_eq!(got, Ok((true, Some(Some((false, LogLevel::Warn))))));
    let resolved = resolve_initial_settings(Some(LogSettings {
        enabled: false,
        level: LogLevel::Warn,
    }));
    // Warn, not FAIL_CLOSED_SETTINGS' Info: off because the user said so.
    assert_eq!(pair(resolved), (false, LogLevel::Warn));
    assert_eq!(read_config_bytes(&h.dir), before, "bytes unchanged");
}

#[test]
fn l1b_the_logger_read_does_not_wait_for_a_raw_global_lock_holder() {
    let h = TestHome::new("l1b_raw_lock_held");
    let before = seed_warn_off(&h);

    let raw = preferences_rw_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let _ = tx.send(read_initial_logging().map(pair));
    });
    let while_held = rx.recv_timeout(GENEROUS);
    drop(raw);
    let _ = reader.join();

    assert_eq!(while_held, Ok(Some((false, LogLevel::Warn))));
    assert_eq!(read_config_bytes(&h.dir), before, "bytes unchanged");
}

#[test]
fn l2_a_missing_file_reads_as_the_default_and_writes_nothing() {
    let h = TestHome::new("l2_missing");
    assert!(
        !config_file(&h.dir).exists(),
        "precondition: no config.json"
    );

    let got = read_initial_logging().map(pair);

    assert_eq!(got, Some(pair(LogSettings::default())));
    assert_eq!(got, Some((true, LogLevel::Info)));
    assert!(
        !config_file(&h.dir).exists(),
        "the logger read created config.json"
    );
}

/// A default document with `logging {true, debug}` and one ill-typed sibling.
fn ill_typed(field: &str, value: Value) -> String {
    let mut v = serde_json::to_value(UserPreferences::default()).expect("defaults");
    v["logging"] = json!({ "enabled": true, "level": "debug" });
    v[field] = value;
    serde_json::to_string(&v).expect("serialises")
}

fn ill_typed_docs() -> Vec<(&'static str, String)> {
    vec![
        (
            "autoSaveInterval: \"x\"",
            ill_typed("autoSaveInterval", json!("x")),
        ),
        (
            "keyboardShortcuts: 42",
            ill_typed("keyboardShortcuts", json!(42)),
        ),
        ("themeMode: 7", ill_typed("themeMode", json!(7))),
    ]
}

#[test]
fn l5_valid_logging_beside_an_ill_typed_sibling_still_fails_closed() {
    let h = TestHome::new("l5_ill_typed_sibling");
    for (label, raw) in ill_typed_docs() {
        let before = write_raw_config(&h.dir, &raw);
        let got = read_initial_logging().map(pair);
        let after_read = read_config_bytes(&h.dir);
        let loader_refuses = load_preferences().is_err();

        assert!(loader_refuses, "{label}: precondition: the loader refuses");
        assert_eq!(got, None, "{label}: logging must fail closed");
        assert!(!resolve_initial_settings(None).enabled, "{label}");
        assert_eq!(after_read, before, "{label}: bytes unchanged");
    }
}

#[test]
fn l7_a_directory_in_place_of_config_json_fails_closed() {
    let h = TestHome::new("l7_config_is_a_dir");
    std::fs::create_dir_all(config_file(&h.dir)).expect("config.json as a directory");

    let got = read_initial_logging().map(pair);
    let loader_refuses = load_preferences().is_err();

    assert!(loader_refuses, "precondition: the loader refuses");
    assert_eq!(got, None, "only NotFound reads as missing");
    assert!(!resolve_initial_settings(None).enabled);
    assert!(config_file(&h.dir).is_dir(), "the directory was replaced");
}

/// M1A-WI-3d: a malformed stamp the read must stay lenient on.
const STAMP_OBJECT: &str = "keyboardShortcutsVersion: {}";

enum Doc {
    Raw(String),
    Directory,
}

fn domain() -> Vec<(String, Doc)> {
    let defaults = || serde_json::to_value(UserPreferences::default()).expect("defaults");
    let mut docs: Vec<(String, Doc)> = Vec::new();
    for enabled in [true, false] {
        for level in ["debug", "info", "warn", "error"] {
            let mut v = defaults();
            v["logging"] = json!({ "enabled": enabled, "level": level });
            docs.push((
                format!("logging {enabled}/{level}"),
                Doc::Raw(v.to_string()),
            ));
        }
    }
    let mut v = defaults();
    v.as_object_mut().expect("object").remove("logging");
    docs.push(("logging absent".into(), Doc::Raw(v.to_string())));
    let mut v = defaults();
    v["sidebarWidth"] = json!("x");
    docs.push(("sidebarWidth: \"x\"".into(), Doc::Raw(v.to_string())));
    let mut v = defaults();
    v["logging"] = json!({ "enabled": false, "level": "error" });
    for (_, binding) in v["keyboardShortcuts"]
        .as_object_mut()
        .expect("shortcuts object")
        .iter_mut()
    {
        *binding = json!("");
    }
    docs.push(("every shortcut \"\"".into(), Doc::Raw(v.to_string())));
    let mut v = defaults();
    v["notAField"] = json!({ "nested": [1, 2] });
    docs.push(("unknown top-level key".into(), Doc::Raw(v.to_string())));
    for (label, raw) in ill_typed_docs() {
        docs.push((label.into(), Doc::Raw(raw)));
    }
    let mut v = defaults();
    v["keyboardShortcutsVersion"] = json!({});
    v["logging"] = json!({ "enabled": false, "level": "error" });
    docs.push((STAMP_OBJECT.into(), Doc::Raw(v.to_string())));
    docs.push(("not JSON".into(), Doc::Raw("{ not json".into())));
    docs.push(("config.json is a directory".into(), Doc::Directory));
    docs
}

#[test]
fn l4_l6_the_logger_read_agrees_with_the_loader_on_every_document() {
    let h = TestHome::new("l4_l6_agreement");
    let docs = domain();
    let mut mismatches = Vec::new();
    for (label, doc) in &docs {
        let path = config_file(&h.dir);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&path);
        let before = match doc {
            Doc::Raw(raw) => Some(write_raw_config(&h.dir, raw)),
            Doc::Directory => {
                std::fs::create_dir_all(&path).expect("directory");
                None
            }
        };

        // The logger reads first, so the loader cannot have repaired anything.
        let logger_read = read_initial_logging().map(pair);
        if let Some(before) = &before {
            if &std::fs::read(&path).unwrap_or_default() != before {
                mismatches.push(format!("{label}: the logger read changed the bytes"));
            }
        }
        let loader_read = load_preferences().ok().map(|p| pair(p.logging));
        if logger_read != loader_read {
            mismatches.push(format!(
                "{label}: logger {logger_read:?} != loader {loader_read:?}"
            ));
        }
    }
    assert_eq!(docs.len(), 18, "the enumerated domain changed size");
    assert!(mismatches.is_empty(), "{mismatches:#?}");

    // M1A-WI-3d, by value: both reads see `{}` as version 1, not a ParseError.
    let Some((_, Doc::Raw(raw))) = docs.iter().find(|(l, _)| l == STAMP_OBJECT) else {
        panic!("{STAMP_OBJECT} is missing from the domain");
    };
    let _ = std::fs::remove_dir(config_file(&h.dir));
    let before = write_raw_config(&h.dir, raw);
    let logger_read = read_initial_logging().map(pair);
    assert_eq!(read_config_bytes(&h.dir), before, "{STAMP_OBJECT}: bytes");
    let loaded = load_preferences()
        .ok()
        .map(|p| (pair(p.logging), p.keyboard_shortcuts_version));
    assert_eq!(
        logger_read,
        Some((false, LogLevel::Error)),
        "{STAMP_OBJECT}"
    );
    assert_eq!(
        loaded,
        Some(((false, LogLevel::Error), 1)),
        "{STAMP_OBJECT}"
    );
}

#[test]
fn l8_initial_settings_on_a_marked_thread_is_the_stored_value() {
    let h = TestHome::new("l8_initial_settings");
    let before = seed_warn_off(&h);

    let got = on_a_marked_thread(|| pair(initial_settings()));

    assert_eq!(got, Ok((true, Some((false, LogLevel::Warn)))));
    assert_eq!(read_config_bytes(&h.dir), before, "bytes unchanged");
}

/// M1A-WI-3c: under a real, held global `PrefsGuard` the read still returns
/// the stored value, while the public loader refuses on that thread. A read
/// that delegated to the loader returns `None`; one that waited on the lock
/// times out.
#[test]
fn l8_a_read_under_the_held_global_guard_returns_the_stored_value() {
    let h = TestHome::new("l8_global_guard");
    let before = seed_warn_off(&h);
    // Warm the process-wide cache first, so the loader's `ReentrantLoad` log
    // record can never be the cache's first initialisation.
    let _ = get_log_settings();

    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let g = PrefsGuard::acquire();
        let pre = matches!(reentry_check(), Err(PreferencesError::ReentrantLoad));
        let r = catch_unwind(|| read_initial_logging().map(pair)).ok();
        let loader = catch_unwind(|| load_preferences().map(|_| ())).is_err();
        let held = g.is_ok();
        drop(g);
        let _ = tx.send((held, pre, r, loader));
    });
    let got = rx.recv_timeout(GENEROUS);
    if got.is_ok() {
        let _ = worker.join();
    }

    assert_eq!(
        got,
        Ok((true, true, Some(Some((false, LogLevel::Warn))), true))
    );
    assert_eq!(read_config_bytes(&h.dir), before, "bytes unchanged");
}
