//! M1a WI-4: `snapshot_at_startup`, `AppliedShortcutsState` and the
//! `get_applied_shortcuts` delegate (cases A4, A5, A6, A9 and A10 of
//! `.claude/tdd-guardian/tests-20261016-202016.md`).
//!
//! **Law (S5):** the snapshot is fixed for the run. No write after
//! construction changes what the state returns, and construction never
//! writes to a file that exists.
//!
//! Real `config.json` under [`TestHome`], real `set_preferences`, real logger.

use super::*;
use crate::commands::preferences::set_preferences;
use crate::commands::shortcuts::get_applied_shortcuts_inner;
use crate::models::{LogLevel, LogSettings, UserPreferences, CURRENT_KEYBOARD_SHORTCUTS_VERSION};
use crate::services::logger;
use crate::services::preferences::PartialPreferences;
use crate::services::window_restore::test_home::{
    config_file, config_mtime, read_config_bytes, seed_config, write_raw_config, TestHome,
};
use serde_json::{json, Value};
use std::path::Path;

const RESOLVE_EVENT: &str = "preferences.shortcuts.applied.resolve";
const GET_EVENT: &str = "preferences.shortcuts.applied.get";

fn block_on<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("current-thread runtime")
        .block_on(f)
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

fn with_status(records: &[Value], status: &str) -> Vec<Value> {
    records
        .iter()
        .filter(|r| r["status"] == json!(status))
        .cloned()
        .collect()
}

/// A1's bindings, built from the contract fixture rather than the code.
fn default_bindings() -> Value {
    let layout = crate::menu_layout::menu_layout().expect("committed layout");
    let mut bindings = serde_json::Map::new();
    for row in &layout.rows {
        let Some(field) = &row.pref_field else {
            continue;
        };
        let key = if cfg!(target_os = "macos") {
            &row.key.macos
        } else if cfg!(target_os = "windows") {
            &row.key.windows
        } else {
            &row.key.linux
        };
        let value = match key.defaults.v2.as_deref().expect("v2 default") {
            "<unassigned>" => json!({"state":"unassigned"}),
            "<system>" => json!({"state":"system"}),
            chord => json!({"state":"bound","chord":chord}),
        };
        bindings.insert(field.clone(), value);
    }
    Value::Object(bindings)
}

fn as_value(s: &AppliedShortcuts) -> Value {
    serde_json::to_value(s).expect("snapshot serialize")
}

fn assert_no_leak(records: &[Value], h: &TestHome) {
    let dir = h.dir.to_str().expect("utf-8 temp dir");
    for rec in records {
        let text = rec.to_string();
        assert!(!text.contains("Cmd+"), "a chord leaked: {text}");
        assert!(!text.contains("<unassigned>"), "a sentinel leaked: {text}");
        assert!(!text.contains(dir), "the home path leaked: {text}");
    }
}

#[test]
fn a4_a_settings_save_does_not_change_the_snapshot() {
    let h = TestHome::new("a4_snapshot_fixed");
    seed_config(&h.dir, |v| {
        v["keyboardShortcuts"]["fileSave"] = json!("Cmd+Alt+S");
    });
    let st = AppliedShortcutsState::new(snapshot_at_startup());
    let before = as_value(&get_applied_shortcuts_inner(&st).expect("first read"));

    let mut group = serde_json::to_value(KeyboardShortcuts::default()).expect("group");
    group["fileSave"] = json!("Cmd+Shift+K");
    let partial: PartialPreferences =
        serde_json::from_value(json!({ "keyboardShortcuts": group })).expect("partial");
    block_on(set_preferences(partial)).expect("set_preferences");
    let disk: Value = serde_json::from_slice(&read_config_bytes(&h.dir)).expect("disk JSON");
    let after = as_value(&get_applied_shortcuts_inner(&st).expect("second read"));

    assert_eq!(disk["keyboardShortcuts"]["fileSave"], json!("Cmd+Shift+K"));
    assert_eq!(
        after["bindings"]["fileSave"],
        json!({ "state": "bound", "chord": "Cmd+Alt+S" })
    );
    assert_eq!(after, before);
}

#[test]
fn m1b_yielded_default_notifies_only_the_upgrade_run() {
    let h = TestHome::new("m1b_yielded_default_notice");
    seed_config(&h.dir, |v| {
        v["keyboardShortcutsVersion"] = json!(1);
        v["keyboardShortcuts"]["fileSave"] = json!("Cmd+Shift+T");
        v["keyboardShortcuts"]["paragraphTable"] = json!("Cmd+Option+T");
    });
    let first = snapshot_at_startup();
    let disk: Value = serde_json::from_slice(&read_config_bytes(&h.dir)).expect("disk JSON");
    assert_eq!(disk["keyboardShortcuts"]["fileSave"], json!("Cmd+Shift+T"));
    assert_eq!(
        disk["keyboardShortcuts"]["paragraphTable"],
        json!("<unassigned>")
    );
    assert_eq!(
        as_value(&first)["bindings"]["paragraphTable"],
        json!({ "state": "suppressed", "reason": "yieldedToCustom" })
    );
    let next = snapshot_at_startup();
    assert_eq!(
        as_value(&next)["bindings"]["paragraphTable"],
        json!({ "state": "unassigned" })
    );
}

