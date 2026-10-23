//! M1a WI-2: the pure migration and the version's merge rule (cases M9, M13,
//! M17, M4 u32 rows, V0 and D1 of `.claude/tdd-guardian/tests-20261016-202016.md`).
//!
//! **Law** (`migrate`): a value changes iff it equals *its own* from-default
//! and its field is mapped, and then it becomes its to-default; everything
//! else is kept verbatim; a second migration is `Unchanged`; the version moves
//! `from → to` iff it was `from`, and never decreases.
//!
//! Nothing is mocked. The test plan is a parameter, not a seam.

use super::*;
use crate::menu_layout::{menu_layout, KeyKind};
use crate::models::{KeyboardShortcuts, CURRENT_KEYBOARD_SHORTCUTS_VERSION};
use crate::services::preferences::{merge_preferences, PartialPreferences};
use serde_json::{json, Map, Value};

/// The test plan every WI-2 case uses. The targets are deliberately no other
/// field's v1 default (`"Cmd+Shift+S"` is `fileSaveAs`'s and would hide a
/// field mix-up).
pub(super) const TEST_PLAN: MigrationPlan = MigrationPlan {
    from: 1,
    to: 2,
    map: &[
        MappedDefault {
            field: "fileSave",
            from: "Cmd+S",
            to: "Cmd+Alt+Shift+S",
        },
        MappedDefault {
            field: "fileOpen",
            from: "Cmd+O",
            to: "Cmd+Alt+Shift+O",
        },
    ],
};

fn shortcuts_obj(p: &UserPreferences) -> Map<String, Value> {
    match serde_json::to_value(&p.keyboard_shortcuts).expect("shortcuts serialize") {
        Value::Object(m) => m,
        other => panic!("shortcuts serialised as {other}"),
    }
}

fn with_shortcuts(version: u32, obj: Map<String, Value>) -> UserPreferences {
    let shortcuts: KeyboardShortcuts =
        serde_json::from_value(Value::Object(obj)).expect("shortcuts deserialize");
    UserPreferences {
        keyboard_shortcuts: shortcuts,
        keyboard_shortcuts_version: version,
        ..UserPreferences::default()
    }
}

fn mapped(field: &str) -> Option<&'static MappedDefault> {
    TEST_PLAN.map.iter().find(|m| m.field == field)
}

/// The value classes of M9 for one field.
fn classes(field: &str, own_default: &str) -> Vec<(&'static str, String)> {
    let other_mapped = if field == "fileSave" {
        "Cmd+O"
    } else {
        "Cmd+S"
    };
    let own_to = mapped(field).map_or(own_default, |m| m.to);
    vec![
        ("own v1 default", own_default.to_string()),
        ("custom", "Cmd+Alt+Ctrl+9".to_string()),
        ("empty", String::new()),
        ("unassigned", "<unassigned>".to_string()),
        ("system", "<system>".to_string()),
        ("near-miss", "<UNASSIGNED>".to_string()),
        ("another field's mapped default", other_mapped.to_string()),
        ("own to-default", own_to.to_string()),
    ]
}

/// Checks laws 1–4 for one input document; returns a failure message or None.
fn check_law(input: &UserPreferences, tag: &str) -> Option<String> {
    let before = shortcuts_obj(input);
    let (out, outcome) = migrate(input.clone(), &TEST_PLAN);
    let after = shortcuts_obj(&out);
    let applies = input.keyboard_shortcuts_version == TEST_PLAN.from;
    let mut expected_changes = 0;
    for (key, value) in &before {
        let expected = match mapped(key) {
            Some(m) if applies && value.as_str() == Some(m.from) => {
                expected_changes += 1;
                json!(m.to)
            }
            _ => value.clone(),
        };
        if after.get(key) != Some(&expected) {
            return Some(format!(
                "{tag}: {key} became {:?}, expected {expected}",
                after.get(key)
            ));
        }
    }
    let (want_outcome, want_version) = if applies {
        let n = expected_changes;
        (
            MigrationOutcome::Migrated { changed_count: n },
            TEST_PLAN.to,
        )
    } else {
        (
            MigrationOutcome::Unchanged,
            input.keyboard_shortcuts_version,
        )
    };
    if outcome != want_outcome || out.keyboard_shortcuts_version != want_version {
        return Some(format!(
            "{tag}: got {outcome:?} v{}, expected {want_outcome:?} v{want_version}",
            out.keyboard_shortcuts_version
        ));
    }
    let (again, second) = migrate(out.clone(), &TEST_PLAN);
    if second != MigrationOutcome::Unchanged
        || shortcuts_obj(&again) != after
        || again.keyboard_shortcuts_version != out.keyboard_shortcuts_version
    {
        return Some(format!(
            "{tag}: second migration was {second:?}, not a no-op"
        ));
    }
    None
}

