//! ADR-0047 WI-003 WI-2 — the Rust oracle for the launcher's preferences
//! preset (`scripts/control/presets/verify-preferences.json`, decision D3).
//!
//! Covers matrix cases P-01, P-02 and P-03 of
//! `.claude/tdd-guardian/tests-20261008-144444.md`. The template is the one
//! shared source: `scripts/control/preset.mjs` reads the same bytes, and every
//! per-run `config.json` differs from it only in the two view-mode keys (P-05),
//! so this verdict carries over to every generated file.

use super::*;
use crate::models::LogLevel;

const TEMPLATE: &str = include_str!("../../../scripts/control/presets/verify-preferences.json");

fn template_value() -> serde_json::Value {
    serde_json::from_str(TEMPLATE).expect("the preset template is valid JSON")
}

/// P-01 — the committed template is a complete `UserPreferences`, logging on.
#[test]
fn p01_template_deserializes_with_logging_on_at_debug() {
    let parsed = serde_json::from_str::<UserPreferences>(TEMPLATE);
    let p = match parsed {
        Ok(p) => p,
        Err(e) => panic!("the preset must deserialize as UserPreferences: {e}"),
    };
    assert!(p.logging.enabled, "the preset must keep logging enabled");
    assert_eq!(p.logging.level, LogLevel::Debug);
    assert_eq!(p.auto_save_interval, 5);
    assert!(
        matches!(p.default_view_mode, ViewMode::Source),
        "the template's defaultViewMode must be source, got {:?}",
        p.default_view_mode
    );
}

/// P-02 — negative control: removing any one required leaf is an `Err`, so
/// P-01 cannot pass vacuously (e.g. after a `#[serde(default)]` on `LogSettings`).
#[test]
fn p02_oracle_detects_an_incomplete_preset() {
    let variants: [(&str, &[&str]); 3] = [
        ("logging.level", &["logging", "level"]),
        ("windowState.isMaximized", &["windowState", "isMaximized"]),
        ("autoSaveInterval", &["autoSaveInterval"]),
    ];
    for (name, keys) in variants {
        let mut v = template_value();
        let (last, parents) = keys.split_last().expect("non-empty path");
        let mut cursor = &mut v;
        for k in parents {
            cursor = cursor.get_mut(*k).expect("parent object exists");
        }
        let removed = cursor.as_object_mut().expect("an object").remove(*last);
        assert!(removed.is_some(), "{name} must exist in the template");
        assert!(
            serde_json::from_value::<UserPreferences>(v).is_err(),
            "a preset without {name} must be refused"
        );
    }
}

/// P-03 — both journey view modes deserialize to their variants.
#[test]
fn p03_both_allowed_view_modes_deserialize() {
    for (wire, want_wysiwyg) in [("wysiwyg", true), ("source", false)] {
        let mut v = template_value();
        v["defaultViewMode"] = serde_json::Value::from(wire);
        v["lastViewMode"] = serde_json::Value::from(wire);
        let p = match serde_json::from_value::<UserPreferences>(v) {
            Ok(p) => p,
            Err(e) => panic!("viewMode {wire} must deserialize: {e}"),
        };
        for (field, got) in [
            ("defaultViewMode", &p.default_view_mode),
            ("lastViewMode", &p.last_view_mode),
        ] {
            let ok = if want_wysiwyg {
                matches!(got, ViewMode::Wysiwyg)
            } else {
                matches!(got, ViewMode::Source)
            };
            assert!(ok, "{field} for {wire} deserialized as {got:?}");
        }
    }
}
