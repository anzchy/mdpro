//! WI-4 (ADR-0031 step 5a, ADR-0037 Decision 3): only `main` writes the global
//! `windowState`. Cases WI4-01 … WI4-07 of
//! `.claude/tdd-guardian/tests-20260926-221500.md` (WI4-08 is
//! `preferences_tests.rs` passing unmodified).
//!
//! **Law**: for every label ≠ `"main"`, `Ok(())`, `config.json` byte-identical,
//! no load and no lock; for `"main"` only `windowState` changes; a `"skipped"`
//! log outcome appears iff the label is not `"main"`.
//!
//! Nothing is mocked: real `$HOME`, real `config.json`, real serde, real
//! logger. Harness helpers are copied from `preferences_tests.rs:34-117,493-500`
//! (private to that module, which must not be modified).

use super::*;
use crate::models::{LogLevel, LogSettings, UserPreferences};
use crate::services::logger;
use crate::HOME_LOCK;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

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
    unsafe { std::env::set_var("HOME", path.to_str().expect("temp dir path is non-UTF-8")) };
    HomeRestorer(prev)
}
fn temp_home(label: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join("mdpro_window_state_cmd_test")
        .join(format!("{label}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
struct LoggerSettingsRestorer(LogSettings);
impl Drop for LoggerSettingsRestorer {
    fn drop(&mut self) {
        logger::set_log_settings(self.0.clone());
    }
}
/// Must be called *after* `set_home`. Forces the logger on (debug).
fn force_logger_on() -> LoggerSettingsRestorer {
    let restorer = LoggerSettingsRestorer(logger::get_log_settings());
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    restorer
}
const MALFORMED: &str = "{ not valid json !! }";
const EVENT: &str = "preferences.window_state.save";
const NON_OWNERS: [&str; 11] = [
    "mdpro-3f2a",
    "Main",
    "MAIN",
    "main ",
    " main",
    "main\n",
    "mainx",
    "mai",
    "",
    "m\u{0430}in", // Cyrillic a
    "main\u{200b}",
];
fn seed_config(home: &Path, mutate: impl FnOnce(&mut Value)) -> Vec<u8> {
    let dir = home.join(".mdpro");
    std::fs::create_dir_all(&dir).unwrap();
    let mut v = serde_json::to_value(UserPreferences::default()).unwrap();
    mutate(&mut v);
    let raw = serde_json::to_string(&v).unwrap();
    std::fs::write(dir.join("config.json"), &raw).unwrap();
    raw.into_bytes()
}
/// The rich, non-default document every conservation case starts from.
fn seed_rich(home: &Path) -> Vec<u8> {
    seed_config(home, |v| {
        v["windowState"] = json!({"width":1111,"height":777,"x":3,"y":4,"isMaximized":false});
        v["recentFiles"] = json!(["/tmp/keep.md"]);
        v["autoSaveInterval"] = json!(111);
    })
}
fn write_raw_config(home: &Path, raw: &str) -> Vec<u8> {
    let dir = home.join(".mdpro");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("config.json"), raw).unwrap();
    raw.as_bytes().to_vec()
}
fn read_config_bytes(home: &Path) -> Vec<u8> {
    std::fs::read(home.join(".mdpro").join("config.json")).expect("config.json must still exist")
}
fn log_records(home: &Path, event: &str) -> Vec<Value> {
    let raw = std::fs::read_to_string(home.join(".mdpro").join("mdpro.log")).unwrap_or_default();
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["event"] == json!(event))
        .collect()
}
fn remove_log(home: &Path) {
    let _ = std::fs::remove_file(home.join(".mdpro").join("mdpro.log"));
}
fn a_window_state() -> WindowState {
    WindowState {
        width: 640,
        height: 480,
        x: 5,
        y: 5,
        is_maximized: true,
    }
}

// WI4-01 (regression red): every non-owner label → Ok, bytes identical.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi4_01_non_owner_labels_leave_config_byte_identical() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi4_01");
    let _home_guard = set_home(&home);
    for label in NON_OWNERS {
        let before = seed_rich(&home);
        let res = save_window_state_as(label, a_window_state()).await;
        assert!(res.is_ok(), "label {label:?}: expected Ok, got {res:?}");
        assert_eq!(read_config_bytes(&home), before, "label {label:?}");
    }
    let _ = std::fs::remove_dir_all(&home);
}

// WI4-02: non-owner with an unparseable config → Ok, bytes identical (no load).
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi4_02_non_owner_with_unparseable_config_does_not_load() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi4_02");
    let _home_guard = set_home(&home);
    let before = write_raw_config(&home, MALFORMED);
    let res = save_window_state_as("mdpro-3f2a", a_window_state()).await;
    assert!(res.is_ok(), "expected Ok, got {res:?}");
    assert_eq!(read_config_bytes(&home), before);
    let _ = std::fs::remove_dir_all(&home);
}