#[test]
fn m9_the_migration_law_over_the_enumerated_domain() {
    let defaults = shortcuts_obj(&UserPreferences::default());
    assert_eq!(defaults.len(), 58, "precondition: 58 shortcut fields");
    let mut failures = Vec::new();
    let mut rows = 0;
    for version in [1, 2, 3] {
        for (field, own) in &defaults {
            let own = own.as_str().expect("default is a string");
            for (class, value) in classes(field, own) {
                let mut obj = defaults.clone();
                obj.insert(field.clone(), json!(value));
                let input = with_shortcuts(version, obj);
                rows += 1;
                failures.extend(check_law(&input, &format!("v{version} {field} {class}")));
            }
        }
        // Law 4 apart from law 1: every mapped field custom.
        let mut obj = defaults.clone();
        for m in TEST_PLAN.map {
            obj.insert(m.field.to_string(), json!("Cmd+Alt+Ctrl+7"));
        }
        failures.extend(check_law(
            &with_shortcuts(version, obj),
            &format!("v{version} all custom"),
        ));
    }
    assert_eq!(rows, 58 * 8 * 3);
    assert!(
        failures.is_empty(),
        "{} failures, first: {:?}",
        failures.len(),
        &failures[..failures.len().min(5)]
    );
}

#[test]
fn m9_only_the_mapped_fields_ever_change_and_only_at_version_one() {
    let input = with_shortcuts(1, shortcuts_obj(&UserPreferences::default()));
    let (out, outcome) = migrate(input, &TEST_PLAN);
    let after = shortcuts_obj(&out);
    assert_eq!(outcome, MigrationOutcome::Migrated { changed_count: 2 });
    assert_eq!(after["fileSave"], json!("Cmd+Alt+Shift+S"));
    assert_eq!(after["fileOpen"], json!("Cmd+Alt+Shift+O"));
    assert_eq!(after["fileSaveAs"], json!("Cmd+Shift+S"));
    assert_eq!(out.keyboard_shortcuts_version, 2);
}

#[test]
fn m13_a_from_default_at_the_target_version_stays() {
    let mut obj = shortcuts_obj(&UserPreferences::default());
    obj.insert("fileSave".into(), json!("Cmd+S"));
    let (out, outcome) = migrate(with_shortcuts(2, obj), &TEST_PLAN);
    assert_eq!(outcome, MigrationOutcome::Unchanged);
    assert_eq!(shortcuts_obj(&out)["fileSave"], json!("Cmd+S"));
    assert_eq!(out.keyboard_shortcuts_version, 2);
}

#[test]
fn m17_the_version_moves_even_when_no_mapped_value_changes() {
    let mut obj = shortcuts_obj(&UserPreferences::default());
    obj.insert("fileSave".into(), json!("Cmd+Alt+1"));
    obj.insert("fileOpen".into(), json!("Cmd+Alt+2"));
    let (out, outcome) = migrate(with_shortcuts(1, obj), &TEST_PLAN);
    assert_eq!(outcome, MigrationOutcome::Migrated { changed_count: 0 });
    assert_eq!(out.keyboard_shortcuts_version, 2);
    assert_eq!(shortcuts_obj(&out)["fileSave"], json!("Cmd+Alt+1"));
    let (_, second) = migrate(out, &TEST_PLAN);
    assert_eq!(second, MigrationOutcome::Unchanged);
}

#[test]
fn m4_u32_max_is_never_migrated_or_lowered() {
    let p = with_shortcuts(u32::MAX, shortcuts_obj(&UserPreferences::default()));
    let (out, outcome) = migrate(p, &TEST_PLAN);
    assert_eq!(outcome, MigrationOutcome::Unchanged);
    assert_eq!(out.keyboard_shortcuts_version, u32::MAX);
}

#[test]
fn production_plan_moves_only_v1_documents() {
    for version in [0, 1, 2, u32::MAX] {
        let p = with_shortcuts(version, shortcuts_obj(&UserPreferences::default()));
        let (out, outcome) = migrate(p, &PRODUCTION_PLAN);
        if version == 1 {
            assert!(
                matches!(outcome, MigrationOutcome::Migrated { .. }),
                "v{version}"
            );
            assert_eq!(out.keyboard_shortcuts_version, 2, "v{version}");
        } else {
            assert_eq!(outcome, MigrationOutcome::Unchanged, "v{version}");
            assert_eq!(out.keyboard_shortcuts_version, version, "v{version}");
        }
    }
}

#[test]
fn m1b_production_plan_migrates_changed_defaults_once_and_keeps_custom_values() {
    let mut obj = shortcuts_obj(&UserPreferences::default());
    // This document represents a v1 writer; v2 defaults are active now.
    obj.insert("paragraphParagraph".into(), json!("Cmd+0"));
    obj.insert("paragraphIncreaseHeading".into(), json!("Cmd+Option+9"));
    let input = with_shortcuts(1, obj);
    let (first, outcome) = migrate(input, &PRODUCTION_PLAN);
    let after = shortcuts_obj(&first);

    assert_eq!(CURRENT_KEYBOARD_SHORTCUTS_VERSION, 2);
    assert_eq!(first.keyboard_shortcuts_version, 2);
    assert!(matches!(outcome, MigrationOutcome::Migrated { changed_count } if changed_count > 0));
    assert_eq!(after["paragraphParagraph"], json!("Cmd+Shift+0"));
    assert_eq!(after["paragraphIncreaseHeading"], json!("Cmd+Option+9"));
    let (second, second_outcome) = migrate(first, &PRODUCTION_PLAN);
    assert_eq!(second_outcome, MigrationOutcome::Unchanged);
    assert_eq!(shortcuts_obj(&second), after);
}

