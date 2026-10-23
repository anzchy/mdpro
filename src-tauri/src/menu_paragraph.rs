//! Purpose: build the macOS Paragraph menu from command-layout item specs.
//! The existing Insert Table id remains shared with off-Mac Format.
//!
//! @coordinates-with src-tauri/src/menu_format.rs
//! @coordinates-with src-tauri/src/menu_from_layout.rs

use tauri::menu::{MenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Wry};

use super::{menu_from_layout, MENU_FORMAT_INSERT_TABLE};

/// macOS Paragraph tree. The ordered ids only place rows; their native item
/// properties still come from the same layout specs as the descriptor tests.
pub(super) fn paragraph_menu(
    app: &AppHandle<Wry>,
    specs: &[menu_from_layout::MenuItemSpec],
) -> tauri::Result<Submenu<Wry>> {
    let item = |id| menu_from_layout::menu_item_or(app, Some(specs), id, "", false, None);
    let mut menu = SubmenuBuilder::new(app, "Paragraph");
    for id in [
        "menu.paragraph.heading1",
        "menu.paragraph.heading2",
        "menu.paragraph.heading3",
        "menu.paragraph.heading4",
        "menu.paragraph.heading5",
        "menu.paragraph.heading6",
    ] {
        menu = menu.item(&item(id)?);
    }
    menu = menu.item(&item("menu.paragraph.paragraph")?).separator();
    menu = menu
        .item(&item("menu.paragraph.increase_heading")?)
        .item(&item("menu.paragraph.decrease_heading")?)
        .separator()
        .item(&item(MENU_FORMAT_INSERT_TABLE)?)
        .item(&item("menu.paragraph.code_fences")?)
        .item(&item("menu.paragraph.math_block")?)
        .item(&item("menu.paragraph.quote")?)
        .separator()
        .item(&item("menu.paragraph.ordered_list")?)
        .item(&item("menu.paragraph.unordered_list")?)
        .separator()
        .item(&item("menu.paragraph.indent")?)
        .item(&item("menu.paragraph.outdent")?);
    menu.build()
}

pub(super) fn insert_table_item(
    app: &AppHandle<Wry>,
    enabled: bool,
    specs: Option<&[menu_from_layout::MenuItemSpec]>,
) -> tauri::Result<MenuItem<Wry>> {
    menu_from_layout::menu_item_or(
        app,
        specs,
        MENU_FORMAT_INSERT_TABLE,
        "Insert Table",
        enabled,
        Some("CmdOrCtrl+Shift+T"),
    )
}
