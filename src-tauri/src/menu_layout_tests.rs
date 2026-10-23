//! M1A-WI-7: the Rust reader of `menu_layout.json`.
//! Matrix: .claude/tdd-guardian/tests-20261016-223726.md § M1A-WI-7,
//! "Unit: src-tauri/src/menu_layout.rs".

use super::*;
use crate::models::preferences::keyboard_shortcut_defaults::effective_image_shortcut;
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
fn pref_fields_and_host_v2_defaults_equal_keyboard_shortcuts_default() {
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
        let key = if cfg!(target_os = "macos") {
            &row.key.macos
        } else if cfg!(target_os = "windows") {
            &row.key.windows
        } else {
            &row.key.linux
        };
        assert_eq!(key.defaults.v2.as_deref(), Some(want), "{field} v2 on host");
    }
}

#[test]
fn image_layout_default_matches_shared_legacy_parity_rows() {
    let cases: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/legacy-image-shortcut-cases.json"
    ))
    .expect("image parity fixture");
    let rows = cases.as_array().expect("rows");
    let image = layout()
        .rows
        .iter()
        .find(|row| row.id == "format.image")
        .expect("Image row");
    for case in rows {
        let platform = case["platform"].as_str().expect("platform");
        let stored = case["stored"].as_str().expect("stored");
        let expected = case["expected"].as_str().expect("expected");
        assert_eq!(
            effective_image_shortcut(platform == "macos", stored),
            expected
        );
        if stored == "Cmd+Ctrl+I" || stored.is_empty() {
            let key = match platform {
                "macos" => &image.key.macos,
                "windows" => &image.key.windows,
                "linux" => &image.key.linux,
                _ => panic!("unknown platform"),
            };
            let expected_default = if stored.is_empty() {
                key.defaults.v2.as_deref()
            } else {
                key.defaults.v1.as_deref()
            };
            assert_eq!(expected_default, Some(expected));
        }
    }
}

#[test]
fn command_ids_are_unique() {
    let rows = &layout().rows;
    let ids: BTreeSet<&str> = rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(rows.len(), 79);
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
        assert_eq!(
            hides,
            usize::from(row.id == "app.hide"),
            "{} is rust-hide",
            row.id
        );
    }
    // Off-Mac Exit (2) and Stop Waiting and Quit (3) are the rust-owned routes.
    assert_eq!(counts.get("rust"), Some(&6));
}

#[test]
fn m1b_hide_is_keyless_rust_action_and_mac_window_has_one_close() {
    let hide = layout()
        .rows
        .iter()
        .find(|row| row.id == "app.hide")
        .unwrap();
    assert_eq!(hide.route.macos, MenuRoute::RustHide);
    assert_eq!(hide.key.macos.defaults.v2, None);
    assert!(matches!(hide.menu.windows, MenuPath::None(_)));
    assert!(matches!(hide.menu.linux, MenuPath::None(_)));

    let close = layout()
        .rows
        .iter()
        .find(|row| row.id == "window.closeWindow")
        .unwrap();
    assert!(matches!(close.menu.macos, MenuPath::None(_)));
    let file_close = layout()
        .rows
        .iter()
        .find(|row| row.id == "file.close")
        .unwrap();
    assert!(matches!(file_close.menu.macos, MenuPath::Path(_)));
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
