//! M1a WI-2: the loader's write-back under a non-empty test plan (cases M6,
//! M7, M8, M10, M12, M14, M16, M17 and M17-log of
//! `.claude/tdd-guardian/tests-20261016-202016.md`).
//!
//! **Law:** a write-back happens at most once per change, under the caller's
//! guard; a failed write keeps the migrated result in memory and the next load
//! retries; the `preferences.shortcuts.migrate` line is logged whenever a
//! write-back is attempted and carries only
//! `{fromVersion, toVersion, changedCount, outcome}`.
//!
//! Real `config.json` under [`TestHome`], real permissions, real logger. No
//! assertion runs while the global guard is held.

use super::tests::TEST_PLAN;
use super::*;
use crate::models::{LogLevel, LogSettings};
use crate::services::logger;
use crate::services::mcp_controller::test_support::GENEROUS;
use crate::services::preferences::load_preferences_locked_with;
use crate::services::prefs_guard::PrefsGuard;
use crate::services::window_restore::test_home::{
    config_file, config_mtime, read_config_bytes, seed_config, TestHome,
};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::{mpsc, Arc, Barrier};

const MIGRATE_EVENT: &str = "preferences.shortcuts.migrate";

type Loaded = Result<(UserPreferences, MigrationOutcome), String>;

/// Loads with `plan` under a fresh guard and drops it before returning.
fn load_with(plan: &MigrationPlan) -> Loaded {
    let g = PrefsGuard::acquire().map_err(|e| format!("{e:?}"))?;
    let r = load_preferences_locked_with(&g, plan).map_err(|e| format!("{e:?}"));
    drop(g);
    r
}

fn on_disk(h: &TestHome) -> Value {
    serde_json::from_slice(&read_config_bytes(&h.dir)).expect("config.json is JSON")
}

/// M6's seed: version absent, `fileSave` at its v1 default, `fileOpen` custom.
fn seed_m6(h: &TestHome) -> Vec<u8> {
    seed_config(&h.dir, |v| {
        v.as_object_mut()
            .expect("object")
            .remove("keyboardShortcutsVersion");
        v["keyboardShortcuts"]["fileSave"] = json!("Cmd+S");
        v["keyboardShortcuts"]["fileOpen"] = json!("Cmd+Alt+O");
        v["autoSaveInterval"] = json!(111);
    })
}

fn summary(p: &UserPreferences) -> (String, String, u32) {
    let k = &p.keyboard_shortcuts;
    (
        k.file_save.clone(),
        k.file_open.clone(),
        p.keyboard_shortcuts_version,
    )
}

fn migrated_summary() -> (String, String, u32) {
    ("Cmd+Alt+Shift+S".into(), "Cmd+Alt+O".into(), 2)
}

fn assert_migrated_on_disk(h: &TestHome) {
    let v = on_disk(h);
    assert_eq!(v["keyboardShortcuts"]["fileSave"], json!("Cmd+Alt+Shift+S"));
    assert_eq!(v["keyboardShortcuts"]["fileOpen"], json!("Cmd+Alt+O"));
    assert_eq!(v["keyboardShortcutsVersion"], json!(2));
    assert_eq!(v["autoSaveInterval"], json!(111));
}

/// Restores the process-wide log settings on drop.
struct LoggerSettingsRestorer(LogSettings);
impl Drop for LoggerSettingsRestorer {
    fn drop(&mut self) {
        logger::set_log_settings(self.0.clone());
    }
}

fn logger_on(h: &TestHome) -> LoggerSettingsRestorer {
    let restore = LoggerSettingsRestorer(logger::get_log_settings());
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    let _ = std::fs::remove_file(h.dir.join(".mdpro").join("mdpro.log"));
    restore
}

fn log_records(home: &Path, event: &str) -> Vec<Value> {
    let raw = std::fs::read_to_string(home.join(".mdpro").join("mdpro.log")).unwrap_or_default();
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["event"] == json!(event))
        .collect()
}