#[test]
fn m1b_every_changed_v1_default_becomes_the_host_v2_default() {
    let layout = menu_layout().expect("committed layout");
    let mut obj = shortcuts_obj(&UserPreferences::default());
    let mut expected = obj.clone();
    let mut changed = 0;
    for row in &layout.rows {
        let Some(field) = &row.pref_field else {
            continue;
        };
        let key = if cfg!(target_os = "macos") {
            &row.key.macos
        } else {
            &row.key.windows
        };
        if key.kind != KeyKind::Configurable {
            continue;
        }
        let Some(from) = &key.defaults.v1 else {
            continue;
        };
        let Some(to) = &key.defaults.v2 else {
            continue;
        };
        // The old off-Mac Image default was stored as the Mac chord and
        // suppressed only when applied; the migration must still replace it.
        let stored_from = if field == "formatImage" && !cfg!(target_os = "macos") {
            "Cmd+Ctrl+I"
        } else {
            from.as_str()
        };
        obj.insert(field.clone(), json!(stored_from));
        expected.insert(field.clone(), json!(to));
        if stored_from != to {
            changed += 1;
        }
    }
    let (out, outcome) = migrate(with_shortcuts(1, obj), &PRODUCTION_PLAN);
    assert_eq!(shortcuts_obj(&out), expected);
    assert_eq!(out.keyboard_shortcuts_version, 2);
    assert_eq!(
        outcome,
        MigrationOutcome::Migrated {
            changed_count: changed
        }
    );
}

#[test]
fn m1b_new_default_yields_to_kept_custom_and_is_stored_unassigned() {
    let mut obj = shortcuts_obj(&UserPreferences::default());
    obj.insert("fileSave".to_string(), json!("Cmd+Shift+T"));
    obj.insert("paragraphTable".to_string(), json!("Cmd+Option+T"));
    let (out, outcome) = migrate(with_shortcuts(1, obj), &PRODUCTION_PLAN);
    assert!(matches!(outcome, MigrationOutcome::Migrated { .. }));
    let stored = shortcuts_obj(&out);
    assert_eq!(stored.get("fileSave"), Some(&json!("Cmd+Shift+T")));
    assert_eq!(stored.get("paragraphTable"), Some(&json!("<unassigned>")));
}

#[test]
fn m1b_yielded_notice_exists_only_during_the_upgrade_run() {
    let mut obj = shortcuts_obj(&UserPreferences::default());
    obj.insert("fileSave".to_string(), json!("Cmd+Shift+T"));
    obj.insert("paragraphTable".to_string(), json!("Cmd+Option+T"));
    let (current, _) = migrate(with_shortcuts(1, obj), &PRODUCTION_PLAN);
    assert_eq!(current.shortcut_migration_conflicts, vec!["paragraphTable"]);
    let bytes = serde_json::to_string(&current).expect("serialize");
    let reopened: UserPreferences = serde_json::from_str(&bytes).expect("reopen");
    assert!(reopened.shortcut_migration_conflicts.is_empty());
    assert_eq!(
        shortcuts_obj(&reopened).get("paragraphTable"),
        Some(&json!("<unassigned>"))
    );
}

/// The 20 single-group partials plus the empty one, each built from JSON.
fn partials() -> Vec<(String, PartialPreferences)> {
    let defaults = serde_json::to_value(UserPreferences::default()).expect("defaults");
    let mut out = vec![(
        "empty".to_string(),
        serde_json::from_value(json!({})).expect("empty partial"),
    )];
    for (key, value) in defaults.as_object().expect("object") {
        if key == "keyboardShortcutsVersion" {
            continue;
        }
        let partial = serde_json::from_value(json!({ key.clone(): value.clone() }))
            .unwrap_or_else(|e| panic!("partial {key}: {e}"));
        out.push((key.clone(), partial));
    }
    out
}

#[test]
fn v0_merge_keeps_the_stored_version_for_every_partial() {
    let all = partials();
    assert_eq!(all.len(), 21, "20 single-group partials plus the empty one");
    for (name, partial) in all {
        let current = UserPreferences {
            keyboard_shortcuts_version: 5,
            ..UserPreferences::default()
        };
        let merged = merge_preferences(current, partial);
        assert_eq!(merged.keyboard_shortcuts_version, 5, "partial {name}");
    }
}

#[test]
fn d1_defaults_are_at_current_which_is_two() {
    assert_eq!(CURRENT_KEYBOARD_SHORTCUTS_VERSION, 2);
    assert_eq!(
        UserPreferences::default().keyboard_shortcuts_version,
        CURRENT_KEYBOARD_SHORTCUTS_VERSION
    );
    assert_eq!(PRODUCTION_PLAN.to, CURRENT_KEYBOARD_SHORTCUTS_VERSION);
    assert!(!PRODUCTION_PLAN.map.is_empty(), "M1b ships the full map");
}
