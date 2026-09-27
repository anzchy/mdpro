//! 5B WI-1 (cases R1, R2, R3 of `.claude/tdd-guardian/tests-20260927-031000.md`)
//! — the `preferences.set` and `preferences.window_state.save` Fail records
//! carry only the `PreferencesError` variant name, never its message.
//!
//! **Law**: *kind-only failure record.* For every load failure of either
//! writer, the Fail record's `error` is exactly `"ParseError"` or `"IoError"`,
//! and no substring of the variant's `message` (serde position text, OS error
//! text, the home path) appears anywhere in `mdpro.log`. Precedent:
//! `DraftError::kind()` in `draft_log_redaction_failure_tests.rs`.
//!
//! Nothing is mocked: real `$HOME`, real `config.json`, real serde, real
//! logger. The `HOME_LOCK` / `set_home` / `temp_home` / logger-restorer
//! harness is duplicated from `preferences_tests.rs` (private there), as
//! `draft_log_redaction_failure_tests.rs` does. The `Unreadable` kind is
//! `#[cfg(unix)]` and skips itself with a printed reason when running as root.

use super::*;
use crate::models::LogSettings;
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
        .join("mdpro_preferences_log_redaction_test")
        .join(format!("{label}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Restores the process-global logger settings on drop, so a panic cannot
/// leak a forced-on logger into later tests.
struct LoggerSettingsRestorer(LogSettings);
impl Drop for LoggerSettingsRestorer {
    fn drop(&mut self) {
        logger::set_log_settings(self.0.clone());
    }
}

/// Call after `set_home`. Forces Debug logging on: `should_log` falls back
/// closed when preferences fail to load, which is exactly the failure path.
fn force_logger_on() -> LoggerSettingsRestorer {
    let restorer = LoggerSettingsRestorer(logger::get_log_settings());
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    restorer
}

fn config_file(home: &Path) -> PathBuf {
    home.join(".mdpro").join("config.json")
}

fn log_file(home: &Path) -> PathBuf {
    home.join(".mdpro").join("mdpro.log")
}

fn seed_config(home: &Path, mutate: impl FnOnce(&mut Value)) {
    std::fs::create_dir_all(home.join(".mdpro")).unwrap();
    let mut v = serde_json::to_value(UserPreferences::default()).unwrap();
    mutate(&mut v);
    std::fs::write(config_file(home), serde_json::to_string(&v).unwrap()).unwrap();
}

#[derive(Clone, Copy, Debug)]
enum Kind {
    Unparseable,
    EnumInvalid,
    #[cfg(unix)]
    Unreadable,
}

fn kinds() -> Vec<Kind> {
    #[cfg(unix)]
    return vec![Kind::Unparseable, Kind::EnumInvalid, Kind::Unreadable];
    #[cfg(not(unix))]
    return vec![Kind::Unparseable, Kind::EnumInvalid];
}

/// The variant name the Fail record must carry for `kind`.
fn expected_error(kind: Kind) -> &'static str {
    match kind {
        Kind::Unparseable | Kind::EnumInvalid => "ParseError",
        #[cfg(unix)]
        Kind::Unreadable => "IoError",
    }
}

/// Seeds `config.json` for one failure kind and returns its bytes. `None`
/// means the kind cannot be staged here (`chmod 000` does not deny root) and
/// the row is skipped with a printed reason.
fn stage_kind(kind: Kind, home: &Path) -> Option<Vec<u8>> {
    match kind {
        Kind::Unparseable => {
            std::fs::create_dir_all(home.join(".mdpro")).unwrap();
            std::fs::write(config_file(home), "{ not valid json !! }").unwrap();
        }
        Kind::EnumInvalid => seed_config(home, |v| v["logging"]["level"] = "NOPE".into()),
        #[cfg(unix)]
        Kind::Unreadable => {
            seed_config(home, |_| {});
            let before = std::fs::read(config_file(home)).unwrap();
            set_mode(home, 0o000);
            if std::fs::read(config_file(home)).is_ok() {
                set_mode(home, 0o600);
                println!("R1/R3: skipping `Unreadable` — a 0o000 file is readable (root?)");
                return None;
            }
            return Some(before);
        }
    }
    Some(std::fs::read(config_file(home)).unwrap())
}

#[cfg(unix)]
fn set_mode(home: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(config_file(home), std::fs::Permissions::from_mode(mode)).unwrap();
}

fn unstage_kind(kind: Kind, home: &Path) {
    #[cfg(unix)]
    if matches!(kind, Kind::Unreadable) {
        set_mode(home, 0o600);
    }
    let _ = (kind, home);
}

fn records(home: &Path, event: &str) -> Vec<Value> {
    let raw = std::fs::read_to_string(log_file(home)).unwrap_or_default();
    raw.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["event"] == json!(event))
        .collect()
}

