//! Purpose: the Edit submenu builder, separated from the native menu root.
//!
//! @coordinates-with src-tauri/src/menu.rs

use tauri::menu::{PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Wry};

pub(super) fn edit_menu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()
}
