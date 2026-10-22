//! M1a WI-4: `resolve_applied` and the applied-shortcuts contract (cases A1,
//! A2, A3 and A7/A8 of `.claude/tdd-guardian/tests-20261016-202016.md`).
//!
//! **Law (S4+S5):**
//! 1. key-set conservation: `keys(bindings) == keys(to_value(shortcuts))`, 58;
//! 2. pointwise state: `"<unassigned>"` → unassigned, `"<system>"` → system,
//!    `""` → bound(default), anything else → bound(verbatim);
//! 3. count conservation: `bound + unassigned + system == 58`, each count the
//!    number of bindings in that state;
//! 4. determinism: two calls serialise to equal bytes.
//!
//! The oracle below is written with literal strings, not the crate's
//! constants, so it stays independent of the code under test.

use super::*;
use crate::models::{SYSTEM_BINDING, UNASSIGNED_BINDING};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

const PREFS_CONTRACT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/preferences-contract.json"
);
const APPLIED_CONTRACT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/applied-shortcuts-contract.json"
);
const FIELD_COUNT: usize = 58;

#[test]
fn image_applied_snapshot_matches_host_rows_of_shared_parity_fixture() {
    let cases: Value = read_json(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/legacy-image-shortcut-cases.json"
    ));
    let host = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    let rows = cases.as_array().expect("parity rows");
    let mut checked = 0;
    for row in rows {
        if row["platform"] != host {
            continue;
        }
        let stored = row["stored"].as_str().expect("stored string");
        let expected = row["expected"].as_str().expect("expected string");
        let mut input = KeyboardShortcuts::default();
        input.format_image = stored.to_string();
        let got = serde_json::to_value(resolve_applied(&input).get("formatImage"))
            .expect("binding serializes");
        let want = if expected == "<unassigned>" {
            json!({"state":"unassigned"})
        } else {
            json!({"state":"bound","chord":expected})
        };
        assert_eq!(got, want, "host {host} stored {stored:?}");
        checked += 1;
    }
    assert!(checked >= 2);
}

fn read_json(path: &str) -> Value {
    let raw = std::fs::read_to_string(path).expect("fixture readable");
    serde_json::from_str(&raw).expect("fixture JSON")
}

fn as_obj(k: &KeyboardShortcuts) -> Map<String, Value> {
    match serde_json::to_value(k).expect("shortcuts serialize") {
        Value::Object(m) => m,
        other => panic!("shortcuts serialised as {other}"),
    }
}

fn from_obj(m: Map<String, Value>) -> KeyboardShortcuts {
    serde_json::from_value(Value::Object(m)).expect("shortcuts deserialize")
}

fn bindings_value(k: &KeyboardShortcuts) -> Map<String, Value> {
    match serde_json::to_value(resolve_applied(k)).expect("bindings serialize") {
        Value::Object(m) => m,
        other => panic!("bindings serialised as {other}"),
    }
}

fn default_chords() -> Map<String, Value> {
    match read_json(PREFS_CONTRACT)["$defaultKeyboardShortcuts"].clone() {
        Value::Object(m) => m,
        other => panic!("$defaultKeyboardShortcuts is {other}"),
    }
}

/// The pointwise rule, as the spec states it.
fn expected_binding(field: &str, stored: &str, default: &str) -> Value {
    if field == "formatImage"
        && !cfg!(target_os = "macos")
        && (stored == "Cmd+Ctrl+I" || stored.is_empty())
    {
        return json!({ "state": "unassigned" });
    }
    match stored {
        "<unassigned>" => json!({ "state": "unassigned" }),
        "<system>" => json!({ "state": "system" }),
        "" => json!({ "state": "bound", "chord": default }),
        chord => json!({ "state": "bound", "chord": chord }),
    }
}

fn keys(m: &Map<String, Value>) -> BTreeSet<String> {
    m.keys().cloned().collect()
}

/// Asserts laws 1–4 for one input.
fn assert_law(input: &KeyboardShortcuts, label: &str) {
    let stored = as_obj(input);
    let defaults = as_obj(&KeyboardShortcuts::default());
    let bindings = bindings_value(input);

    assert_eq!(keys(&bindings), keys(&stored), "{label}: key set");
    assert_eq!(bindings.len(), FIELD_COUNT, "{label}: field count");
    for (k, v) in &stored {
        let s = v.as_str().expect("binding is a string");
        let d = defaults[k].as_str().expect("default is a string");
        assert_eq!(bindings[k], expected_binding(k, s, d), "{label}: field {k}");
    }

    let resolved = resolve_applied(input);
    let counts = binding_counts(&resolved);
    let by_state = |state: &str| bindings.values().filter(|b| b["state"] == state).count();
    assert_eq!(counts.bound, by_state("bound"), "{label}: bound count");
    assert_eq!(
        counts.unassigned,
        by_state("unassigned"),
        "{label}: unassigned"
    );
    assert_eq!(counts.system, by_state("system"), "{label}: system count");
    assert_eq!(
        counts.bound + counts.unassigned + counts.system,
        FIELD_COUNT,
        "{label}: counts sum"
    );

    let a = serde_json::to_string(&resolve_applied(input)).expect("serialize");
    let b = serde_json::to_string(&resolve_applied(input)).expect("serialize");
    assert_eq!(a, b, "{label}: determinism");
}