/// Exactly one `start` and one `terminal` record for `event`, sharing one
/// `actionId`. Returns the terminal record.
fn one_pair(home: &Path, event: &str, terminal: &str, row: &str) -> Value {
    let r = records(home, event);
    assert_eq!(r.len(), 2, "{row}: want start+{terminal}: {r:?}");
    assert_eq!(r[0]["status"], json!("start"), "{row}: {r:?}");
    assert_eq!(r[1]["status"], json!(terminal), "{row}: {r:?}");
    let id = r[0]["actionId"].as_str().expect("start has actionId");
    assert_eq!(r[1]["actionId"].as_str(), Some(id), "{row}: one actionId");
    r[1].clone()
}

/// No message text anywhere in the whole log file.
fn assert_log_redacted(home: &Path, row: &str) {
    let text = std::fs::read_to_string(log_file(home)).expect("mdpro.log must exist");
    let home_str = home.to_str().unwrap();
    for f in [
        "line 1",
        "column",
        "unknown variant",
        "Permission denied",
        "os error",
        "message",
        home_str,
    ] {
        assert!(!text.contains(f), "{row}: log has {f:?}:\n{text}");
    }
}

fn a_window_state() -> WindowState {
    WindowState {
        width: 1,
        height: 2,
        x: 3,
        y: 4,
        is_maximized: false,
    }
}

fn hide_sidebar() -> PartialPreferences {
    serde_json::from_value(json!({ "showSidebar": false })).unwrap()
}

/// Runs every failure kind against one writer and checks the Fail record.
/// Returns `(rows run, rows skipped)`; only `Unreadable` can skip.
async fn run_failure_rows(home: &Path, event: &str, window_state: bool) -> (usize, usize) {
    let (mut ran, mut skipped) = (0, 0);
    for kind in kinds() {
        let Some(before) = stage_kind(kind, home) else {
            skipped += 1;
            continue;
        };
        let _ = std::fs::remove_file(log_file(home));
        let res: Result<(), PreferencesError> = if window_state {
            crate::commands::window_state::save_window_state_as("main", a_window_state()).await
        } else {
            set_preferences(hide_sidebar()).await.map(|_| ())
        };
        unstage_kind(kind, home);
        let row = format!("{event} / {kind:?}");
        // Precondition (pinned by WI1-E): the native error kind surfaces.
        let got = match &res {
            Err(PreferencesError::ParseError { .. }) => "ParseError",
            Err(PreferencesError::IoError { .. }) => "IoError",
            Ok(()) => panic!("{row}: a failed load must surface as Err"),
        };
        assert_eq!(got, expected_error(kind), "{row}: precondition");
        let after = std::fs::read(config_file(home)).unwrap();
        assert_eq!(after, before, "{row}: config.json bytes changed");

        let fail = one_pair(home, event, "fail", &row);
        assert_eq!(fail["error"], json!(expected_error(kind)), "{row}");
        assert_log_redacted(home, &row);
        ran += 1;
    }
    (ran, skipped)
}

/// Three rows, or two with the printed root skip.
fn assert_row_count((ran, skipped): (usize, usize)) {
    assert!(skipped <= 1, "only `Unreadable` may skip: {skipped}");
    assert_eq!(ran + skipped, kinds().len(), "ran {ran}, skipped {skipped}");
}

#[tokio::test]
#[allow(clippy::await_holding_lock)] // HOME_LOCK guards the process-global $HOME.
async fn r1_set_preferences_fail_record_is_kind_only_for_every_failure_kind() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("r1_set_fail");
    let _home_guard = set_home(&home);
    let _logger = force_logger_on();

    assert_row_count(run_failure_rows(&home, "preferences.set", false).await);
    let _ = std::fs::remove_dir_all(&home);
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn r2_set_preferences_success_record_is_unchanged() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("r2_set_success");
    let _home_guard = set_home(&home);
    let _logger = force_logger_on();

    seed_config(&home, |_| {});
    let _ = std::fs::remove_file(log_file(&home));
    set_preferences(hide_sidebar()).await.expect("must save");

    let success = one_pair(&home, "preferences.set", "success", "R2");
    assert_eq!(success["error"], Value::Null, "R2: no error");
    assert_eq!(success["context"], Value::Null, "R2: no context");
    let _ = std::fs::remove_dir_all(&home);
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn r3_save_window_state_fail_record_is_kind_only_for_every_failure_kind() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("r3_window_state_fail");
    let _home_guard = set_home(&home);
    let _logger = force_logger_on();

    assert_row_count(run_failure_rows(&home, WINDOW_STATE_SAVE_EVENT, true).await);
    let _ = std::fs::remove_dir_all(&home);
}
