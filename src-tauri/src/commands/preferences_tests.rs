//! WI-1 (ADR-0031 step 1) — `set_preferences` and `save_window_state` must
//! never rewrite `~/.mdpro/config.json` from defaults.
//!
//! Cases WI1-A … WI1-G of `.claude/tdd-guardian/tests-20260923-152800.md`.
//!
//! **Law**: *failure atomicity + field conservation.* (a) If the pre-write load
//! fails, the on-disk bytes after the call are identical to the bytes before
//! it. (b) On success, for a patch naming field set `P`, the reloaded document
//! differs from the pre-call document **only** on `P`.
//!
//! Nothing is mocked: real `$HOME`, real `config.json`, real serde, real
//! command functions. Every case runs under `crate::HOME_LOCK` in its own temp
//! `$HOME`, so the developer's own `~/.mdpro/` is never touched.
//!
//! **Platform note**: WI1-E's third failure kind (an *unreadable* config, the
//! only one that reaches `PreferencesError::IoError`) is `#[cfg(unix)]`. On a
//! non-unix target the case still runs, over the first two kinds only — the
//! claim is narrower there, and this comment is the record of that, rather than
//! the domain silently shrinking. `chmod 000` also does not deny root, so the
//! kind skips itself with a printed reason when the file is still readable.

use super::*;
use crate::models::LogSettings;
use crate::HOME_LOCK;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Harness — the HOME_LOCK / HomeRestorer / temp_home triple, copied verbatim
// from commands/logging.rs:142-166 (its helpers are private to that module).
// ---------------------------------------------------------------------------

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

