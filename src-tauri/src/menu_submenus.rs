//! Purpose: the File, View, Theme, Window and Help submenus of the native menu
//! bar. Off-Mac shortcuts retain the D190 tree; macOS custom items consume
//! the command-layout specs (M4-WI-2). The ids stay declared in `menu.rs`.
//!
//! @coordinates-with src-tauri/src/menu.rs
//! @coordinates-with src-tauri/src/menu_from_layout.rs

use tauri::menu::{CheckMenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Wry};

use super::menu_recent::build_recent_submenu;
use super::{
    menu_from_layout, MENU_THEME_DARK, MENU_THEME_LIGHT, MENU_THEME_SYSTEM, MENU_VIEW_CYCLE,
    MENU_VIEW_SOURCE, MENU_VIEW_TOGGLE_SIDEBAR, MENU_VIEW_WYSIWYG,
};
use super::{
    MENU_FILE_CLOSE, MENU_FILE_EXPORT_HTML, MENU_FILE_NEW, MENU_FILE_NEW_WINDOW, MENU_FILE_OPEN,
    MENU_FILE_SAVE,
};

pub(super) fn file_menu(
    app: &AppHandle<Wry>,
    recent_files: &[String],
    specs: Option<&[menu_from_layout::MenuItemSpec]>,
) -> tauri::Result<Submenu<Wry>> {
    let new = menu_from_layout::menu_item_or(
        app,
        specs,
        MENU_FILE_NEW,
        "New",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let new_window = menu_from_layout::menu_item_or(
        app,
        specs,
        MENU_FILE_NEW_WINDOW,
        "New Window",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let open = menu_from_layout::menu_item_or(
        app,
        specs,
        MENU_FILE_OPEN,
        "Open...",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let save = menu_from_layout::menu_item_or(
        app,
        specs,
        MENU_FILE_SAVE,
        "Save",
        true,
        Some("CmdOrCtrl+S"),
    )?;
    let export = menu_from_layout::menu_item_or(
        app,
        specs,
        MENU_FILE_EXPORT_HTML,
        "Export HTML...",
        true,
        Some("CmdOrCtrl+Shift+E"),
    )?;
    let close = menu_from_layout::menu_item_or(
        app,
        specs,
        MENU_FILE_CLOSE,
        "Close",
        true,
        Some("CmdOrCtrl+W"),
    )?;
    let recent = build_recent_submenu(app, recent_files)?;
    SubmenuBuilder::new(app, "File")
        .item(&new)
        .item(&new_window)
        .item(&open)
        .item(&recent)
        .separator()
        .item(&save)
        .item(&export)
        .separator()
        .item(&close)
        .build()
}

/// The two view items whose accelerator depends on the platform.
#[derive(Clone, Copy)]
pub(super) enum ViewItem {
    Source,
    Wysiwyg,
}

/// The accelerator on View → Source / WYSIWYG: ⌃2 / ⌃4 on macOS, none on
/// Windows and Linux, where Ctrl+1–6 are headings and Cycle View Mode
/// (`CmdOrCtrl+/`) is the view switch (D190-WI-6, ADR-0096).
pub(super) fn view_item_accelerator(item: ViewItem, macos: bool) -> Option<&'static str> {
    if !macos {
        return None;
    }
    match item {
        ViewItem::Source => Some("Ctrl+2"),
        ViewItem::Wysiwyg => Some("Ctrl+4"),
    }
}

/// `active_view_mode` checks the Source or WYSIWYG item.
pub(super) fn view_menu(
    app: &AppHandle<Wry>,
    active_view_mode: Option<&str>,
    specs: Option<&[menu_from_layout::MenuItemSpec]>,
) -> tauri::Result<Submenu<Wry>> {
    // Cmd+/ to cycle through view modes (Typora-style); off-Mac it is the
    // only view-switch key (ADR-0096).
    let view_cycle = menu_from_layout::menu_item_or(
        app,
        specs,
        MENU_VIEW_CYCLE,
        "Cycle View Mode",
        true,
        Some("CmdOrCtrl+/"),
    )?;
    let is_active = |mode: &str| active_view_mode == Some(mode);
    let view_source = match specs {
        Some(specs) => {
            menu_from_layout::check_item(app, specs, MENU_VIEW_SOURCE, is_active("source"))?
        }
        None => CheckMenuItem::with_id(
            app,
            MENU_VIEW_SOURCE,
            "Source",
            true,
            is_active("source"),
            view_item_accelerator(ViewItem::Source, false),
        )?,
    };
    let view_wysiwyg = match specs {
        Some(specs) => {
            menu_from_layout::check_item(app, specs, MENU_VIEW_WYSIWYG, is_active("wysiwyg"))?
        }
        None => CheckMenuItem::with_id(
            app,
            MENU_VIEW_WYSIWYG,
            "WYSIWYG",
            true,
            is_active("wysiwyg"),
            view_item_accelerator(ViewItem::Wysiwyg, false),
        )?,
    };
    let view_toggle_sidebar = menu_from_layout::menu_item_or(
        app,
        specs,
        MENU_VIEW_TOGGLE_SIDEBAR,
        "Toggle Sidebar",
        true,
        Some("CmdOrCtrl+Shift+L"),
    )?;

    SubmenuBuilder::new(app, "View")
        .item(&view_cycle)
        .separator()
        .item(&view_source)
        .item(&view_wysiwyg)
        .separator()
        .item(&view_toggle_sidebar)
        .build()
}

pub(super) fn theme_menu(
    app: &AppHandle<Wry>,
    specs: Option<&[menu_from_layout::MenuItemSpec]>,
) -> tauri::Result<Submenu<Wry>> {
    let theme_light =
        menu_from_layout::menu_item_or(app, specs, MENU_THEME_LIGHT, "Light", true, None::<&str>)?;
    let theme_dark =
        menu_from_layout::menu_item_or(app, specs, MENU_THEME_DARK, "Dark", true, None::<&str>)?;
    let theme_system = menu_from_layout::menu_item_or(
        app,
        specs,
        MENU_THEME_SYSTEM,
        "System",
        true,
        None::<&str>,
    )?;
    SubmenuBuilder::new(app, "Theme")
        .item(&theme_light)
        .item(&theme_dark)
        .item(&theme_system)
        .build()
}

pub(super) fn window_menu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()
}

pub(super) fn help_menu(
    app: &AppHandle<Wry>,
    specs: Option<&[menu_from_layout::MenuItemSpec]>,
) -> tauri::Result<Submenu<Wry>> {
    SubmenuBuilder::new(app, "Help")
        .item(&menu_from_layout::menu_item_or(
            app,
            specs,
            "menu.help.placeholder",
            "mdpro Help",
            false,
            None::<&str>,
        )?)
        .build()
}

#[cfg(test)]
#[path = "menu_submenus_wi6_tests.rs"]
mod wi6_tests;
