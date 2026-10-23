//! Review-round behavioral checks added after the M4-WI-2 RED receipt.

use super::*;
use crate::menu_layout::{menu_layout, Availability};
use crate::models::{KeyboardShortcuts, LogLevel, LogSettings, CURRENT_KEYBOARD_SHORTCUTS_VERSION};
use crate::services::applied_shortcuts::{resolve_applied, AppliedSource};
use crate::services::{logger, window_restore::test_home::TestHome};

fn defaults() -> AppliedShortcuts {
    AppliedShortcuts {
        keyboard_shortcuts_version: CURRENT_KEYBOARD_SHORTCUTS_VERSION,
        source: AppliedSource::Loaded,
        bindings: resolve_applied(&KeyboardShortcuts::default()),
    }
}

fn item<'a>(items: &'a [MenuItemSpec], id: &str) -> &'a MenuItemSpec {
    items.iter().find(|item| item.command_id == id).unwrap()
}

#[test]
fn m4_wi2_insert_table_descriptor_preserves_the_current_native_contract() {
    let items = menu_layout_for(menu_layout().unwrap(), &defaults(), Some(ViewMode::Wysiwyg));
    let table = item(&items, "paragraph.table");
    assert_eq!(table.menu_id.as_deref(), Some("menu.format.insert_table"));
    assert_eq!(table.path, ["Paragraph", "Table..."]);
    assert!(table.enabled);
    assert_eq!(table.accelerator.as_deref(), Some("Cmd+Shift+T"));
    let source_items = menu_layout_for(menu_layout().unwrap(), &defaults(), Some(ViewMode::Source));
    let source_table = item(&source_items, "paragraph.table");
    assert!(!source_table.enabled);
    assert_eq!(source_table.accelerator, None);
}

#[test]
fn m4_amendment12_one_layout_row_mutation_changes_only_its_descriptor() {
    let layout = menu_layout().unwrap();
    let original = menu_layout_for(layout, &defaults(), Some(ViewMode::Wysiwyg));
    let mut changed = layout.clone();
    let row = changed
        .rows
        .iter_mut()
        .find(|row| row.id == "format.strong")
        .unwrap();
    row.menu.macos = MenuPath::Path(vec!["Format".into(), "Bold variant".into()]);
    row.menu_id = Some("menu.format.bold_variant".into());
    let updated = menu_layout_for(&changed, &defaults(), Some(ViewMode::Wysiwyg));
    let before = item(&original, "format.strong");
    let after = item(&updated, "format.strong");
    assert_eq!(before.path, ["Format", "Bold"]);
    assert_eq!(after.path, ["Format", "Bold variant"]);
    assert_eq!(after.menu_id.as_deref(), Some("menu.format.bold_variant"));
    assert_eq!(after.enabled, before.enabled);
    assert_eq!(after.accelerator, before.accelerator);
    for (before, after) in original.iter().zip(updated.iter()) {
        if before.command_id != "format.strong" {
            assert_eq!(after, before, "{} changed unexpectedly", before.command_id);
        }
    }
}

#[test]
fn m4_wi2_each_eligible_pair_uses_one_full_snapshot_resolution() {
    let layout = menu_layout().unwrap();
    let rows: Vec<_> = layout
        .rows
        .iter()
        .filter(|row| {
            matches!(row.menu.macos, MenuPath::Path(_))
                && row.pref_field.is_some()
                && row.availability.macos.v2 != Availability::None
        })
        .collect();
    let mut checked = 0;
    for (index, first) in rows.iter().enumerate() {
        for second in rows.iter().skip(index + 1) {
            if !first
                .contexts
                .iter()
                .any(|context| second.contexts.contains(context))
            {
                continue;
            }
            let mut applied = defaults();
            for row in [first, second] {
                applied.bindings.insert(
                    row.pref_field.as_ref().unwrap().clone(),
                    AppliedBinding::Bound {
                        chord: "Cmd+Ctrl+Shift+9".into(),
                    },
                );
            }
            let mode = if [first, second].iter().all(|row| {
                matches!(
                    row.availability.macos.v2,
                    Availability::Both | Availability::W
                )
            }) {
                ViewMode::Wysiwyg
            } else if [first, second].iter().all(|row| {
                matches!(
                    row.availability.macos.v2,
                    Availability::Both | Availability::S
                )
            }) {
                ViewMode::Source
            } else {
                continue;
            };
            let rendered = menu_layout_for(layout, &applied, Some(mode));
            for row in [first, second] {
                assert_eq!(
                    item(&rendered, &row.id).accelerator,
                    None,
                    "{} with {}",
                    first.id,
                    second.id
                );
            }
            applied.bindings.insert(
                first.pref_field.as_ref().unwrap().clone(),
                AppliedBinding::Unassigned,
            );
            let after = menu_layout_for(layout, &applied, Some(mode));
            assert_eq!(item(&after, &first.id).accelerator, None);
            assert_eq!(
                item(&after, &second.id).accelerator.as_deref(),
                Some("Cmd+Ctrl+Shift+9"),
                "{} after {} unassigned",
                second.id,
                first.id
            );
            checked += 1;
        }
    }
    assert!(checked > 10, "only {checked} eligible pairs");
}