/// M14: the record's context is exactly the four keys, with no chord or path.
fn assert_migrate_record(rec: &Value, h: &TestHome, changed: u64, outcome: &str, status: &str) {
    assert_eq!(
        rec["context"],
        json!({ "fromVersion": 1, "toVersion": 2, "changedCount": changed, "outcome": outcome }),
        "record: {rec}"
    );
    assert_eq!(rec["status"], json!(status), "record: {rec}");
    let text = rec.to_string();
    assert!(!text.contains("Cmd+"), "a chord leaked: {text}");
    assert!(!text.contains('<'), "a sentinel leaked: {text}");
    let dir = h.dir.to_str().expect("utf-8 temp dir");
    assert!(!text.contains(dir), "the home path leaked: {text}");
}

#[test]
fn m6_m7_write_back_once_then_a_second_load_is_a_no_op() {
    let h = TestHome::new("m6_write_back");
    seed_m6(&h);

    let first = load_with(&TEST_PLAN);
    let bytes_after_first = read_config_bytes(&h.dir);
    let mtime_after_first = config_mtime(&h.dir);
    let second = load_with(&TEST_PLAN);

    let (p1, o1) = first.expect("first load");
    assert_eq!(o1, MigrationOutcome::Migrated { changed_count: 1 });
    assert_eq!(summary(&p1), migrated_summary());
    assert_migrated_on_disk(&h);

    let (p2, o2) = second.expect("second load");
    assert_eq!(o2, MigrationOutcome::Unchanged);
    assert_eq!(summary(&p2), migrated_summary());
    assert_eq!(
        read_config_bytes(&h.dir),
        bytes_after_first,
        "M7 rewrote the file"
    );
    assert_eq!(
        config_mtime(&h.dir),
        mtime_after_first,
        "M7 touched the file"
    );
}

#[cfg(unix)]
#[test]
fn m8_a_failed_write_keeps_the_result_and_the_next_load_retries() {
    use std::os::unix::fs::PermissionsExt;
    let h = TestHome::new("m8_write_failed");
    let v1_bytes = seed_m6(&h);
    let _restore = logger_on(&h);
    let dir = h.dir.join(".mdpro");
    // The log file exists before the chmod, so the Fail line can still append.
    std::fs::write(dir.join("mdpro.log"), "").expect("create log");
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).expect("chmod");
    let probe = dir.join("probe");
    if std::fs::write(&probe, "x").is_ok() {
        let _ = std::fs::remove_file(&probe);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("chmod");
        eprintln!(
            "SKIPPED m8_a_failed_write_keeps_the_result_and_the_next_load_retries: {} is still \
             writable at mode 0o500 (running as root?). The failed write-back is UNVERIFIED.",
            dir.display()
        );
        return;
    }

    let first = load_with(&TEST_PLAN);
    let bytes_while_read_only = read_config_bytes(&h.dir);
    let tmp_left = dir.join("config.json.tmp").exists();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("chmod");
    let second = load_with(&TEST_PLAN);
    let records = log_records(&h.dir, MIGRATE_EVENT);

    let (p1, o1) = first.expect("a failed write-back still loads");
    assert_eq!(o1, MigrationOutcome::WriteFailed { changed_count: 1 });
    assert_eq!(summary(&p1), migrated_summary());
    assert_eq!(bytes_while_read_only, v1_bytes, "the v1 bytes must survive");
    assert!(!tmp_left, "a failed write-back left config.json.tmp");

    let (p2, o2) = second.expect("retry");
    assert_eq!(o2, MigrationOutcome::Migrated { changed_count: 1 });
    assert_eq!(summary(&p2), migrated_summary());
    assert_migrated_on_disk(&h);

    assert_eq!(records.len(), 2, "records: {records:?}");
    assert_migrate_record(&records[0], &h, 1, "writeFailed", "fail");
    assert_migrate_record(&records[1], &h, 1, "migrated", "success");
}

