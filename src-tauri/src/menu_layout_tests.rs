//! M1A-WI-7: the Rust reader of `menu_layout.json`.
//! Matrix: .claude/tdd-guardian/tests-20261016-223726.md § M1A-WI-7,
//! "Unit: src-tauri/src/menu_layout.rs".

use super::*;
use crate::models::KeyboardShortcuts;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

fn per_platform<T>(p: &PerPlatform<T>) -> [(&'static str, &T); 3] {
    [
        ("macos", &p.macos),
        ("windows", &p.windows),
        ("linux", &p.linux),
    ]
}

fn layout() -> &'static MenuLayout {
    menu_layout().expect("the committed menu_layout.json parses")
}

/// The committed file with the first `from` replaced by `to`.
fn mutated(from: &str, to: &str) -> String {
    assert!(MENU_LAYOUT_JSON.contains(from), "{from} is in the file");
    MENU_LAYOUT_JSON.replacen(from, to, 1)
}

#[test]
fn round_trip_through_the_struct_loses_nothing() {
    let expected: Value = serde_json::from_str(MENU_LAYOUT_JSON).expect("valid JSON");
    assert!(expected.get("$generated").is_some_and(Value::is_string));
    assert_eq!(
        serde_json::to_value(layout()).expect("serialises"),
        expected
    );
}

#[test]
fn pref_fields_and_v1_defaults_equal_keyboard_shortcuts_default() {
    let defaults = serde_json::to_value(KeyboardShortcuts::default()).expect("serialises");
    let defaults = defaults.as_object().expect("an object");
    let mut by_field: BTreeMap<&str, &CommandRow> = BTreeMap::new();
    for row in &layout().rows {
        if let Some(field) = row.pref_field.as_deref() {
            assert!(by_field.insert(field, row).is_none(), "{field} twice");
        }
    }
    let fields: BTreeSet<&str> = by_field.keys().copied().collect();
    let expected: BTreeSet<&str> = defaults.keys().map(String::as_str).collect();
    assert_eq!(fields.len(), 58);
    assert_eq!(fields, expected);
    for (field, row) in &by_field {
        let want = defaults[*field].as_str().expect("a string default");
        for (platform, key) in per_platform(&row.key) {
            assert_eq!(
                key.defaults.v1.as_deref(),
                Some(want),
                "{field} v1 on {platform}"
            );
        }
    }
}

#[test]
fn command_ids_are_unique() {
    let rows = &layout().rows;
    let ids: BTreeSet<&str> = rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(rows.len(), 78);
    assert_eq!(ids.len(), rows.len());
}

#[test]
fn rust_hide_count_is_pinned_and_never_off_mac() {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for row in &layout().rows {
        for (platform, route) in per_platform(&row.route) {
            if *route == MenuRoute::RustHide {
                assert_eq!(platform, "macos", "{} is rust-hide off-Mac", row.id);
            }
            *counts.entry(route.log_owner()).or_default() += 1;
        }
        let hides = per_platform(&row.route)
            .iter()
            .filter(|(_, r)| **r == MenuRoute::RustHide)
            .count();
        // Hide mdpro is the predefined native item today; D13 moves it to
        // rust-hide in M1b, which re-pins this count.
        assert_eq!(hides, 0, "{} is rust-hide", row.id);
    }
    // Off-Mac Exit (2) and Stop Waiting and Quit (3) are the rust-owned routes.
    assert_eq!(counts.get("rust"), Some(&5));
}

#[test]
fn unknown_route_field_and_top_level_key_are_rejected() {
    assert!(parse_menu_layout(MENU_LAYOUT_JSON).is_ok());
    let route = parse_menu_layout(&mutated("\"rust-quit\"", "\"rust-exit\""));
    assert!(route.expect_err("rust-exit").contains("rust-exit"));
    let field = parse_menu_layout(&mutated("\"id\": ", "\"bogus\": 1, \"id\": "));
    assert!(field.expect_err("bogus").contains("bogus"));
    let top = parse_menu_layout(&mutated("\"$generated\"", "\"$generatedX\""));
    assert!(top.expect_err("$generatedX").contains("$generatedX"));
}

#[test]
fn log_owner_per_variant() {
    let all = [
        MenuRoute::Frontend,
        MenuRoute::Native,
        MenuRoute::RustQuit,
        MenuRoute::RustHide,
        MenuRoute::Unavailable,
    ];
    for route in all {
        // SD12, restated with no `_` arm so a new variant fails to compile here.
        let (want, wire) = match route {
            MenuRoute::Frontend => ("frontend", "frontend"),
            MenuRoute::Native => ("native", "native"),
            MenuRoute::RustQuit => ("rust", "rust-quit"),
            MenuRoute::RustHide => ("rust", "rust-hide"),
            MenuRoute::Unavailable => ("frontend", "unavailable"),
        };
        assert_eq!(route.log_owner(), want);
        assert_eq!(serde_json::to_value(route).expect("serialises"), wire);
    }
}

#[test]
fn menu_layout_is_parsed_once_and_cached() {
    let first = layout();
    let second = layout();
    assert!(std::ptr::eq(first, second));
}

#[test]
fn an_unknown_field_inside_a_disposition_is_rejected() {
    let from = "\"disposition\": {\n        \"kind\": \"editorOwned\"";
    let to = "\"disposition\": {\n        \"bogus\": 1,\n        \"kind\": \"editorOwned\"";
    let err = parse_menu_layout(&mutated(from, to)).expect_err("bogus in a disposition");
    assert!(err.contains("bogus"), "{err}");
}
