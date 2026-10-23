//! M1a WI-2: the version field on the production load path (cases M1, M1b,
//! M2, M3, M3b, M4, M5, M15 and V1 of
//! `.claude/tdd-guardian/tests-20261016-202016.md`).
//!
//! **Law:** the M1b production plan moves a v1 document once, leaves v2 and
//! future documents untouched, and never lowers a stamp.

use super::tests::TEST_PLAN;
use super::*;
use crate::commands::preferences::set_preferences;
use crate::models::{KeyboardShortcuts, LogLevel, LogSettings};
use crate::services::logger;
use crate::services::preferences::{
    load_preferences, load_preferences_locked, load_preferences_locked_with, PartialPreferences,
    PreferencesError,
};
use crate::services::prefs_guard::PrefsGuard;
use crate::services::window_restore::test_home::{
    config_file, config_mtime, read_config_bytes, seed_config, write_raw_config, TestHome,
};
use serde_json::{json, Value};

const V035_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/preferences-v0.3.5.json"
);
const SHIPPED_V1_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/preferences-shipped-v1.json"
);
const V035_DOWNGRADE_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/preferences-v0.3.5-written-after-v2.json"
);

fn block_on<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("current-thread runtime")
        .block_on(f)
}

fn on_disk(h: &TestHome) -> Value {
    serde_json::from_slice(&read_config_bytes(&h.dir)).expect("config.json is JSON")
}

fn shortcuts_value(k: &KeyboardShortcuts) -> Value {
    serde_json::to_value(k).expect("shortcuts serialize")
}

/// Asserts a production load leaves the file untouched and returns it.
fn load_untouched(h: &TestHome) -> UserPreferences {
    let bytes = read_config_bytes(&h.dir);
    let mtime = config_mtime(&h.dir);
    let loaded = load_preferences();
    assert_eq!(
        read_config_bytes(&h.dir),
        bytes,
        "the load rewrote config.json"
    );
    assert_eq!(config_mtime(&h.dir), mtime, "the load touched config.json");
    loaded.unwrap_or_else(|e| panic!("load failed: {e:?}"))
}

fn load_migrated_once(h: &TestHome) -> UserPreferences {
    let before = read_config_bytes(&h.dir);
    let first = load_preferences().expect("first load");
    let after = read_config_bytes(&h.dir);
    assert_ne!(after, before, "v1 file was not written back");
    assert_eq!(first.keyboard_shortcuts_version, 2);
    let second = load_preferences().expect("second load");
    assert_eq!(read_config_bytes(&h.dir), after, "second load rewrote");
    assert_eq!(second.keyboard_shortcuts_version, 2);
    first
}

#[test]
fn m1_a_v035_file_migrates_once() {
    let raw = std::fs::read_to_string(V035_FIXTURE).expect("v0.3.5 fixture");
    assert!(
        !raw.contains("keyboardShortcutsVersion"),
        "precondition: the fixture must come from the pre-WI-2 serializer"
    );
    let h = TestHome::new("m1_v035");
    write_raw_config(&h.dir, &raw);

    let p = load_migrated_once(&h);

    let fixture: Value = serde_json::from_str(&raw).expect("fixture JSON");
    let expected: KeyboardShortcuts =
        serde_json::from_value(fixture["keyboardShortcuts"].clone()).expect("fixture group");
    let (want, _) = migrate(
        UserPreferences {
            keyboard_shortcuts: expected.with_empty_bindings_defaulted(),
            keyboard_shortcuts_version: 1,
            ..UserPreferences::default()
        },
        &PRODUCTION_PLAN,
    );
    assert_eq!(
        shortcuts_value(&p.keyboard_shortcuts),
        shortcuts_value(&want.keyboard_shortcuts)
    );
}

#[test]
fn m1b_the_shipped_v1_fixture_stamps_v2_once() {
    let raw = std::fs::read_to_string(SHIPPED_V1_FIXTURE).expect("shipped-v1 fixture");
    let h = TestHome::new("m1b_shipped_v1");
    write_raw_config(&h.dir, &raw);

    let p = load_migrated_once(&h);

    // Spec correction after red: the matrix assumed this fixture holds 58 `""`
    // (so the repair would yield every default). It holds 56 synthetic
    // `"Shipped+<field>"` values and no `""`; the loader must keep them, so the
    // oracle is the fixture's own group after the D-b repair, as in M1.
    let fixture: Value = serde_json::from_str(&raw).expect("fixture JSON");
    let expected: KeyboardShortcuts =
        serde_json::from_value(fixture["keyboardShortcuts"].clone()).expect("fixture group");
    assert_eq!(p.keyboard_shortcuts_version, 2);
    assert_eq!(
        shortcuts_value(&p.keyboard_shortcuts),
        shortcuts_value(&expected.with_empty_bindings_defaulted())
    );
}