/// This module gets its own `mdpro_preferences_cmd_test` prefix so parallel
/// test binaries cannot collide on the same temp directory.
fn temp_home(label: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join("mdpro_preferences_cmd_test")
        .join(format!("{label}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Restores the process-global logger settings cache on drop, so an assertion
/// panic cannot leak a forced-on logger into every later test in this binary.
struct LoggerSettingsRestorer(LogSettings);
impl Drop for LoggerSettingsRestorer {
    fn drop(&mut self) {
        logger::set_log_settings(self.0.clone());
    }
}

/// Must be called *after* `set_home`, so initialising the cache reads the temp
/// config rather than materialising one in the developer's real `~/.mdpro/`.
fn capture_logger_settings() -> LoggerSettingsRestorer {
    LoggerSettingsRestorer(logger::get_log_settings())
}

fn config_file(home: &Path) -> PathBuf {
    home.join(".mdpro").join("config.json")
}

fn tmp_file(home: &Path) -> PathBuf {
    home.join(".mdpro").join("config.json.tmp")
}

/// The exact malformed string already used at `services/preferences.rs:369`.
const MALFORMED: &str = "{ not valid json !! }";

/// A complete, correctly-cased document built by round-tripping
/// `UserPreferences::default()` through serde, then mutated by `mutate`.
///
/// Built rather than hand-written so it stays complete automatically as fields
/// are added — a failure here can then only be about the code under test.
fn seed_config(home: &Path, mutate: impl FnOnce(&mut Value)) -> Vec<u8> {
    let dir = home.join(".mdpro");
    std::fs::create_dir_all(&dir).unwrap();
    let mut v = serde_json::to_value(UserPreferences::default()).unwrap();
    mutate(&mut v);
    let raw = serde_json::to_string(&v).unwrap();
    std::fs::write(dir.join("config.json"), &raw).unwrap();
    raw.into_bytes()
}

fn write_raw_config(home: &Path, raw: &str) -> Vec<u8> {
    let dir = home.join(".mdpro");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("config.json"), raw).unwrap();
    raw.as_bytes().to_vec()
}

fn read_config_bytes(home: &Path) -> Vec<u8> {
    std::fs::read(config_file(home)).expect("config.json must still exist")
}

fn read_config_value(home: &Path) -> Value {
    let raw = std::fs::read_to_string(config_file(home)).expect("config.json must exist");
    serde_json::from_str(&raw).expect("config.json must be valid JSON")
}

fn empty_partial() -> PartialPreferences {
    PartialPreferences {
        theme_mode: None,
        auto_save_interval: None,
        default_view_mode: None,
        last_view_mode: None,
        show_sidebar: None,
        enable_scroll_sync: None,
        recent_files: None,
        window_state: None,
        keyboard_shortcuts: None,
        window_states: None,
        logging: None,
        auto_save: None,
        tab_bar: None,
        image: None,
        mcp: None,
        editor: None,
        markdown: None,
        appearance: None,
        export: None,
    }
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

// ---------------------------------------------------------------------------
// WI1-A — corrupt config: `set_preferences` errors and does not touch the bytes
// ---------------------------------------------------------------------------

/// Level 2 (a typed `Err`) + Level 1 (byte equality on the real file).
///
/// `ParseError`, not `IoError`: `load_preferences` maps a serde failure at
/// `services/preferences.rs:74`; only `read_to_string` (`:70`) and a missing
/// home dir (`:52`) are `IoError`. The plan's acceptance line originally said
/// `IoError` and was corrected — the native error is propagated with `?`, never
/// re-wrapped to make a label true.
#[tokio::test]
// HOME_LOCK guards the process-global $HOME env var, so it cannot be released before the await.
#[allow(clippy::await_holding_lock)]
async fn wi1_a_corrupt_config_makes_set_preferences_err_without_touching_the_bytes() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi1a_corrupt_set");
    let _home_guard = set_home(&home);

    let before = write_raw_config(&home, MALFORMED);

    let res = set_preferences(PartialPreferences {
        show_sidebar: Some(false),
        ..empty_partial()
    })
    .await;

    assert!(
        matches!(res, Err(PreferencesError::ParseError { .. })),
        "an unparseable config.json must surface as ParseError, got: {res:?}"
    );
    assert_eq!(
        read_config_bytes(&home),
        before,
        "a failed pre-write load must leave config.json byte-identical"
    );
    assert!(
        !tmp_file(&home).exists(),
        "no config.json.tmp may be left behind"
    );

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI1-B — corrupt config: `save_window_state` errors and does not touch bytes
// ---------------------------------------------------------------------------

/// The second command is a separate code path; WI1-A does not cover it.
///
/// This case is also the named real-path pairing for WI3-K: it proves the
/// rejection that the WI-3 unit test fakes is a real production outcome.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi1_b_corrupt_config_makes_save_window_state_err_without_touching_the_bytes() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi1b_corrupt_window");
    let _home_guard = set_home(&home);

    let before = write_raw_config(&home, MALFORMED);

    let res = save_window_state(WindowState {
        width: 640,
        height: 480,
        x: 5,
        y: 5,
        is_maximized: false,
    })
    .await;

    assert!(
        matches!(res, Err(PreferencesError::ParseError { .. })),
        "an unparseable config.json must surface as ParseError, got: {res:?}"
    );
    assert_eq!(
        read_config_bytes(&home),
        before,
        "a failed pre-write load must leave config.json byte-identical"
    );
    assert!(
        !tmp_file(&home).exists(),
        "no config.json.tmp may be left behind"
    );

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI1-C — readable config: one field patched, its neighbours conserved
// ---------------------------------------------------------------------------

/// Asserted on a **fresh** `load_preferences()`, not on the returned value: a
/// command that computed correctly and then failed to persist would pass a
/// return-value assertion. `autoSaveInterval == 111` and
/// `markdown.autoPair == false` are the witnesses that make WI1-A/B
/// non-vacuous — a body hardcoding `Ok(UserPreferences::default())` fails here.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi1_c_set_preferences_patches_one_field_and_conserves_its_neighbours() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi1c_patch_one");
    let _home_guard = set_home(&home);

    seed_config(&home, |v| {
        v["autoSaveInterval"] = serde_json::json!(111);
        v["markdown"]["autoPair"] = serde_json::json!(false);
    });

    let returned = set_preferences(PartialPreferences {
        show_sidebar: Some(false),
        ..empty_partial()
    })
    .await
    .expect("a readable config must let set_preferences succeed");
    assert!(
        !returned.show_sidebar,
        "the patched value must be the one handed back"
    );

    let reread = load_preferences().expect("config.json must reload after the write");
    assert!(
        !reread.show_sidebar,
        "the patch must be persisted, not merely returned"
    );
    assert_eq!(
        reread.auto_save_interval, 111,
        "an unrelated preference must survive the patch (no defaults clobber)"
    );
    assert!(
        !reread.markdown.auto_pair,
        "a nested unrelated preference must survive the patch"
    );

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI1-D — readable config: `save_window_state` replaces only `windowState`
// ---------------------------------------------------------------------------

/// `is_maximized == true` here is the real-path pairing for WI3-L, which
/// observes the same flag on a mocked outbound payload.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi1_d_save_window_state_replaces_only_the_window_state_field() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi1d_window_only");
    let _home_guard = set_home(&home);

    seed_config(&home, |v| {
        v["autoSaveInterval"] = serde_json::json!(77);
        v["recentFiles"] = serde_json::json!(["/tmp/keep-me.md"]);
    });

    save_window_state(a_window_state())
        .await
        .expect("a readable config must let save_window_state succeed");

    let reread = load_preferences().expect("config.json must reload after the write");
    assert_eq!(
        reread.window_state.width, 640,
        "the new window width must be persisted"
    );
    assert!(
        reread.window_state.is_maximized,
        "the new isMaximized flag must be persisted"
    );
    assert_eq!(
        reread.auto_save_interval, 77,
        "an unrelated preference must survive the window-state write"
    );
    assert_eq!(
        reread.recent_files,
        vec!["/tmp/keep-me.md".to_string()],
        "recentFiles must survive the window-state write"
    );

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI1-E — Law (S5): all-or-nothing across the failure class, both commands
// ---------------------------------------------------------------------------

/// The three failure kinds of WI1-E. `Unreadable` is the only one reaching
/// `PreferencesError::IoError`; without it an implementation reading
/// `Err(ParseError) => propagate, Err(_) => default` satisfies every other
/// WI-1 case while leaving the defect fully alive.
#[derive(Clone, Copy, Debug)]
enum FailureKind {
    Unparseable,
    EnumInvalid,
    #[cfg(unix)]
    Unreadable,
}

/// Seeds `config.json` for one failure kind.
///
/// Returns `None` when the kind cannot be staged on this machine — `chmod 000`
/// does not deny root — so the case skips with a printed reason instead of
/// asserting vacuously.
fn stage_failure(home: &Path, kind: FailureKind) -> Option<Vec<u8>> {
    match kind {
        FailureKind::Unparseable => Some(write_raw_config(home, MALFORMED)),
        FailureKind::EnumInvalid => Some(seed_config(home, |v| {
            // Well-formed JSON that fails in serde's struct visitor.
            v["logging"]["level"] = serde_json::json!("NOPE");
        })),
        #[cfg(unix)]
        FailureKind::Unreadable => {
            use std::os::unix::fs::PermissionsExt;
            let before = seed_config(home, |_| {});
            std::fs::set_permissions(config_file(home), std::fs::Permissions::from_mode(0o000))
                .unwrap();
            if std::fs::read(config_file(home)).is_ok() {
                // Running as root: restore and skip rather than assert nothing.
                std::fs::set_permissions(config_file(home), std::fs::Permissions::from_mode(0o600))
                    .unwrap();
                println!(
                    "WI1-E: skipping the `unreadable` kind — this process can read a 0o000 file (running as root?)"
                );
                return None;
            }
            Some(before)
        }
    }
}

/// Restores readability so the assertions and the cleanup can proceed, exactly
/// as `save_failure_preserves_existing_config_and_leaves_no_tmp`
/// (`services/preferences.rs:487-520`) does.
fn unstage_failure(home: &Path, kind: FailureKind) {
    #[cfg(unix)]
    if matches!(kind, FailureKind::Unreadable) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(config_file(home), std::fs::Permissions::from_mode(0o600))
            .unwrap();
    }
    let _ = kind;
    let _ = home;
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi1_e_a_failed_load_is_all_or_nothing_for_both_commands() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi1e_all_or_nothing");
    let _home_guard = set_home(&home);

    // The domain is narrower on a non-unix target — the `unreadable` kind is the
    // only one that reaches `IoError`, and it needs `PermissionsExt`.
    #[cfg(unix)]
    let kinds = vec![
        FailureKind::Unparseable,
        FailureKind::EnumInvalid,
        FailureKind::Unreadable,
    ];
    #[cfg(not(unix))]
    let kinds = vec![FailureKind::Unparseable, FailureKind::EnumInvalid];

    for kind in kinds {
        for cmd in ["set_preferences", "save_window_state"] {
            let Some(before) = stage_failure(&home, kind) else {
                continue;
            };

            let described: String = match cmd {
                "set_preferences" => {
                    let res = set_preferences(PartialPreferences {
                        show_sidebar: Some(false),
                        ..empty_partial()
                    })
                    .await;
                    unstage_failure(&home, kind);
                    assert!(
                        matches!(
                            res,
                            Err(PreferencesError::ParseError { .. })
                                | Err(PreferencesError::IoError { .. })
                        ),
                        "{cmd} / {kind:?}: a failed load must surface as Err, got: {res:?}"
                    );
                    match kind {
                        FailureKind::Unparseable | FailureKind::EnumInvalid => assert!(
                            matches!(res, Err(PreferencesError::ParseError { .. })),
                            "{cmd} / {kind:?}: a serde failure must be ParseError, got: {res:?}"
                        ),
                        #[cfg(unix)]
                        FailureKind::Unreadable => assert!(
                            matches!(res, Err(PreferencesError::IoError { .. })),
                            "{cmd} / {kind:?}: an unreadable file must be IoError, got: {res:?}"
                        ),
                    }
                    format!("{res:?}")
                }
                _ => {
                    let res = save_window_state(a_window_state()).await;
                    unstage_failure(&home, kind);
                    assert!(
                        matches!(
                            res,
                            Err(PreferencesError::ParseError { .. })
                                | Err(PreferencesError::IoError { .. })
                        ),
                        "{cmd} / {kind:?}: a failed load must surface as Err, got: {res:?}"
                    );
                    match kind {
                        FailureKind::Unparseable | FailureKind::EnumInvalid => assert!(
                            matches!(res, Err(PreferencesError::ParseError { .. })),
                            "{cmd} / {kind:?}: a serde failure must be ParseError, got: {res:?}"
                        ),
                        #[cfg(unix)]
                        FailureKind::Unreadable => assert!(
                            matches!(res, Err(PreferencesError::IoError { .. })),
                            "{cmd} / {kind:?}: an unreadable file must be IoError, got: {res:?}"
                        ),
                    }
                    format!("{res:?}")
                }
            };

            assert_eq!(
                read_config_bytes(&home),
                before,
                "{cmd} / {kind:?}: config.json was rewritten after a failed load ({described})"
            );
            assert!(
                !tmp_file(&home).exists(),
                "{cmd} / {kind:?}: a config.json.tmp was left behind"
            );
        }
    }

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI1-F — `save_window_state` emits a Start + terminal log pair (rule 20)
// ---------------------------------------------------------------------------

fn log_records(home: &Path, event: &str) -> Vec<Value> {
    let raw = std::fs::read_to_string(home.join(".mdpro").join("mdpro.log")).unwrap_or_default();
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["event"] == serde_json::json!(event))
        .collect()
}

/// The shared `actionId` is the load-bearing part: it proves one pair, not two
/// unrelated records.
///
/// `logger::set_log_settings` is forced on for the whole body because
/// `should_log` reads a process-global cache that falls back **closed** when
/// preferences fail to load — i.e. precisely in the failure run below. Restored
/// through a `Drop` guard so a panic cannot disable the logger for every later
/// test in this binary.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi1_f_save_window_state_logs_a_start_and_terminal_pair() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi1f_logging");
    let _home_guard = set_home(&home);
    let _logger_guard = capture_logger_settings();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });

    const EVENT: &str = "preferences.window_state.save";
    let log = home.join(".mdpro").join("mdpro.log");

    // Run 1 — the failure path.
    write_raw_config(&home, MALFORMED);
    let _ = std::fs::remove_file(&log);
    let res = save_window_state(a_window_state()).await;
    assert!(res.is_err(), "run 1 must fail, got: {res:?}");

    let records = log_records(&home, EVENT);
    assert_eq!(
        records.len(),
        2,
        "the failure path must emit exactly a Start and a terminal record, got: {records:?}"
    );
    assert_eq!(
        records
            .iter()
            .filter(|r| r["status"] == serde_json::json!("start"))
            .count(),
        1,
        "exactly one start record"
    );
    assert_eq!(
        records
            .iter()
            .filter(|r| r["status"] == serde_json::json!("fail"))
            .count(),
        1,
        "exactly one fail record — a Start with no terminal record is the defect rule 20 exists to prevent"
    );
    let ids: BTreeSet<String> = records
        .iter()
        .map(|r| r["actionId"].as_str().unwrap_or("<missing>").to_string())
        .collect();
    assert_eq!(
        ids.len(),
        1,
        "the pair must share one actionId, got: {ids:?}"
    );
    assert!(
        !ids.contains("<missing>"),
        "both records must carry an actionId"
    );

    // Run 2 — the success path.
    seed_config(&home, |_| {});
    let _ = std::fs::remove_file(&log);
    save_window_state(a_window_state())
        .await
        .expect("run 2 must succeed");

    let records = log_records(&home, EVENT);
    assert_eq!(
        records.len(),
        2,
        "the success path must emit exactly a Start and a terminal record, got: {records:?}"
    );
    assert_eq!(
        records
            .iter()
            .filter(|r| r["status"] == serde_json::json!("success"))
            .count(),
        1,
        "exactly one success record"
    );
    let ids: BTreeSet<String> = records
        .iter()
        .map(|r| r["actionId"].as_str().unwrap_or("<missing>").to_string())
        .collect();
    assert_eq!(
        ids.len(),
        1,
        "the success pair must share one actionId, got: {ids:?}"
    );

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI1-G — Law (S4): whole-document conservation, by dotted-path diff
// ---------------------------------------------------------------------------

