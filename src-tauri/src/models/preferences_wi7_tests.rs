//! WI-7 (ADR-0031 step 4) — `KeyboardShortcuts::default()` must yield real
//! accelerators, not 58 empty strings.
//!
//! Covers matrix cases WI7-A … WI7-H of
//! `.claude/tdd-guardian/tests-20260923-152800.md`.
//!
//! **The defect**: `KeyboardShortcuts` *derives* `Default`, while its per-field
//! defaults live only in `#[serde(default = "…")]` attributes. A derive never
//! consults those, so `KeyboardShortcuts::default()` is 58 empty strings — and
//! `load_preferences()` materialises exactly that document to disk on first run
//! (`services/preferences.rs:62-68`).
//!
//! **Law**: *the two default mechanisms are equal.*
//! `to_value(KeyboardShortcuts::default()) == to_value(from_value::<KeyboardShortcuts>(json!({})))`.
//! The left side is `Default::default()`; the right fires every serde
//! attribute. Stated as an equality, the bug class is closed for **future**
//! fields too, which 58 hand-written assertions would not do (WI7-B).
//!
//! Sibling test module (rule 50 §6): `models/preferences.rs` is 753 lines —
//! 2.5x over the 300-line budget — so these live in their own file rather than
//! an inline `#[cfg(test)] mod tests`. Mirrors `preferences_wi6_tests.rs`.
//!
//! Nothing is mocked: real `$HOME`, real `config.json`, real serde, real
//! command functions. Every filesystem case runs under `crate::HOME_LOCK` in
//! its own temp `$HOME`, so the developer's `~/.mdpro/` is never touched.

use super::*;
use crate::commands::preferences::set_preferences;
use crate::services::preferences::{
    load_preferences, save_preferences, PartialPreferences, PreferencesError,
};
use crate::HOME_LOCK;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// Count floor for the serialised shortcut object. A structural invariant that
/// iterates an object would pass vacuously on a struct that had lost all its
/// fields; this is what stops that.
const SHORTCUT_FIELD_COUNT: usize = 58;

// ---------------------------------------------------------------------------
// Harness
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

