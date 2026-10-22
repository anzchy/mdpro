//! Purpose: the Format submenu builder, separated from the native menu root.
//!
//! @coordinates-with src-tauri/src/menu.rs
//! @coordinates-with src-tauri/src/menu_paragraph.rs

use tauri::menu::{MenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Wry};

use super::{menu_paragraph, MENU_FORMAT_HIGHLIGHT};

pub(super) fn format_menu(
    app: &AppHandle<Wry>,
    table_enabled: bool,
) -> tauri::Result<Submenu<Wry>> {
    let format_highlight = MenuItem::with_id(
        app,
        MENU_FORMAT_HIGHLIGHT,
        "Highlight Selection",
        true,
        Some("CmdOrCtrl+Shift+H"),
    )?;
    let format_insert_table = menu_paragraph::insert_table_item(app, table_enabled)?;
    SubmenuBuilder::new(app, "Format")
        .item(&format_highlight)
        .item(&format_insert_table)
        .build()
}
