//! Purpose: the existing Insert Table item shared with the future Paragraph
//! menu, while it remains under Format until M4-WI-4.
//!
//! @coordinates-with src-tauri/src/menu_format.rs

use tauri::menu::MenuItem;
use tauri::{AppHandle, Wry};

use super::MENU_FORMAT_INSERT_TABLE;

pub(super) fn insert_table_item(
    app: &AppHandle<Wry>,
    enabled: bool,
) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(
        app,
        MENU_FORMAT_INSERT_TABLE,
        "Insert Table",
        enabled,
        Some("CmdOrCtrl+Alt+T"),
    )
}
