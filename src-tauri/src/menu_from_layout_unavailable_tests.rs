//! M4-WI-5: stale native clicks on disabled non-editor rows never emit.

use super::*;
use crate::menu_layout::menu_layout;
use std::collections::BTreeMap;

#[test]
fn m4_known_disabled_ids_reach_one_refusal_and_no_emit() {
    let layout = menu_layout().unwrap();
    assert_eq!(
        unavailable_action_for_menu_id(layout, "menu.view.switch_documents"),
        None
    );
    assert_eq!(
        unavailable_action_for_menu_id(layout, "menu.file.save_as"),
        None
    );
    assert_eq!(unavailable_action_for_menu_id(layout, "menu.unknown"), None);
}

#[test]
fn m4_every_macos_custom_id_has_one_production_route() {
    let layout = menu_layout().unwrap();
    let static_routes: BTreeMap<&str, (&str, &str)> = [
        ("menu.file.new", "MENU_FILE_NEW", "file.new"),
        (
            "menu.file.new_window",
            "MENU_FILE_NEW_WINDOW",
            "file.new_window",
        ),
        ("menu.file.open", "MENU_FILE_OPEN", "file.open"),
        ("menu.file.save", "MENU_FILE_SAVE", "file.save"),
        ("menu.file.save_as", "MENU_FILE_SAVE_AS", "file.save_as"),
        ("menu.file.close", "MENU_FILE_CLOSE", "file.close"),
        (
            "menu.file.export_html",
            "MENU_FILE_EXPORT_HTML",
            "file.export_html",
        ),
        (
            "menu.file.preferences",
            "MENU_FILE_PREFERENCES",
            "file.preferences",
        ),
        ("menu.view.cycle", "MENU_VIEW_CYCLE", "cycle-view-mode"),
        ("menu.view.source", "MENU_VIEW_SOURCE", "set-view-mode"),
        ("menu.view.wysiwyg", "MENU_VIEW_WYSIWYG", "set-view-mode"),
        (
            "menu.view.toggle_sidebar",
            "MENU_VIEW_TOGGLE_SIDEBAR",
            "view.toggle_sidebar",
        ),
        (
            "menu.view.switch_documents",
            "MENU_VIEW_SWITCH_DOCUMENTS",
            "view.switch_documents",
        ),
        (
            "menu.format.highlight",
            "MENU_FORMAT_HIGHLIGHT",
            "format.highlight",
        ),
        (
            "menu.format.insert_table",
            "MENU_FORMAT_INSERT_TABLE",
            "paragraph.table",
        ),
        ("menu.theme.light", "MENU_THEME_LIGHT", "theme.light"),
        ("menu.theme.dark", "MENU_THEME_DARK", "theme.dark"),
        ("menu.theme.system", "MENU_THEME_SYSTEM", "theme.system"),
        (
            "menu.help.keyboard_shortcuts",
            "MENU_HELP_KEYBOARD_SHORTCUTS",
            "file.preferences",
        ),
    ]
    .into_iter()
    .map(|(id, name, action)| (id, (name, action)))
    .collect();
    let source = include_str!("menu.rs")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut checked = 0;
    for row in layout
        .rows
        .iter()
        .filter(|row| matches!(row.menu.macos, MenuPath::Path(_)))
    {
        let Some(id) = row.menu_id.as_deref() else {
            continue;
        };
        if let Some(action) = editor_action_for_menu_id(layout, id) {
            assert_eq!(action, format!("editor.{}", row.id));
        } else if let Some(action) = unavailable_action_for_menu_id(layout, id) {
            assert_eq!(action, row.id);
        } else if let Some((name, action)) = static_routes.get(id) {
            let marker = format!("{name} =>");
            assert_eq!(source.matches(&marker).count(), 1, "{id} must have one arm");
            let tail = &source[source.find(&marker).unwrap()..];
            let arm = &tail[..tail.find(" MENU_").unwrap_or(tail.len())];
            assert!(
                arm.contains(&format!("\"{action}\"")),
                "{id} routes incorrectly: {arm}"
            );
        } else if id == "menu.app.hide" {
            assert!(source.contains("MENU_APP_HIDE => hide_app(app)"));
        } else if id == "menu.app.quit" || id == "menu.app.stop_waiting_quit" {
            assert!(source.contains("MENU_APP_QUIT => request_guarded_quit"));
            assert!(source.contains("MENU_APP_STOP_WAITING_QUIT =>"));
        } else {
            panic!("unclassified native menu id {id}");
        }
        checked += 1;
    }
    assert!(checked >= 50, "only {checked} custom ids checked");
    assert!(source.find("editor_action_for_menu_id").unwrap() < source.find("match id {").unwrap());
    assert!(source.contains("strip_prefix(MENU_FILE_RECENT_PREFIX)"));
}