#[test]
fn a5_a_corrupt_file_falls_back_to_defaults_and_writes_nothing() {
    let h = TestHome::new("a5_corrupt");
    let _log = logger_on(&h);
    let seeded = write_raw_config(&h.dir, "{ not json");
    let mtime_before = config_mtime(&h.dir);

    let snap = as_value(&snapshot_at_startup());

    assert_eq!(snap["source"], json!("defaultsAfterLoadFailure"));
    assert_eq!(snap["bindings"], default_bindings());
    assert_eq!(
        snap["keyboardShortcutsVersion"],
        json!(CURRENT_KEYBOARD_SHORTCUTS_VERSION)
    );
    assert_eq!(read_config_bytes(&h.dir), seeded);
    assert_eq!(config_mtime(&h.dir), mtime_before);

    let records = log_records(&h.dir, RESOLVE_EVENT);
    let fails = with_status(&records, "fail");
    assert_eq!(fails.len(), 1, "records: {records:?}");
    assert_eq!(with_status(&records, "success").len(), 0);
    assert_eq!(
        fails[0]["context"]["source"],
        json!("defaultsAfterLoadFailure")
    );
    assert_no_leak(&records, &h);
}

#[test]
fn a6_a_missing_file_resolves_defaults_as_loaded() {
    let h = TestHome::new("a6_missing");
    assert!(!config_file(&h.dir).exists(), "precondition: no config");

    let snap = as_value(&snapshot_at_startup());

    assert_eq!(snap["source"], json!("loaded"));
    assert_eq!(snap["bindings"], default_bindings());
    assert_eq!(
        snap["keyboardShortcutsVersion"],
        json!(CURRENT_KEYBOARD_SHORTCUTS_VERSION)
    );
    let disk: Value = serde_json::from_slice(&read_config_bytes(&h.dir)).expect("disk JSON");
    assert_eq!(
        disk,
        serde_json::to_value(UserPreferences::default()).expect("defaults")
    );
}

#[test]
fn a9_startup_and_command_logs_carry_counts_only() {
    let h = TestHome::new("a9_logs");
    seed_config(&h.dir, |v| {
        v["keyboardShortcuts"]["fileSave"] = json!("<unassigned>");
        v["keyboardShortcuts"]["editJumpToTop"] = json!("<system>");
        v["keyboardShortcuts"]["fileOpen"] = json!("Cmd+Alt+O");
    });
    let _log = logger_on(&h);

    let st = AppliedShortcutsState::new(snapshot_at_startup());
    get_applied_shortcuts_inner(&st).expect("first get");
    get_applied_shortcuts_inner(&st).expect("second get");

    let resolve = log_records(&h.dir, RESOLVE_EVENT);
    assert_eq!(with_status(&resolve, "start").len(), 1, "{resolve:?}");
    let ok = with_status(&resolve, "success");
    assert_eq!(ok.len(), 1, "{resolve:?}");
    let expected_bindings = default_bindings();
    let fields = expected_bindings.as_object().expect("binding object");
    let count = |state: &str| {
        fields
            .values()
            .filter(|binding| binding["state"] == state)
            .count()
    };
    let bound_count = count("bound") - 1; // fileSave is unassigned in this fixture.
    assert_eq!(
        ok[0]["context"],
        json!({ "source": "loaded", "boundCount": bound_count, "unassignedCount": count("unassigned") + 1, "systemCount": count("system") })
    );
    assert_eq!(with_status(&resolve, "fail").len(), 0);

    let get = log_records(&h.dir, GET_EVENT);
    assert_eq!(with_status(&get, "start").len(), 2, "{get:?}");
    let got = with_status(&get, "success");
    assert_eq!(got.len(), 2, "{get:?}");
    for rec in &got {
        assert_eq!(rec["context"], json!({ "boundCount": bound_count }));
    }

    assert_no_leak(&resolve, &h);
    assert_no_leak(&get, &h);
}

#[test]
fn a10_the_snapshot_carries_the_loaded_documents_version() {
    let h = TestHome::new("a10_version");
    seed_config(&h.dir, |v| {
        v["keyboardShortcutsVersion"] = json!(5);
    });

    let snap = as_value(&snapshot_at_startup());

    assert_eq!(snap["keyboardShortcutsVersion"], json!(5));
    assert_eq!(snap["source"], json!("loaded"));
}