// WI4-03: non-owner completes while preferences_rw_lock is held (no lock).
#[test]
fn wi4_03_non_owner_completes_while_preferences_lock_is_held() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi4_03");
    let _home_guard = set_home(&home);
    seed_rich(&home);
    let prefs_guard = crate::services::preferences::preferences_rw_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let res = rt.block_on(save_window_state_as("mdpro-3f2a", a_window_state()));
        let _ = tx.send(res);
    });
    let got = rx.recv_timeout(std::time::Duration::from_secs(2));
    drop(prefs_guard);
    handle.join().unwrap();
    assert!(
        matches!(got, Ok(Ok(()))),
        "non-owner must complete without the preferences lock, got {got:?}"
    );
    let _ = std::fs::remove_dir_all(&home);
}

// WI4-04: non-owner logs exactly Start + Success, one actionId, skip context,
// context keys ⊆ {field, outcome, reason}, no label.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi4_04_non_owner_logs_one_skip_pair_without_the_label() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi4_04");
    let _home_guard = set_home(&home);
    let _logger_guard = force_logger_on();
    let allowed = ["field", "outcome", "reason"];
    for label in ["mdpro-3f2a", ""] {
        seed_rich(&home);
        remove_log(&home);
        let res = save_window_state_as(label, a_window_state()).await;
        assert!(res.is_ok(), "label {label:?}: {res:?}");
        let recs = log_records(&home, EVENT);
        let statuses: Vec<&Value> = recs.iter().map(|r| &r["status"]).collect();
        assert_eq!(
            statuses,
            [&json!("start"), &json!("success")],
            "label {label:?}: {recs:?}"
        );
        let ids: std::collections::BTreeSet<String> =
            recs.iter().map(|r| r["actionId"].to_string()).collect();
        assert_eq!(
            ids.len(),
            1,
            "label {label:?}: one actionId expected: {recs:?}"
        );
        assert!(
            recs[0]["actionId"].is_string(),
            "actionId missing: {recs:?}"
        );
        assert_eq!(
            recs[1]["context"],
            json!({"field":"windowState","outcome":"skipped","reason":"not_main"}),
            "label {label:?}"
        );
        for r in &recs {
            if let Some(obj) = r["context"].as_object() {
                for k in obj.keys() {
                    assert!(
                        allowed.contains(&k.as_str()),
                        "label {label:?}: key {k:?} in {r}"
                    );
                }
            }
            if !label.is_empty() {
                assert!(!r.to_string().contains(label), "label leaked: {r}");
            }
        }
    }
    let _ = std::fs::remove_dir_all(&home);
}

// WI4-05 (control): "main" writes windowState, conserves the rest, logs no skip.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi4_05_main_writes_window_state_only_and_logs_no_skip() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi4_05");
    let _home_guard = set_home(&home);
    let _logger_guard = force_logger_on();
    remove_log(&home);
    let mut before: Value = serde_json::from_slice(&seed_rich(&home)).unwrap();
    let res = save_window_state_as("main", a_window_state()).await;
    assert!(res.is_ok(), "{res:?}");
    let mut after: Value = serde_json::from_slice(&read_config_bytes(&home)).unwrap();
    assert_eq!(
        after["windowState"],
        serde_json::to_value(a_window_state()).unwrap()
    );
    before.as_object_mut().unwrap().remove("windowState");
    after.as_object_mut().unwrap().remove("windowState");
    assert_eq!(after, before, "only windowState may change");
    let recs = log_records(&home, EVENT);
    let statuses: Vec<&Value> = recs.iter().map(|r| &r["status"]).collect();
    assert_eq!(statuses, [&json!("start"), &json!("success")], "{recs:?}");
    assert!(
        recs.iter()
            .all(|r| r["context"]["outcome"] != json!("skipped")),
        "{recs:?}"
    );
    assert!(
        recs.iter()
            .all(|r| !r.to_string().contains("\"outcome\":\"skipped\"")),
        "{recs:?}"
    );
    let _ = std::fs::remove_dir_all(&home);
}

// WI4-06: "main" with an unparseable config propagates ParseError, bytes kept.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi4_06_main_with_unparseable_config_propagates_parse_error() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi4_06");
    let _home_guard = set_home(&home);
    let before = write_raw_config(&home, MALFORMED);
    let res = save_window_state_as("main", a_window_state()).await;
    assert!(
        matches!(res, Err(PreferencesError::ParseError { .. })),
        "got {res:?}"
    );
    assert_eq!(read_config_bytes(&home), before);
    let _ = std::fs::remove_dir_all(&home);
}

// WI4-07: owns_global_window_state is exact equality; the const is "main".
#[test]
fn wi4_07_owner_predicate_is_exact_equality() {
    for label in NON_OWNERS {
        assert!(
            !owns_global_window_state(label),
            "label {label:?} must not own"
        );
    }
    assert!(owns_global_window_state("main"));
    assert_eq!(GLOBAL_WINDOW_STATE_OWNER, "main");
}