/// The seven value classes of A3's domain for field number `i`.
fn class_value(class: usize, i: usize, default: &str) -> String {
    match class {
        0 => default.to_string(),
        1 => format!("Cmd+Alt+Shift+F{i}"),
        2 => String::new(),
        3 => "<unassigned>".to_string(),
        4 => "<system>".to_string(),
        5 => "<UNASSIGNED>".to_string(),
        _ => " <system>".to_string(),
    }
}
const CLASSES: usize = 7;

#[test]
fn a1_defaults_resolve_to_the_contract_chords() {
    let bindings = bindings_value(&KeyboardShortcuts::default());
    let chords = default_chords();

    assert_eq!(chords.len(), FIELD_COUNT);
    assert_eq!(keys(&bindings), keys(&chords));
    for (k, chord) in &chords {
        assert_eq!(
            bindings[k],
            json!({ "state": "bound", "chord": chord }),
            "field {k}"
        );
    }
}

#[test]
fn a2_sentinels_and_a_custom_chord() {
    let mut m = as_obj(&KeyboardShortcuts::default());
    m.insert("fileSave".into(), json!("<unassigned>"));
    m.insert("editJumpToTop".into(), json!("<system>"));
    m.insert("fileOpen".into(), json!("Cmd+Alt+O"));
    let bindings = bindings_value(&from_obj(m));
    let chords = default_chords();

    assert_eq!(bindings["fileSave"], json!({ "state": "unassigned" }));
    assert_eq!(bindings["editJumpToTop"], json!({ "state": "system" }));
    assert_eq!(
        bindings["fileOpen"],
        json!({ "state": "bound", "chord": "Cmd+Alt+O" })
    );
    let others: Vec<_> = chords
        .iter()
        .filter(|(k, _)| !["fileSave", "editJumpToTop", "fileOpen"].contains(&k.as_str()))
        .collect();
    assert_eq!(others.len(), FIELD_COUNT - 3);
    for (k, chord) in others {
        assert_eq!(
            bindings[k],
            json!({ "state": "bound", "chord": chord }),
            "field {k}"
        );
    }
}

#[test]
fn a3_law_holds_one_field_varied_at_a_time() {
    let defaults = as_obj(&KeyboardShortcuts::default());
    for (i, (field, d)) in defaults.iter().enumerate() {
        let d = d.as_str().expect("default string");
        for class in 0..CLASSES {
            let mut m = defaults.clone();
            m.insert(field.clone(), json!(class_value(class, i, d)));
            assert_law(&from_obj(m), &format!("{field} class {class}"));
        }
    }
}

#[test]
fn a3_law_holds_over_every_all_fields_mix() {
    let defaults = as_obj(&KeyboardShortcuts::default());
    // Seven rotations, so every field takes every class inside a mix.
    for rotation in 0..CLASSES {
        let mut m = Map::new();
        for (i, (field, d)) in defaults.iter().enumerate() {
            let d = d.as_str().expect("default string");
            m.insert(
                field.clone(),
                json!(class_value((i + rotation) % CLASSES, i, d)),
            );
        }
        assert_law(&from_obj(m), &format!("mix rotation {rotation}"));
    }
}

#[test]
fn a7_a8_the_rust_half_of_the_applied_contract() {
    let fixture = read_json(APPLIED_CONTRACT);
    let stored: KeyboardShortcuts =
        serde_json::from_value(fixture["stored"].clone()).expect("stored group");
    let snapshot = AppliedShortcuts {
        keyboard_shortcuts_version: 1,
        source: AppliedSource::Loaded,
        bindings: resolve_applied(&stored),
    };

    assert_eq!(
        serde_json::to_value(&snapshot).expect("snapshot serialize"),
        fixture["applied"]
    );

    let obj_keys = |v: &Value| -> BTreeSet<String> {
        v.as_object().expect("object").keys().cloned().collect()
    };
    let default_keys = keys(&as_obj(&KeyboardShortcuts::default()));
    assert_eq!(obj_keys(&fixture["stored"]), default_keys);
    assert_eq!(obj_keys(&fixture["applied"]["bindings"]), default_keys);

    assert_eq!(fixture["stored"]["fileSave"], json!(UNASSIGNED_BINDING));
    assert_eq!(fixture["stored"]["editJumpToTop"], json!(SYSTEM_BINDING));
}