#[test]
fn m4_wi2_native_constructor_receives_the_descriptors_exactly() {
    let specs = menu_layout_for(menu_layout().unwrap(), &defaults(), Some(ViewMode::Wysiwyg));
    let mut count = 0;
    for spec in specs.iter().filter(|spec| spec.menu_id.is_some()) {
        let id = spec.menu_id.as_deref().unwrap();
        let (native_id, native_title, native_enabled, native_accel) =
            native_parts(&specs, id).unwrap();
        assert_eq!(native_id, id);
        assert_eq!(native_title, spec.path.last().unwrap());
        assert_eq!(native_enabled, spec.enabled);
        assert_eq!(native_accel, spec.accelerator.as_deref());
        count += 1;
    }
    assert!(count >= 18, "only {count} native item ids");
    let source = include_str!("menu_from_layout.rs");
    assert!(source.contains("native_parts(specs, menu_id)?"));
    assert!(source.contains("MenuItem::with_id(app, id, title, enabled, accelerator)"));
    assert!(
        source.contains("CheckMenuItem::with_id(app, id, title, enabled, checked, accelerator)")
    );
}

#[test]
fn m4_wi2_one_malformed_applied_chord_logs_one_enum_only_drop() {
    let home = TestHome::new("m4_bad_native_chord_log");
    let old = logger::get_log_settings();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    let mut applied = defaults();
    applied.bindings.insert(
        "fileNew".into(),
        AppliedBinding::Bound {
            chord: "not-a-secret-key".into(),
        },
    );
    let specs = menu_layout_for(menu_layout().unwrap(), &applied, Some(ViewMode::Wysiwyg));
    logger::set_log_settings(old);
    assert_eq!(item(&specs, "file.new").accelerator, None);
    let text = std::fs::read_to_string(home.dir.join(".mdpro/mdpro.log")).unwrap();
    let lines: Vec<_> = text
        .lines()
        .filter(|line| line.contains("ui.menu.accelerator") && line.contains("file.new"))
        .collect();
    assert_eq!(lines.len(), 1);
    let entry: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(entry["status"], "cancel");
    assert_eq!(entry["context"]["reason"], "unparseable");
    assert!(!lines[0].contains("not-a-secret-key"));
}

