use super::*;
use crate::menu_layout::{menu_layout, MenuPath, Platform};
use crate::models::{KeyboardShortcuts, LogLevel, LogSettings};
use crate::services::applied_shortcuts::{
    resolve_applied, AppliedBinding, AppliedShortcuts, AppliedSource,
};
use crate::services::binding_conflicts::{resolve_bindings, Resolution, SuppressReason};
use crate::services::{logger, window_restore::test_home::TestHome};

fn defaults() -> AppliedShortcuts {
    AppliedShortcuts {
        keyboard_shortcuts_version: 1,
        source: AppliedSource::Loaded,
        bindings: resolve_applied(&KeyboardShortcuts::default()),
    }
}

fn item<'a>(items: &'a [MenuItemSpec], command_id: &str) -> &'a MenuItemSpec {
    assert!(
        items.iter().any(|item| item.command_id == command_id),
        "missing descriptor for {command_id}"
    );
    items
        .iter()
        .find(|item| item.command_id == command_id)
        .unwrap()
}

#[test]
fn m4_wi2_default_v1_descriptors_follow_every_macos_row() {
    let layout = menu_layout().unwrap();
    let items = menu_layout_for(layout, &defaults(), Some(ViewMode::Wysiwyg));
    let rows: Vec<_> = layout
        .rows
        .iter()
        .filter(|row| matches!(row.menu.macos, MenuPath::Path(_)))
        .collect();
    assert_eq!(items.len(), rows.len());
    for row in rows {
        let actual = item(&items, &row.id);
        assert_eq!(
            actual.menu_id.as_deref(),
            row.menu_id.as_deref(),
            "{}",
            row.id
        );
        assert_eq!(
            actual.path,
            match &row.menu.macos {
                MenuPath::Path(path) => path.clone(),
                MenuPath::None(_) => unreachable!(),
            },
            "{}",
            row.id
        );
    }
    assert_eq!(
        item(&items, "file.new").accelerator.as_deref(),
        Some("Cmd+N")
    );
    assert_eq!(
        item(&items, "file.save").accelerator.as_deref(),
        Some("Cmd+S")
    );
    assert_eq!(
        item(&items, "view.source").accelerator.as_deref(),
        Some("Ctrl+2")
    );
}

#[test]
fn m4_wi2_custom_snapshot_moves_save_key() {
    let layout = menu_layout().unwrap();
    let baseline = menu_layout_for(layout, &defaults(), Some(ViewMode::Wysiwyg));
    let mut applied = defaults();
    applied.bindings.insert(
        "fileSave".into(),
        AppliedBinding::Bound {
            chord: "Cmd+Shift+T".into(),
        },
    );
    let custom = menu_layout_for(layout, &applied, Some(ViewMode::Wysiwyg));
    assert_eq!(
        item(&custom, "file.save").accelerator.as_deref(),
        Some("Cmd+Shift+T")
    );
    assert_eq!(
        item(&custom, "file.new").accelerator,
        item(&baseline, "file.new").accelerator
    );
}

#[test]
fn m4_wi2_valid_save_on_undo_chord_is_suppressed() {
    let mut applied = defaults();
    applied.bindings.insert(
        "fileSave".into(),
        AppliedBinding::Bound {
            chord: "Cmd+Z".into(),
        },
    );
    let stored = applied
        .bindings
        .iter()
        .filter_map(|(field, binding)| match binding {
            AppliedBinding::Bound { chord } => Some((field.clone(), chord.clone())),
            AppliedBinding::Unassigned => Some((field.clone(), "<unassigned>".into())),
            AppliedBinding::System => Some((field.clone(), "<system>".into())),
        })
        .collect();
    assert!(matches!(
        resolve_bindings(Platform::Macos, 1, &stored)
            .unwrap()
            .get("fileSave"),
        Some(Resolution::Suppressed {
            reason: SuppressReason::Native,
            ..
        })
    ));
    let items = menu_layout_for(menu_layout().unwrap(), &applied, Some(ViewMode::Wysiwyg));
    assert_eq!(item(&items, "file.save").accelerator, None);
    assert_eq!(
        item(&items, "edit.undo").accelerator.as_deref(),
        Some("Cmd+Z")
    );
}

#[test]
fn m4_wi2_unassigned_and_bad_chord_are_keyless_and_bad_value_is_not_logged() {
    let home = TestHome::new("m4_bad_chord");
    let old = logger::get_log_settings();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    let mut applied = defaults();
    applied
        .bindings
        .insert("fileSave".into(), AppliedBinding::Unassigned);
    applied.bindings.insert(
        "fileNew".into(),
        AppliedBinding::Bound {
            chord: "invalid-chord-secret".into(),
        },
    );
    let items = menu_layout_for(menu_layout().unwrap(), &applied, Some(ViewMode::Wysiwyg));
    logger::set_log_settings(old);
    assert_eq!(item(&items, "file.save").accelerator, None);
    assert_eq!(item(&items, "file.new").accelerator, None);
    let log = std::fs::read_to_string(home.dir.join(".mdpro/mdpro.log")).unwrap_or_default();
    assert!(log.contains("ui.menu.accelerator"));
    assert!(!log.contains("invalid-chord-secret"));
}