/// Collects the dotted paths whose leaf differs between two documents.
///
/// Descends into objects; `recentFiles` (an array) and each `windowStates`
/// entry value are compared whole, as single leaves.
fn diff_paths(prefix: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
    let both_objects = a.is_object() && b.is_object();
    if both_objects && prefix != "windowStates" {
        let (ao, bo) = (a.as_object().unwrap(), b.as_object().unwrap());
        let keys: BTreeSet<&String> = ao.keys().chain(bo.keys()).collect();
        for k in keys {
            let child = if prefix.is_empty() {
                k.clone()
            } else {
                format!("{prefix}.{k}")
            };
            diff_paths(
                &child,
                ao.get(k).unwrap_or(&Value::Null),
                bo.get(k).unwrap_or(&Value::Null),
                out,
            );
        }
    } else if a != b {
        out.push(prefix.to_string());
    }
}

fn changed_paths(before: &Value, after: &Value) -> Vec<String> {
    let mut out = Vec::new();
    diff_paths("", before, after, &mut out);
    out.sort();
    out
}

/// A deliberately non-default whole document: every nesting level the named
/// witnesses of WI1-C and WI1-D left unobserved carries a value no defaults
/// fallback can reproduce.
fn seed_rich_document(home: &Path) -> Value {
    seed_config(home, |v| {
        v["autoSaveInterval"] = serde_json::json!(111);
        v["markdown"]["autoPair"] = serde_json::json!(false);
        v["recentFiles"] = serde_json::json!(["/tmp/keep-me.md"]);
        v["windowStates"] = serde_json::json!({
            "/tmp/keep-me.md": { "x": 10, "y": 20, "width": 800, "height": 600, "lastAccessed": 1234 }
        });
        v["keyboardShortcuts"]["fileNew"] = serde_json::json!("Cmd+Shift+N");
        v["logging"]["level"] = serde_json::json!("debug");
        v["editor"]["fontSize"] = serde_json::json!(18);
        v["appearance"]["codeTheme"] = serde_json::json!("oneDark");
    });
    read_config_value(home)
}