fn temp_home(label: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join("mdpro_prefs_wi7_test")
        .join(format!("{label}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
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

fn as_object(value: &Value, what: &str) -> Map<String, Value> {
    value
        .as_object()
        .unwrap_or_else(|| panic!("{what} must be a JSON object, got {value}"))
        .clone()
}

/// `KeyboardShortcuts::default()` as a JSON object — the derive/impl mechanism.
fn defaults_via_default_trait() -> Map<String, Value> {
    let value = serde_json::to_value(KeyboardShortcuts::default())
        .expect("KeyboardShortcuts must serialise");
    as_object(&value, "serialised KeyboardShortcuts::default()")
}

/// The same struct built by deserialising `{}` — the serde-attribute
/// mechanism, which fires every `#[serde(default = "…")]`.
fn defaults_via_serde_attributes() -> Map<String, Value> {
    let built: KeyboardShortcuts = serde_json::from_value(json!({}))
        .expect("an empty object must fire every per-field serde default");
    let value = serde_json::to_value(built).expect("KeyboardShortcuts must serialise");
    as_object(&value, "serialised from_value::<KeyboardShortcuts>({})")
}

/// Key-wise diff, because `assert_eq!` on two 58-key JSON objects is
/// unreadable. One run names every disagreement.
fn diff_report(
    a: &Map<String, Value>,
    b: &Map<String, Value>,
    a_name: &str,
    b_name: &str,
) -> String {
    let mut lines: Vec<String> = Vec::new();
    for (k, av) in a {
        match b.get(k) {
            Some(bv) if bv == av => {}
            Some(bv) => lines.push(format!("{k}: {a_name}={av} {b_name}={bv}")),
            None => lines.push(format!("{k}: present in {a_name}, absent from {b_name}")),
        }
    }
    for k in b.keys() {
        if !a.contains_key(k) {
            lines.push(format!("{k}: present in {b_name}, absent from {a_name}"));
        }
    }
    lines.join("\n  ")
}

/// Every key whose value is the empty string, collected so one run names all
/// the offenders instead of only the first.
fn empty_valued_keys(object: &Map<String, Value>) -> Vec<String> {
    let mut keys: Vec<String> = object
        .iter()
        .filter(|(_, v)| v.as_str() == Some(""))
        .map(|(k, _)| k.clone())
        .collect();
    keys.sort();
    keys
}

fn config_path(home: &Path) -> PathBuf {
    home.join(".mdpro").join("config.json")
}

/// Writes a complete `config.json` whose `keyboardShortcuts` group is exactly
/// `shortcuts`. Every other field is a serialised `UserPreferences::default()`.
fn write_config_with_shortcuts(home: &Path, shortcuts: &Value) {
    let mut document =
        serde_json::to_value(UserPreferences::default()).expect("UserPreferences must serialise");
    document["keyboardShortcuts"] = shortcuts.clone();
    let dir = home.join(".mdpro");
    std::fs::create_dir_all(&dir).expect("create .mdpro");
    std::fs::write(
        config_path(home),
        serde_json::to_string_pretty(&document).expect("serialise config document"),
    )
    .expect("write config.json");
}

/// Reads `keyboardShortcuts` straight off the disk as raw text → `Value`.
/// Deliberately does **not** go through `load_preferences`, whose repair is
/// precisely what would hide the answer (WI7-G).
fn shortcuts_on_disk(home: &Path) -> Map<String, Value> {
    let text = std::fs::read_to_string(config_path(home)).expect("config.json must exist");
    let document: Value = serde_json::from_str(&text).expect("config.json must be valid JSON");
    as_object(
        &document["keyboardShortcuts"],
        "the on-disk keyboardShortcuts",
    )
}

fn loaded_shortcuts_object(loaded: &UserPreferences) -> Map<String, Value> {
    let value = serde_json::to_value(loaded.keyboard_shortcuts.clone())
        .expect("KeyboardShortcuts must serialise");
    as_object(&value, "the loaded keyboardShortcuts")
}

/// An object with every shortcut key present and set to `""` — the shape every
/// existing user's `config.json` is in today.
fn all_empty_shortcuts() -> Value {
    let mut object = Map::new();
    for key in defaults_via_serde_attributes().keys() {
        object.insert(key.clone(), Value::String(String::new()));
    }
    Value::Object(object)
}

/// An object with every shortcut key bound to a distinct, non-default,
/// non-empty accelerator — a user who has customised everything.
fn fully_customised_shortcuts() -> Value {
    let mut object = Map::new();
    for (index, key) in defaults_via_serde_attributes().keys().enumerate() {
        object.insert(key.clone(), Value::String(format!("Ctrl+Alt+F{index}")));
    }
    Value::Object(object)
}

// ---------------------------------------------------------------------------
// WI7-A — spot values (the human-legible RED anchor)
// ---------------------------------------------------------------------------

/// Four named fields with four literal values, each cross-checked at authoring
/// time against its `default_*()` function **and** against
/// `src/types/preferences.ts`'s `DEFAULT_KEYBOARD_SHORTCUTS`. That cross-check
/// is a note to the author, not an assertion — WI7-H is what turns it into one.
#[test]
fn wi7_a_default_trait_yields_the_documented_spot_accelerators() {
    let shortcuts = KeyboardShortcuts::default();
    assert_eq!(shortcuts.file_new, "Cmd+N");
    assert_eq!(shortcuts.file_save, "Cmd+S");
    assert_eq!(shortcuts.format_strong, "Cmd+B");
    assert_eq!(shortcuts.view_toggle_sidebar, "Cmd+Shift+L");
}

// ---------------------------------------------------------------------------
// WI7-B — Law: the two default mechanisms agree, field for field
// ---------------------------------------------------------------------------

/// The durable fence. A new shortcut field given a `#[serde(default = "…")]`
/// but forgotten in the manual `impl Default` — the exact recurrence this work
/// item exists to prevent — fails here and names itself in the message.
///
/// Renaming a `default_*()` function does **not** break this test (it breaks
/// compilation instead), which is the right sensitivity.
#[test]
fn wi7_b_default_trait_and_serde_attribute_defaults_are_equal() {
    let via_default = defaults_via_default_trait();
    let via_serde = defaults_via_serde_attributes();
    assert!(
        via_default == via_serde,
        "KeyboardShortcuts::default() and the #[serde(default = …)] attributes disagree:\n  {}",
        diff_report(&via_default, &via_serde, "Default", "serde")
    );
}

// ---------------------------------------------------------------------------
// WI7-C — no field of the default is the empty string
// ---------------------------------------------------------------------------

/// Quantified over every field by iterating the serialised object rather than
/// naming any field, so a hand-rolled `impl Default` that fills in only the
/// four fields WI7-A names and leaves 54 empty cannot pass.
#[test]
fn wi7_c_no_field_of_the_default_shortcuts_is_the_empty_string() {
    let object = defaults_via_default_trait();
    assert!(
        object.len() >= SHORTCUT_FIELD_COUNT,
        "expected at least {SHORTCUT_FIELD_COUNT} shortcut fields, found {} — a struct that \
         lost fields must not pass by having none left to check",
        object.len()
    );
    let offenders = empty_valued_keys(&object);
    assert!(
        offenders.is_empty(),
        "these shortcut defaults are the empty string: {offenders:?}"
    );
}

// ---------------------------------------------------------------------------
// WI7-D — first-run materialisation under a clean $HOME writes no empty binding
// ---------------------------------------------------------------------------

/// The assertion is made against the **file**, not the returned value: the
/// 58-empty-string `config.json` is the artefact the bug actually put on every
/// user's disk.
#[test]
fn wi7_d_first_run_materialisation_writes_no_empty_shortcut_to_disk() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("first_run");
    let _home_guard = set_home(&home);

    assert!(
        !config_path(&home).exists(),
        "config.json must not exist before the first load"
    );
    load_preferences().expect("first load must materialise defaults");
    assert!(
        config_path(&home).exists(),
        "the first load must create config.json"
    );

    let on_disk = shortcuts_on_disk(&home);
    assert!(
        on_disk.len() >= SHORTCUT_FIELD_COUNT,
        "the materialised keyboardShortcuts holds {} keys, expected at least \
         {SHORTCUT_FIELD_COUNT}",
        on_disk.len()
    );
    let offenders = empty_valued_keys(&on_disk);
    assert!(
        offenders.is_empty(),
        "the freshly materialised config.json holds empty shortcuts: {offenders:?}"
    );

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI7-E — D-b repair: `""` is unset on load, and a real binding survives
// ---------------------------------------------------------------------------

/// **The self-check case for WI-7.** The obvious wrong implementation — "if any
/// shortcut is empty, replace the whole group with defaults" — passes WI7-A,
/// WI7-C and WI7-D while silently destroying every customisation the user has.
/// Only this case fails it.
///
/// Recorded cost of decision D-b: a user can never deliberately unbind a
/// shortcut to nothing. That capability does not exist today; a future ADR
/// reversing D-b rewrites this case.
#[test]
fn wi7_e_empty_shortcuts_are_repaired_on_load_without_clobbering_real_bindings() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("repair_mixed");
    let _home_guard = set_home(&home);

    let mut shortcuts = as_object(&all_empty_shortcuts(), "the all-empty shortcut object");
    shortcuts.insert("fileNew".to_string(), json!("Cmd+Shift+N"));
    shortcuts.insert("formatStrong".to_string(), json!("Ctrl+B"));
    write_config_with_shortcuts(&home, &Value::Object(shortcuts));

    let loaded = load_preferences().expect("a config with empty shortcuts must still load");

    assert_eq!(
        loaded.keyboard_shortcuts.file_new, "Cmd+Shift+N",
        "a user's customised fileNew must be preserved, not repaired"
    );
    assert_eq!(
        loaded.keyboard_shortcuts.format_strong, "Ctrl+B",
        "a user's customised formatStrong must be preserved, not repaired"
    );

    let loaded_object = loaded_shortcuts_object(&loaded);
    let offenders = empty_valued_keys(&loaded_object);
    assert!(
        offenders.is_empty(),
        "these shortcuts were left empty after load: {offenders:?}"
    );

    // Every field the user did *not* customise equals its documented default.
    let expected = defaults_via_serde_attributes();
    let mut wrong: Vec<String> = Vec::new();
    for (key, default_value) in &expected {
        if key == "fileNew" || key == "formatStrong" {
            continue;
        }
        if loaded_object.get(key) != Some(default_value) {
            wrong.push(format!(
                "{key}: expected {default_value}, got {}",
                loaded_object.get(key).unwrap_or(&Value::Null)
            ));
        }
    }
    assert!(
        wrong.is_empty(),
        "empty shortcuts must be repaired to their documented defaults:\n  {}",
        wrong.join("\n  ")
    );

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI7-F — the repair is a fixed point, and the identity on a healthy config
// ---------------------------------------------------------------------------

/// Quantified over four config shapes: all-empty, mixed, fully customised, and
/// the default-materialised first run. For each, `load → save → load` must
/// reach the same shortcut object in one pass, and the fully-customised shape
/// must come back byte-for-byte as written.
#[test]
fn wi7_f_repair_is_idempotent_and_leaves_healthy_configs_untouched() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("idempotent");
    let _home_guard = set_home(&home);

    let mut mixed = as_object(&all_empty_shortcuts(), "the all-empty shortcut object");
    mixed.insert("fileSave".to_string(), json!("Cmd+Alt+S"));

    let shapes: Vec<(&str, Option<Value>)> = vec![
        ("all-empty", Some(all_empty_shortcuts())),
        ("mixed", Some(Value::Object(mixed))),
        ("fully-customised", Some(fully_customised_shortcuts())),
        ("default-materialised", None),
    ];

    for (label, shape) in shapes {
        let _ = std::fs::remove_dir_all(home.join(".mdpro"));
        if let Some(shortcuts) = &shape {
            write_config_with_shortcuts(&home, shortcuts);
        }

        let first = load_preferences().unwrap_or_else(|e| panic!("{label}: first load: {e:?}"));
        let first_object = loaded_shortcuts_object(&first);
        save_preferences(&first).unwrap_or_else(|e| panic!("{label}: save: {e:?}"));
        let second = load_preferences().unwrap_or_else(|e| panic!("{label}: second load: {e:?}"));
        let second_object = loaded_shortcuts_object(&second);

        assert!(
            first_object == second_object,
            "{label}: the repair is not a fixed point — a second load changed it:\n  {}",
            diff_report(&first_object, &second_object, "pass1", "pass2")
        );

        if label == "fully-customised" {
            let written = as_object(
                shape.as_ref().expect("the customised shape is present"),
                "the written shortcut object",
            );
            assert!(
                first_object == written,
                "{label}: the repair rewrote healthy user bindings:\n  {}",
                diff_report(&first_object, &written, "loaded", "written")
            );
        }
    }

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI7-G — the invariant, pinned on the persisted file after a real write
// ---------------------------------------------------------------------------

/// The class step 5 makes routine: the shortcuts panel sends the **whole**
/// `keyboardShortcuts` group through `set_preferences`, and WI-5's
/// wholesale-replacement merge means whatever it sends lands intact.
///
/// **The chosen invariant is branch (ii), load-side only**: decision D-b is a
/// load-time repair, so `""` *may* sit on disk and is substituted on every
/// read. This test asserts that exactly, rather than letting the stronger
/// write-side claim be true by silence. The doc comment on the repair in
/// `services/preferences.rs` states the same thing; a repair implemented in
/// `load_preferences` while the comment claims a file invariant is precisely
/// what this case forbids.
///
/// Read deliberately as raw text → `Value`. Reading it back through
/// `load_preferences` is the one thing this case must not do.
#[tokio::test]
// HOME_LOCK guards the process-global $HOME env var, so it cannot be released
// before the await.
#[allow(clippy::await_holding_lock)]
// Written as two field assignments on purpose: the point is "the default group
// with exactly two bindings blanked", which struct-update syntax would obscure.
#[allow(clippy::field_reassign_with_default)]
async fn wi7_g_a_whole_group_write_carrying_empty_strings_is_repaired_on_the_next_read() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("write_then_read");
    let _home_guard = set_home(&home);

    // Seed a healthy config: every shortcut a real accelerator.
    write_config_with_shortcuts(&home, &Value::Object(defaults_via_serde_attributes()));

    let mut sent = KeyboardShortcuts::default();
    sent.file_new = String::new();
    sent.format_strong = String::new();
    let result = set_preferences(PartialPreferences {
        keyboard_shortcuts: Some(sent),
        ..empty_partial()
    })
    .await;
    assert!(
        !matches!(result, Err(PreferencesError::IoError { .. })),
        "the write must not fail: {result:?}"
    );
    result.expect("set_preferences must succeed");

    // (a) Branch (ii) asserted on the file: the two empties reach the disk.
    let on_disk = shortcuts_on_disk(&home);
    assert_eq!(
        on_disk.get("fileNew"),
        Some(&json!("")),
        "branch (ii): an empty binding sent through set_preferences reaches the file unchanged"
    );
    assert_eq!(
        on_disk.get("formatStrong"),
        Some(&json!("")),
        "branch (ii): an empty binding sent through set_preferences reaches the file unchanged"
    );

    // (b) Every *other* shortcut on disk is exactly what was sent — the group
    // was not replaced by something else entirely — and is non-empty.
    let expected = defaults_via_serde_attributes();
    let mut wrong: Vec<String> = Vec::new();
    for (key, value) in &expected {
        if key == "fileNew" || key == "formatStrong" {
            continue;
        }
        match on_disk.get(key) {
            Some(actual) if actual == value => {}
            Some(actual) => wrong.push(format!("{key}: sent {value}, on disk {actual}")),
            None => wrong.push(format!("{key}: sent {value}, absent from the file")),
        }
    }
    assert!(
        wrong.is_empty(),
        "the untouched shortcuts must land on disk exactly as sent:\n  {}",
        wrong.join("\n  ")
    );

    // (c) The narrowing is itself pinned: the next read repairs both, and
    // disturbs nothing else.
    let reloaded = load_preferences().expect("reload after the write");
    assert_eq!(
        reloaded.keyboard_shortcuts.file_new, "Cmd+N",
        "the load-side repair must substitute the documented default for fileNew"
    );
    assert_eq!(
        reloaded.keyboard_shortcuts.format_strong, "Cmd+B",
        "the load-side repair must substitute the documented default for formatStrong"
    );
    let reloaded_object = loaded_shortcuts_object(&reloaded);
    assert!(
        reloaded_object == expected,
        "the reloaded group must equal the documented defaults and nothing else:\n  {}",
        diff_report(&reloaded_object, &expected, "reloaded", "defaults")
    );

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// WI7-H — Law: every shortcut default matches the shared fixture
// ---------------------------------------------------------------------------

/// WI7-A pins four values; before this case, 54 were pinned by nothing on
/// either side of the language boundary — and WI7-B compares Rust to Rust, so
/// it cannot see both mechanisms being wrong together. A `default_file_save()`
/// returning `"Cmd+Z"` passes every other case in this file and dies here.
///
/// The fixture block is `$`-prefixed, so WI-8's key-graph recursions skip it by
/// the single stated rule they already have: it is a sibling of the contract
/// document, not part of it. Its cross-language counterpart is WI8-F.
#[test]
fn wi7_h_every_shortcut_default_matches_the_shared_contract_fixture() {
    const FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/preferences-contract.json"
    );
    let text = std::fs::read_to_string(FIXTURE).unwrap_or_else(|e| {
        panic!("the shared contract fixture must be readable at {FIXTURE}: {e}")
    });
    let document: Value =
        serde_json::from_str(&text).expect("the contract fixture must be valid JSON");
    let fixture = as_object(
        &document["$defaultKeyboardShortcuts"],
        "the fixture's $defaultKeyboardShortcuts block",
    );
    let rust = defaults_via_default_trait();

    assert!(
        fixture == rust,
        "the shortcut defaults disagree with the shared fixture — if a default moved \
         deliberately, the same commit updates tests/fixtures/preferences-contract.json:\n  {}",
        diff_report(&fixture, &rust, "fixture", "rust")
    );
}