#[test]
fn m4_wi1_extracted_edit_and_format_keep_the_baseline_order_and_properties() {
    let edit = include_str!("menu_edit.rs")
        .split("    SubmenuBuilder::new(app, \"Edit\")")
        .last()
        .unwrap();
    let format = include_str!("menu_format.rs")
        .split("    let format_highlight")
        .last()
        .unwrap();
    let paragraph = include_str!("menu_paragraph.rs");
    let root = include_str!("menu.rs");
    let ordered = |source: &str, tokens: &[&str]| {
        let positions: Vec<_> = tokens
            .iter()
            .map(|token| source.find(token).unwrap())
            .collect();
        assert!(
            positions.windows(2).all(|pair| pair[0] < pair[1]),
            "{tokens:?}"
        );
    };
    ordered(
        edit,
        &[
            ".item(&PredefinedMenuItem::undo",
            ".item(&PredefinedMenuItem::redo",
            ".item(&PredefinedMenuItem::cut",
            ".item(&PredefinedMenuItem::copy",
            ".item(&PredefinedMenuItem::paste",
            ".item(&PredefinedMenuItem::select_all",
        ],
    );
    assert_eq!(edit.matches(".separator()").count(), 2);
    ordered(
        format,
        &[".item(&format_highlight)", ".item(&format_insert_table)"],
    );
    assert_eq!(format.matches(".separator()").count(), 0);
    ordered(
        root,
        &[
            "menu.append(&app_menu)",
            "menu.append(&file_menu)",
            "menu.append(&edit_menu)",
            "menu.append(&format_menu)",
            "menu.append(&view_menu)",
            "menu.append(&theme_menu)",
            "menu.append(&window_menu)",
            "menu.append(&help_menu)",
        ],
    );

    let layout = crate::menu_layout::menu_layout().unwrap();
    let applied = crate::services::applied_shortcuts::AppliedShortcuts {
        keyboard_shortcuts_version: CURRENT_KEYBOARD_SHORTCUTS_VERSION,
        source: crate::services::applied_shortcuts::AppliedSource::Loaded,
        bindings: crate::services::applied_shortcuts::resolve_applied(
            &crate::models::KeyboardShortcuts::default(),
        ),
    };
    let specs = menu_layout_for(layout, &applied, Some(ViewMode::Wysiwyg));
    let table = specs
        .iter()
        .find(|item| item.command_id == "paragraph.table")
        .unwrap();
    let highlight = specs
        .iter()
        .find(|item| item.command_id == "format.highlight")
        .unwrap();
    assert_eq!(table.path, ["Paragraph", "Table..."]);
    assert_eq!(
        table.menu_id.as_deref(),
        Some(super::super::MENU_FORMAT_INSERT_TABLE)
    );
    assert_eq!(table.accelerator.as_deref(), Some("Cmd+Shift+T"));
    assert_eq!(highlight.path, ["Format", "Highlight Selection"]);
    assert_eq!(
        highlight.menu_id.as_deref(),
        Some(super::super::MENU_FORMAT_HIGHLIGHT)
    );
    assert_eq!(highlight.accelerator.as_deref(), Some("Cmd+Shift+M"));
    assert!(paragraph.contains("CmdOrCtrl+Shift+T"));
    assert!(format.contains("CmdOrCtrl+Shift+M"));
}

#[test]
fn m4_wi5_new_editor_menu_ids_are_guarded_and_targeted_once() {
    let layout = menu_layout().unwrap();
    let mut checked = 0;
    for row in layout.rows.iter().filter(|row| {
        matches!(row.menu.macos, MenuPath::Path(_))
            && row.menu_id.is_some()
            && matches!(
                row.id.split('.').next(),
                Some("edit" | "paragraph" | "format")
            )
            && !matches!(row.id.as_str(), "paragraph.table" | "format.highlight")
    }) {
        let action = format!("editor.{}", row.id);
        assert_eq!(
            editor_action_for_menu_id(layout, row.menu_id.as_deref().unwrap()),
            Some(action.clone()),
            "{} must resolve from the native id",
            row.id
        );
        let mut targets = Vec::new();
        let mode = if row.availability.macos.v2 == Availability::S {
            ViewMode::Source
        } else {
            ViewMode::Wysiwyg
        };
        let result = super::super::menu_availability::dispatch_if_allowed(
            layout,
            &action,
            "window-a",
            Some("window-a"),
            Some(mode),
            |target| {
                targets.push(target.to_string());
                Ok(())
            },
        );
        if row.availability.macos.v2 == Availability::None {
            assert!(result.is_err(), "{} must be refused", row.id);
            assert!(targets.is_empty(), "{} emitted while unavailable", row.id);
        } else {
            assert!(result.is_ok(), "{} must be allowed", row.id);
            assert_eq!(targets, ["window-a"], "{} must target once", row.id);
        }
        checked += 1;
    }
    assert!(checked > 20, "new menu coverage is vacuous: {checked}");
    assert_eq!(editor_action_for_menu_id(layout, "menu.unknown"), None);
    assert_eq!(
        editor_action_for_menu_id(layout, "menu.format.insert_table"),
        None
    );
    assert_eq!(
        editor_action_for_menu_id(layout, "menu.format.highlight"),
        None
    );
    let root = include_str!("menu.rs");
    assert!(
        root.contains("menu_from_layout::editor_action_for_menu_id"),
        "the native click handler must resolve new table ids to editor actions"
    );
}
