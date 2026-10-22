//! Purpose: the Edit submenu builder, separated from the native menu root.
//!
//! @coordinates-with src-tauri/src/menu.rs

use tauri::menu::{PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Wry};

use super::menu_from_layout::{self, MenuItemSpec};

pub(super) fn edit_menu(
    app: &AppHandle<Wry>,
    specs: Option<&[MenuItemSpec]>,
) -> tauri::Result<Submenu<Wry>> {
    if let Some(specs) = specs {
        let selection = SubmenuBuilder::new(app, "Selection")
            .item(&menu_from_layout::menu_item_or(
                app,
                Some(specs),
                "menu.edit.select_line",
                "",
                false,
                None,
            )?)
            .item(&menu_from_layout::menu_item_or(
                app,
                Some(specs),
                "menu.edit.select_word",
                "",
                false,
                None,
            )?)
            .item(&menu_from_layout::menu_item_or(
                app,
                Some(specs),
                "menu.edit.delete_word",
                "",
                false,
                None,
            )?)
            .build()?;
        let find = SubmenuBuilder::new(app, "Find")
            .item(&menu_from_layout::menu_item_or(
                app,
                Some(specs),
                "menu.edit.find",
                "",
                false,
                None,
            )?)
            .item(&menu_from_layout::menu_item_or(
                app,
                Some(specs),
                "menu.edit.replace",
                "",
                false,
                None,
            )?)
            .item(&menu_from_layout::menu_item_or(
                app,
                Some(specs),
                "menu.edit.find_next",
                "",
                false,
                None,
            )?)
            .item(&menu_from_layout::menu_item_or(
                app,
                Some(specs),
                "menu.edit.find_previous",
                "",
                false,
                None,
            )?)
            .build()?;
        return SubmenuBuilder::new(app, "Edit")
            .item(&PredefinedMenuItem::undo(app, None)?)
            .item(&PredefinedMenuItem::redo(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::cut(app, None)?)
            .item(&PredefinedMenuItem::copy(app, None)?)
            .item(&PredefinedMenuItem::paste(app, None)?)
            .item(&menu_from_layout::menu_item_or(
                app,
                Some(specs),
                "menu.edit.copy_as_markdown",
                "",
                false,
                None,
            )?)
            .item(&menu_from_layout::menu_item_or(
                app,
                Some(specs),
                "menu.edit.paste_as_plain_text",
                "",
                false,
                None,
            )?)
            .item(&PredefinedMenuItem::select_all(app, None)?)
            .separator()
            .item(&selection)
            .separator()
            .item(&find)
            .build();
    }
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