/// Run 3 is the sequence one window close actually performs
/// (`useWindowCloseGuard.ts:67` then `:81`): two independent load-modify-save
/// cycles against the same file. Nothing else asserts that the second cycle
/// observes the first cycle's result rather than a stale snapshot.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi1_g_only_the_patched_paths_change_anywhere_in_the_document() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi1g_conservation");
    let _home_guard = set_home(&home);

    let window_paths = [
        "windowState.height",
        "windowState.isMaximized",
        "windowState.width",
        "windowState.x",
        "windowState.y",
    ];

    // Run 1 — set_preferences alone.
    let before = seed_rich_document(&home);
    set_preferences(PartialPreferences {
        show_sidebar: Some(false),
        ..empty_partial()
    })
    .await
    .expect("run 1 must succeed");
    let changed = changed_paths(&before, &read_config_value(&home));
    assert_eq!(
        changed,
        vec!["showSidebar".to_string()],
        "set_preferences: also rewrote {changed:?}"
    );

    // Run 2 — save_window_state alone.
    let before = seed_rich_document(&home);
    save_window_state(a_window_state())
        .await
        .expect("run 2 must succeed");
    let changed = changed_paths(&before, &read_config_value(&home));
    assert_eq!(
        changed,
        window_paths
            .iter()
            .map(|p| p.to_string())
            .collect::<Vec<_>>(),
        "save_window_state: also rewrote {changed:?}"
    );

    // Run 3 — both, back to back, on one seed.
    let before = seed_rich_document(&home);
    set_preferences(PartialPreferences {
        show_sidebar: Some(false),
        ..empty_partial()
    })
    .await
    .expect("run 3 cycle 1 must succeed");
    save_window_state(a_window_state())
        .await
        .expect("run 3 cycle 2 must succeed");
    let changed = changed_paths(&before, &read_config_value(&home));
    let mut expected: Vec<String> = window_paths.iter().map(|p| p.to_string()).collect();
    expected.push("showSidebar".to_string());
    expected.sort();
    assert_eq!(
        changed, expected,
        "the second load-modify-save cycle must preserve the first cycle's write; got {changed:?}"
    );

    let _ = std::fs::remove_dir_all(&home);
}
