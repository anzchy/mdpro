//! M1a WI-2: the `<unassigned>` / `<system>` binding states and the D-b
//! repair (cases S1–S4, CF1b and CF2 of
//! `.claude/tdd-guardian/tests-20261016-202016.md`).
//!
//! **Law (S4):** `with_empty_bindings_defaulted(x)` differs from `x` exactly on
//! the fields where `x == ""`, and each of those becomes its default. Sentinels
//! and near-misses are ordinary non-empty strings to the repair.

use super::*;
use crate::commands::preferences::set_preferences;
use crate::models::UserPreferences;
use crate::services::preferences::{load_preferences, PartialPreferences};
use crate::services::window_restore::test_home::{read_config_bytes, seed_config, TestHome};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

const CONTRACT_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/preferences-contract.json"
);

fn block_on<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("current-thread runtime")
        .block_on(f)
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

fn contract_fixture() -> Value {
    let raw = std::fs::read_to_string(CONTRACT_FIXTURE).expect("contract fixture");
    serde_json::from_str(&raw).expect("contract fixture JSON")
}

#[test]
fn s1_sentinels_load_verbatim_and_empty_is_still_repaired() {
    let h = TestHome::new("s1_sentinels");
    seed_config(&h.dir, |v| {
        v["keyboardShortcuts"]["fileSave"] = json!("<unassigned>");
        v["keyboardShortcuts"]["editJumpToTop"] = json!("<system>");
        v["keyboardShortcuts"]["fileOpen"] = json!("");
    });
    let k = load_preferences().expect("load").keyboard_shortcuts;
    assert_eq!(k.file_save, "<unassigned>");
    assert_eq!(k.edit_jump_to_top, "<system>");
    assert_eq!(k.file_open, "Cmd+O");
}

#[test]
fn s2_sentinels_survive_a_whole_group_write_and_reload() {
    let h = TestHome::new("s2_round_trip");
    seed_config(&h.dir, |v| {
        v["keyboardShortcuts"]["fileSave"] = json!("<unassigned>");
        v["keyboardShortcuts"]["editJumpToTop"] = json!("<system>");
        v["keyboardShortcuts"]["fileOpen"] = json!("");
    });
    let mut group = as_obj(&load_preferences().expect("load").keyboard_shortcuts);
    group.insert("fileOpen".into(), json!(""));
    let partial: PartialPreferences =
        serde_json::from_value(json!({ "keyboardShortcuts": group })).expect("partial");
    block_on(set_preferences(partial)).expect("set_preferences");
    let disk: Value = serde_json::from_slice(&read_config_bytes(&h.dir)).expect("json");
    let reloaded = load_preferences().expect("reload").keyboard_shortcuts;

    assert_eq!(disk["keyboardShortcuts"]["fileSave"], json!("<unassigned>"));
    assert_eq!(
        disk["keyboardShortcuts"]["editJumpToTop"],
        json!("<system>")
    );
    assert_eq!(disk["keyboardShortcuts"]["fileOpen"], json!(""));
    assert_eq!(reloaded.file_save, "<unassigned>");
    assert_eq!(reloaded.edit_jump_to_top, "<system>");
    assert_eq!(reloaded.file_open, "Cmd+O");
}

#[test]
fn s3_near_misses_load_as_ordinary_strings() {
    let h = TestHome::new("s3_near_misses");
    seed_config(&h.dir, |v| {
        v["keyboardShortcuts"]["fileSave"] = json!("<UNASSIGNED>");
        v["keyboardShortcuts"]["fileOpen"] = json!(" <system>");
        v["keyboardShortcuts"]["fileNew"] = json!("<unassigned");
    });
    let k = load_preferences().expect("load").keyboard_shortcuts;
    assert_eq!(k.file_save, "<UNASSIGNED>");
    assert_eq!(k.file_open, " <system>");
    assert_eq!(k.file_new, "<unassigned");
}

/// The changed keys of `repaired` against `input`, and any whose new value is
/// not its default.
fn repair_law_violations(input: &Map<String, Value>, tag: &str) -> Vec<String> {
    let defaults = as_obj(&KeyboardShortcuts::default());
    let out = as_obj(&from_obj(input.clone()).with_empty_bindings_defaulted());
    let mut bad = Vec::new();
    for (key, before) in input {
        let after = &out[key];
        let should_change = before.as_str() == Some("");
        let expected = if should_change {
            &defaults[key]
        } else {
            before
        };
        if after != expected {
            bad.push(format!(
                "{tag}: {key} {before} -> {after}, expected {expected}"
            ));
        }
    }
    bad
}

#[test]
fn s4_the_repair_law_over_the_enumerated_domain() {
    let defaults = as_obj(&KeyboardShortcuts::default());
    let class_values = |own: &Value| -> Vec<Value> {
        vec![
            json!(""),
            json!("<unassigned>"),
            json!("<system>"),
            json!("<UNASSIGNED>"),
            json!(" <system>"),
            json!("Cmd+Alt+Ctrl+9"),
            own.clone(),
        ]
    };
    let mut bad = Vec::new();
    for (key, own) in &defaults {
        for (i, value) in class_values(own).into_iter().enumerate() {
            let mut input = defaults.clone();
            input.insert(key.clone(), value);
            bad.extend(repair_law_violations(&input, &format!("{key} class {i}")));
        }
    }
    let mut mixed = defaults.clone();
    for (i, (key, own)) in defaults.iter().enumerate() {
        mixed.insert(key.clone(), class_values(own)[i % 7].clone());
    }
    bad.extend(repair_law_violations(&mixed, "mixed"));
    assert!(
        bad.is_empty(),
        "{} violations: {:?}",
        bad.len(),
        &bad[..bad.len().min(5)]
    );
}

#[test]
fn cf1b_the_contract_fixture_version_survives_deserialisation() {
    let p: UserPreferences =
        serde_json::from_value(contract_fixture()).expect("fixture deserializes");
    assert_eq!(p.keyboard_shortcuts_version, 7);
}

#[test]
fn cf2_the_sentinel_constants_equal_the_fixture_states() {
    let fixture = contract_fixture();
    let states = fixture["$keyboardShortcutStates"]
        .as_array()
        .expect("$keyboardShortcutStates is an array");
    assert_eq!(states.len(), 2);
    let from_fixture: BTreeSet<&str> = states.iter().filter_map(Value::as_str).collect();
    let from_code: BTreeSet<&str> = [UNASSIGNED_BINDING, SYSTEM_BINDING].into_iter().collect();
    assert_ne!(UNASSIGNED_BINDING, SYSTEM_BINDING);
    assert_eq!(from_code, from_fixture);
}