#[test]
fn m1b_v035_downgrade_write_reupgrades_only_old_defaults() {
    let raw = std::fs::read_to_string(V035_DOWNGRADE_FIXTURE).expect("old-build downgrade fixture");
    assert!(!raw.contains("keyboardShortcutsVersion"));
    let h = TestHome::new("m1b_v035_downgrade");
    write_raw_config(&h.dir, &raw);

    let upgraded = load_migrated_once(&h);
    let keys = &upgraded.keyboard_shortcuts;
    assert_eq!(keys.file_save, "Cmd+Option+P", "custom Save survives");
    assert_eq!(
        keys.paragraph_paragraph, "Cmd+J",
        "custom Paragraph survives"
    );
    assert_eq!(
        keys.paragraph_table, "Cmd+Shift+T",
        "old default moves again"
    );
    assert_eq!(
        keys.format_highlight, "Cmd+Ctrl+H",
        "another custom value survives"
    );
    assert_eq!(on_disk(&h)["keyboardShortcutsVersion"], json!(2));
}

#[test]
fn m1b_failed_migration_write_keeps_disk_v1_and_retries() {
    let h = TestHome::new("m1b_failed_write_retry");
    seed_config(&h.dir, |v| {
        v["keyboardShortcutsVersion"] = json!(1);
        v["keyboardShortcuts"]["paragraphParagraph"] = json!("Cmd+0");
    });
    let original = read_config_bytes(&h.dir);
    let tmp = h.dir.join(".mdpro").join("config.json.tmp");
    std::fs::create_dir(&tmp).expect("block temporary file creation");

    let guard = PrefsGuard::acquire().expect("guard");
    let (in_memory, outcome) =
        load_preferences_locked_with(&guard, &PRODUCTION_PLAN).expect("load");
    drop(guard);
    assert!(matches!(outcome, MigrationOutcome::WriteFailed { .. }));
    assert_eq!(in_memory.keyboard_shortcuts_version, 2);
    assert_eq!(
        in_memory.keyboard_shortcuts.paragraph_paragraph,
        "Cmd+Shift+0"
    );
    assert_eq!(
        read_config_bytes(&h.dir),
        original,
        "failed write keeps the v1 disk document"
    );

    std::fs::remove_dir(&tmp).expect("clear test-only write blocker");
    let retried = load_migrated_once(&h);
    assert_eq!(
        retried.keyboard_shortcuts.paragraph_paragraph,
        "Cmd+Shift+0"
    );
}

#[test]
fn m2_a_missing_version_migrates_once() {
    let h = TestHome::new("m2_absent");
    seed_config(&h.dir, |v| {
        v.as_object_mut()
            .expect("object")
            .remove("keyboardShortcutsVersion");
    });
    assert_eq!(load_migrated_once(&h).keyboard_shortcuts_version, 2);
}

#[test]
fn m3_a_version_ahead_of_current_is_kept_through_set_preferences() {
    let h = TestHome::new("m3_ahead");
    seed_config(&h.dir, |v| {
        v["keyboardShortcutsVersion"] = json!(2);
        v["keyboardShortcuts"]["fileSave"] = json!("Cmd+S");
    });
    let first = load_untouched(&h);
    assert_eq!(first.keyboard_shortcuts_version, 2);
    assert_eq!(first.keyboard_shortcuts.file_save, "Cmd+S");

    let partial: PartialPreferences =
        serde_json::from_value(json!({ "autoSaveInterval": 77 })).expect("partial");
    block_on(set_preferences(partial)).expect("set_preferences");
    let v = on_disk(&h);
    assert_eq!(v["keyboardShortcutsVersion"], json!(2));
    assert_eq!(v["autoSaveInterval"], json!(77));
    assert_eq!(load_untouched(&h).keyboard_shortcuts_version, 2);
}

#[test]
fn m3b_a_version_past_the_test_plan_target_stays() {
    let h = TestHome::new("m3b_past_target");
    let bytes = seed_config(&h.dir, |v| {
        v["keyboardShortcutsVersion"] = json!(3);
        v["keyboardShortcuts"]["fileSave"] = json!("Cmd+S");
    });
    let g = PrefsGuard::acquire().expect("guard");
    let r = load_preferences_locked_with(&g, &TEST_PLAN).map_err(|e| format!("{e:?}"));
    drop(g);

    let (p, outcome) = r.expect("load");
    assert_eq!(outcome, MigrationOutcome::Unchanged);
    assert_eq!(p.keyboard_shortcuts_version, 3);
    assert_eq!(p.keyboard_shortcuts.file_save, "Cmd+S");
    assert_eq!(read_config_bytes(&h.dir), bytes);
}

