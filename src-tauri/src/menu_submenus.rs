//! Purpose: the View, Theme, Window and Help submenus of the native menu
//! bar. Moved verbatim out of `menu.rs::build_menu` under rule 50 §6 (D190-WI-4);
//! the ids stay declared in `menu.rs`, where the ledger gate and the click
//! dispatch read them.
//!
//! @coordinates-with src-tauri/src/menu.rs

use tauri::menu::{CheckMenuItem, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Wry};

use super::{
    MENU_THEME_DARK, MENU_THEME_LIGHT, MENU_THEME_SYSTEM, MENU_VIEW_CYCLE, MENU_VIEW_SOURCE,
    MENU_VIEW_TOGGLE_SIDEBAR, MENU_VIEW_WYSIWYG,
};

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
) -> tauri::Result<Submenu<Wry>> {
    // Cmd+/ to cycle through view modes (Typora-style); off-Mac it is the
    // only view-switch key (ADR-0096).
    let view_cycle = MenuItem::with_id(
        app,
        MENU_VIEW_CYCLE,
        "Cycle View Mode",
        true,
        Some("CmdOrCtrl+/"),
    )?;
    let is_active = |mode: &str| active_view_mode == Some(mode);
    let view_source = CheckMenuItem::with_id(
        app,
        MENU_VIEW_SOURCE,
        "Source",
        true,
        is_active("source"),
        view_item_accelerator(ViewItem::Source, cfg!(target_os = "macos")),
    )?;
    let view_wysiwyg = CheckMenuItem::with_id(
        app,
        MENU_VIEW_WYSIWYG,
        "WYSIWYG",
        true,
        is_active("wysiwyg"),
        view_item_accelerator(ViewItem::Wysiwyg, cfg!(target_os = "macos")),
    )?;
    let view_toggle_sidebar = MenuItem::with_id(
        app,
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

pub(super) fn theme_menu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    let theme_light = MenuItem::with_id(app, MENU_THEME_LIGHT, "Light", true, None::<&str>)?;
    let theme_dark = MenuItem::with_id(app, MENU_THEME_DARK, "Dark", true, None::<&str>)?;
    let theme_system = MenuItem::with_id(app, MENU_THEME_SYSTEM, "System", true, None::<&str>)?;
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

pub(super) fn help_menu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    SubmenuBuilder::new(app, "Help")
        .item(&MenuItem::with_id(
            app,
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