#[test]
fn m4_wi2_reserved_defaults_are_keyless_when_rows_gain_paths() {
    let mut layout = menu_layout().unwrap().clone();
    for (id, name) in [
        ("paragraph.quote", "Quote"),
        ("view.switchDocuments", "Switch Documents"),
        ("view.toggleFullscreen", "Toggle Fullscreen"),
    ] {
        let row = layout.rows.iter_mut().find(|row| row.id == id).unwrap();
        row.menu.macos = MenuPath::Path(vec!["Injected".into(), name.into()]);
        row.menu_id = Some(format!("menu.synthetic.{id}"));
    }
    let items = menu_layout_for(&layout, &defaults(), Some(ViewMode::Wysiwyg));
    for id in [
        "paragraph.quote",
        "view.switchDocuments",
        "view.toggleFullscreen",
    ] {
        assert_eq!(item(&items, id).accelerator, None, "{id}");
    }
    assert_eq!(
        item(&items, "file.new").accelerator.as_deref(),
        Some("Cmd+N")
    );
}

#[test]
fn m4_wi2_reserved_chords_stay_keyless_even_when_items_are_available() {
    let mut layout = menu_layout().unwrap().clone();
    for id in ["paragraph.quote", "view.switchDocuments"] {
        let row = layout.rows.iter_mut().find(|row| row.id == id).unwrap();
        row.menu.macos = MenuPath::Path(vec!["Injected".into(), id.into()]);
        row.menu_id = Some(format!("menu.synthetic.{id}"));
        row.availability.macos.v1 = crate::menu_layout::Availability::Both;
    }
    let items = menu_layout_for(&layout, &defaults(), Some(ViewMode::Wysiwyg));
    for id in ["paragraph.quote", "view.switchDocuments"] {
        let spec = item(&items, id);
        assert!(spec.enabled, "{id}");
        assert_eq!(spec.accelerator, None, "{id}");
    }
    assert_eq!(
        item(&items, "file.new").accelerator.as_deref(),
        Some("Cmd+N")
    );
}

#[test]
fn m4_wi2_duplicate_customs_resolve_as_one_snapshot() {
    let layout = menu_layout().unwrap();
    let mut applied = defaults();
    for field in ["fileNew", "fileSave"] {
        applied.bindings.insert(
            field.into(),
            AppliedBinding::Bound {
                chord: "Cmd+Shift+T".into(),
            },
        );
    }
    let duplicate = menu_layout_for(layout, &applied, Some(ViewMode::Wysiwyg));
    assert_eq!(item(&duplicate, "file.new").accelerator, None);
    assert_eq!(item(&duplicate, "file.save").accelerator, None);
    applied
        .bindings
        .insert("fileNew".into(), AppliedBinding::Unassigned);
    let resolved = menu_layout_for(layout, &applied, Some(ViewMode::Wysiwyg));
    assert_eq!(item(&resolved, "file.new").accelerator, None);
    assert_eq!(
        item(&resolved, "file.save").accelerator.as_deref(),
        Some("Cmd+Shift+T")
    );
}

#[test]
fn m4_wi2_review_native_shifted_symbol_uses_a_parseable_physical_key() {
    let mut applied = defaults();
    applied.bindings.insert(
        "viewSource".into(),
        AppliedBinding::Bound {
            chord: "Cmd+Ctrl+Shift+!".into(),
        },
    );
    let items = menu_layout_for(menu_layout().unwrap(), &applied, Some(ViewMode::Wysiwyg));
    assert_eq!(
        item(&items, "view.source").accelerator.as_deref(),
        Some("Cmd+Ctrl+Shift+Digit1")
    );
}

#[test]
fn m4_wi2_review_f_keys_keep_bare_and_modified_forms_and_reject_f13() {
    let layout = menu_layout().unwrap();
    for (stored, expected) in [
        ("F5", Some("F5")),
        ("Shift+F5", Some("Shift+F5")),
        ("F13", None),
    ] {
        let mut applied = defaults();
        applied.bindings.insert(
            "viewSource".into(),
            AppliedBinding::Bound {
                chord: stored.into(),
            },
        );
        let items = menu_layout_for(layout, &applied, Some(ViewMode::Wysiwyg));
        assert_eq!(
            item(&items, "view.source").accelerator.as_deref(),
            expected,
            "{stored}"
        );
    }
}