#[test]
fn m4_a_bad_version_does_not_take_the_document_down() {
    let rows = [
        (json!(0), 1),
        (json!("x"), 1),
        (json!(-1), 1),
        (json!(1.5), 1),
        (Value::Null, 1),
        (json!(true), 1),
        (json!({}), 1),
        (json!(4_294_967_296_u64), u32::MAX),
        (json!(4_294_967_295_u64), u32::MAX),
    ];
    for (stored, want) in rows {
        let h = TestHome::new("m4_bad_version");
        seed_config(&h.dir, |v| {
            v["keyboardShortcutsVersion"] = stored.clone();
            v["autoSaveInterval"] = json!(111);
            v["logging"]["level"] = json!("warn");
        });
        let bytes = read_config_bytes(&h.dir);
        let loaded = load_preferences();
        if want == 1 {
            assert_ne!(
                read_config_bytes(&h.dir),
                bytes,
                "stored {stored}: missed migration"
            );
        } else {
            assert_eq!(read_config_bytes(&h.dir), bytes, "stored {stored}: rewrote");
        }
        let p = loaded.unwrap_or_else(|e| panic!("stored {stored}: {e:?}"));
        assert_eq!(
            p.keyboard_shortcuts_version,
            if want == 1 { 2 } else { want },
            "stored {stored}"
        );
        assert_eq!(p.auto_save_interval, 111, "stored {stored}");
        assert_eq!(p.logging.level, LogLevel::Warn, "stored {stored}");
        if want == u32::MAX {
            let (_, outcome) = migrate(p, &TEST_PLAN);
            assert_eq!(outcome, MigrationOutcome::Unchanged, "stored {stored}");
        }
    }
}

#[test]
fn m5_a_corrupt_file_follows_the_parse_error_path() {
    let h = TestHome::new("m5_corrupt");
    let bytes = write_raw_config(&h.dir, "{ not valid json");
    let mtime = config_mtime(&h.dir);

    let public = load_preferences();
    let g = PrefsGuard::acquire().expect("guard");
    let locked = load_preferences_locked(&g);
    drop(g);

    assert!(
        matches!(public, Err(PreferencesError::ParseError { .. })),
        "{public:?}"
    );
    assert!(
        matches!(locked, Err(PreferencesError::ParseError { .. })),
        "{locked:?}"
    );
    assert_eq!(read_config_bytes(&h.dir), bytes);
    assert_eq!(config_mtime(&h.dir), mtime);
    assert!(!h.dir.join(".mdpro").join("config.json.tmp").exists());
}

#[test]
fn m15_the_production_plan_logs_only_v1_migrations() {
    let h = TestHome::new("m15_no_log");
    let restore = logger::get_log_settings();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    let log = h.dir.join(".mdpro").join("mdpro.log");
    let _ = std::fs::remove_file(&log);
    let mut loads = Vec::new();
    for stamp in [None, Some(1), Some(2)] {
        seed_config(&h.dir, |v| match stamp {
            None => {
                v.as_object_mut()
                    .expect("object")
                    .remove("keyboardShortcutsVersion");
            }
            Some(n) => v["keyboardShortcutsVersion"] = json!(n),
        });
        loads.push(load_preferences().is_ok());
    }
    let raw = std::fs::read_to_string(&log).unwrap_or_default();
    logger::set_log_settings(restore);

    assert_eq!(loads, vec![true, true, true]);
    assert!(config_file(&h.dir).exists());
    let count = raw
        .lines()
        .filter(|line| line.contains("preferences.shortcuts.migrate"))
        .count();
    assert_eq!(count, 2, "only unstamped and stamped v1 migrate: {raw}");
}

#[test]
fn v1_a_frontend_write_cannot_move_the_version() {
    let h = TestHome::new("v1_frontend_write");
    seed_config(&h.dir, |v| v["keyboardShortcutsVersion"] = json!(5));

    let with_key: PartialPreferences =
        serde_json::from_value(json!({ "autoSaveInterval": 77, "keyboardShortcutsVersion": 99 }))
            .expect("an unknown key is ignored by the partial");
    block_on(set_preferences(with_key)).expect("set with the key");
    let after_first = on_disk(&h);

    let without: PartialPreferences =
        serde_json::from_value(json!({ "autoSaveInterval": 78 })).expect("partial");
    block_on(set_preferences(without)).expect("set without the key");
    let after_second = on_disk(&h);

    assert_eq!(after_first["keyboardShortcutsVersion"], json!(5));
    assert_eq!(after_first["autoSaveInterval"], json!(77));
    assert_eq!(after_second["keyboardShortcutsVersion"], json!(5));
    assert_eq!(after_second["autoSaveInterval"], json!(78));
}