#[test]
fn m10_concurrent_loads_migrate_once() {
    let h = TestHome::new("m10_concurrent");
    seed_m6(&h);
    let barrier = Arc::new(Barrier::new(8));
    let (tx, rx) = mpsc::channel();
    for _ in 0..8 {
        let barrier = Arc::clone(&barrier);
        let tx = tx.clone();
        std::thread::spawn(move || {
            barrier.wait();
            let r = load_with(&TEST_PLAN).map(|(p, o)| (o, summary(&p)));
            let _ = tx.send(r);
        });
    }
    let results: Vec<_> = (0..8).map(|_| rx.recv_timeout(GENEROUS)).collect();

    let mut migrated = 0;
    let mut unchanged = 0;
    for r in results {
        let (outcome, values) = r.expect("a loader hung").expect("a load failed");
        assert_eq!(values, migrated_summary());
        match outcome {
            MigrationOutcome::Migrated { changed_count: 1 } => migrated += 1,
            MigrationOutcome::Unchanged => unchanged += 1,
            other => panic!("unexpected outcome {other:?}"),
        }
    }
    assert_eq!((migrated, unchanged), (1, 7));
    assert_migrated_on_disk(&h);
}

#[test]
fn m12_m14_a_migrating_write_and_its_log_line_inside_a_held_guard() {
    let h = TestHome::new("m12_held_guard");
    seed_m6(&h);
    let _restore = logger_on(&h);
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let r = load_with(&TEST_PLAN).map(|(p, o)| (o, summary(&p)));
        let _ = tx.send(r);
    });
    let got = rx.recv_timeout(GENEROUS);
    let records = log_records(&h.dir, MIGRATE_EVENT);

    let (outcome, values) = got.expect("the migrating load hung").expect("load");
    assert_eq!(outcome, MigrationOutcome::Migrated { changed_count: 1 });
    assert_eq!(values, migrated_summary());
    assert_migrated_on_disk(&h);
    assert_eq!(records.len(), 1, "records: {records:?}");
    assert_migrate_record(&records[0], &h, 1, "migrated", "success");
}

#[test]
fn m16_the_loader_repairs_empty_before_it_migrates() {
    let h = TestHome::new("m16_repair_first");
    seed_config(&h.dir, |v| {
        v.as_object_mut()
            .expect("object")
            .remove("keyboardShortcutsVersion");
        v["keyboardShortcuts"]["fileSave"] = json!("");
    });
    let (p, outcome) = load_with(&TEST_PLAN).expect("load");
    assert_eq!(p.keyboard_shortcuts.file_save, "Cmd+Alt+Shift+S");
    assert_eq!(p.keyboard_shortcuts_version, 2);
    assert!(
        matches!(outcome, MigrationOutcome::Migrated { .. }),
        "{outcome:?}"
    );
}

#[test]
fn m17_the_stamp_alone_is_written_back_and_logged_once() {
    let h = TestHome::new("m17_stamp_only");
    seed_config(&h.dir, |v| {
        v.as_object_mut()
            .expect("object")
            .remove("keyboardShortcutsVersion");
        v["keyboardShortcuts"]["fileSave"] = json!("Cmd+Alt+1");
        v["keyboardShortcuts"]["fileOpen"] = json!("Cmd+Alt+2");
    });
    let _restore = logger_on(&h);

    let first = load_with(&TEST_PLAN);
    let bytes = read_config_bytes(&h.dir);
    let mtime = config_mtime(&h.dir);
    let second = load_with(&TEST_PLAN);
    let records = log_records(&h.dir, MIGRATE_EVENT);

    let (p1, o1) = first.expect("load");
    assert_eq!(o1, MigrationOutcome::Migrated { changed_count: 0 });
    assert_eq!(p1.keyboard_shortcuts_version, 2);
    let v: Value = serde_json::from_slice(&bytes).expect("json");
    assert_eq!(v["keyboardShortcutsVersion"], json!(2));
    assert_eq!(v["keyboardShortcuts"]["fileSave"], json!("Cmd+Alt+1"));
    assert_eq!(v["keyboardShortcuts"]["fileOpen"], json!("Cmd+Alt+2"));

    let (_, o2) = second.expect("second load");
    assert_eq!(o2, MigrationOutcome::Unchanged);
    assert_eq!(read_config_bytes(&h.dir), bytes);
    assert_eq!(config_mtime(&h.dir), mtime);
    assert!(config_file(&h.dir).exists());

    assert_eq!(records.len(), 1, "records: {records:?}");
    assert_migrate_record(&records[0], &h, 0, "migrated", "success");
}
