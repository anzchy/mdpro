//! Purpose: the existing Insert Table item shared with the future Paragraph
//! menu, while it remains under Format until M4-WI-4.
//!
//! @coordinates-with src-tauri/src/menu_format.rs
//! @coordinates-with src-tauri/src/menu_from_layout.rs

use tauri::menu::MenuItem;
use tauri::{AppHandle, Wry};

use super::{menu_from_layout, MENU_FORMAT_INSERT_TABLE};

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
        Some("CmdOrCtrl+Alt+T"),
    )
}
