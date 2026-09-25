//! Purpose: the native macOS menu bar and its `menu:action` dispatch.
//!
//! Key decisions:
//! - Recent-files state and the "Open Recent" submenu live in `menu_recent.rs`.
//!   `publish_after` publishes a new recent list only once the menu built from
//!   it has installed, so a failed rebuild never lets an old item index resolve
//!   against the new list (audit row 18).
//! - "Stop Waiting and Quit…" sits directly after Quit in the app menu: always
//!   enabled, no shortcut (ADR-0036). Its arm calls only
//!   `quit_guard::deliver_escape` and emits no `menu:action`, so it works when
//!   every webview is wedged (ADR-0030).
//!
//! @coordinates-with src/menu_recent.rs
//! @coordinates-with src/commands/menu.rs
//! @coordinates-with src-tauri/src/services/quit_guard/driver_escape.rs

use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::services::quit_guard::{self, effects::AppQuitGuard};

const MENU_FILE_NEW: &str = "menu.file.new";
const MENU_FILE_NEW_WINDOW: &str = "menu.file.new_window";
const MENU_FILE_OPEN: &str = "menu.file.open";
const MENU_FILE_SAVE: &str = "menu.file.save";
const MENU_FILE_CLOSE: &str = "menu.file.close";
const MENU_FILE_EXPORT_HTML: &str = "menu.file.export_html";
const MENU_FILE_RECENT_PREFIX: &str = "menu.file.recent.";
const MENU_FILE_PREFERENCES: &str = "menu.file.preferences";

const MENU_VIEW_CYCLE: &str = "menu.view.cycle";
const MENU_VIEW_SOURCE: &str = "menu.view.source";
const MENU_VIEW_WYSIWYG: &str = "menu.view.wysiwyg";
const MENU_VIEW_TOGGLE_SIDEBAR: &str = "menu.view.toggle_sidebar";

const MENU_FORMAT_HIGHLIGHT: &str = "menu.format.highlight";
const MENU_FORMAT_INSERT_TABLE: &str = "menu.format.insert_table";

const MENU_THEME_LIGHT: &str = "menu.theme.light";
const MENU_THEME_DARK: &str = "menu.theme.dark";
const MENU_THEME_SYSTEM: &str = "menu.theme.system";

/// "Stop Waiting and Quit…" — the stuck-quit escape hatch (ADR-0036). Routed
/// in Rust only; it never reaches the frontend as a `menu:action`.
pub const MENU_APP_STOP_WAITING_QUIT: &str = "menu.app.stop_waiting_quit";

#[path = "menu_recent.rs"]
mod menu_recent;
use menu_recent::build_recent_submenu;
pub use menu_recent::{publish_after, MenuState};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuActionPayload {
    action: String,
    value: Option<String>,
}

fn emit_menu_action(app: &AppHandle, action: &str, value: Option<String>) {
    let payload = MenuActionPayload {
        action: action.to_string(),
        value,
    };
    let _ = app.emit("menu:action", payload);
}

pub fn build_menu(
    app: &AppHandle<Wry>,
    recent_files: &[String],
    active_view_mode: Option<&str>,
) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    let app_name = app.package_info().name.clone();
    let about = PredefinedMenuItem::about(app, None, None)?;

    let preferences_item = MenuItem::with_id(
        app,
        MENU_FILE_PREFERENCES,
        "Preferences...",
        true,
        Some("CmdOrCtrl+,"),
    )?;

    let app_menu = SubmenuBuilder::new(app, app_name)
        .item(&about)
        .separator()
        .item(&preferences_item)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .item(&MenuItem::with_id(
            app,
            MENU_APP_STOP_WAITING_QUIT,
            "Stop Waiting and Quit…",
            true,
            None::<&str>,
        )?)
        .build()?;

    let file_new = MenuItem::with_id(app, MENU_FILE_NEW, "New", true, Some("CmdOrCtrl+N"))?;
    let file_new_window = MenuItem::with_id(
        app,
        MENU_FILE_NEW_WINDOW,
        "New Window",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let file_open = MenuItem::with_id(app, MENU_FILE_OPEN, "Open...", true, Some("CmdOrCtrl+O"))?;
    let file_save = MenuItem::with_id(app, MENU_FILE_SAVE, "Save", true, Some("CmdOrCtrl+S"))?;
    let file_export = MenuItem::with_id(
        app,
        MENU_FILE_EXPORT_HTML,
        "Export HTML...",
        true,
        Some("CmdOrCtrl+Shift+E"),
    )?;
    let file_close = MenuItem::with_id(app, MENU_FILE_CLOSE, "Close", true, Some("CmdOrCtrl+W"))?;
    let recent_menu = build_recent_submenu(app, recent_files)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&file_new)
        .item(&file_new_window)
        .item(&file_open)
        .item(&recent_menu)
        .separator()
        .item(&file_save)
        .item(&file_export)
        .separator()
        .item(&file_close)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // Cmd+/ to cycle through view modes (Typora-style)
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
        Some("Ctrl+2"),
    )?;
    let view_wysiwyg = CheckMenuItem::with_id(
        app,
        MENU_VIEW_WYSIWYG,
        "WYSIWYG",
        true,
        is_active("wysiwyg"),
        Some("Ctrl+4"),
    )?;
    let view_toggle_sidebar = MenuItem::with_id(
        app,
        MENU_VIEW_TOGGLE_SIDEBAR,
        "Toggle Sidebar",
        true,
        Some("CmdOrCtrl+Shift+L"),
    )?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&view_cycle)
        .separator()
        .item(&view_source)
        .item(&view_wysiwyg)
        .separator()
        .item(&view_toggle_sidebar)
        .build()?;

    let format_highlight = MenuItem::with_id(
        app,
        MENU_FORMAT_HIGHLIGHT,
        "Highlight Selection",
        true,
        Some("CmdOrCtrl+Shift+H"),
    )?;
    let format_insert_table = MenuItem::with_id(
        app,
        MENU_FORMAT_INSERT_TABLE,
        "Insert Table",
        true,
        Some("CmdOrCtrl+Alt+T"),
    )?;
    let format_menu = SubmenuBuilder::new(app, "Format")
        .item(&format_highlight)
        .item(&format_insert_table)
        .build()?;

    let theme_light = MenuItem::with_id(app, MENU_THEME_LIGHT, "Light", true, None::<&str>)?;
    let theme_dark = MenuItem::with_id(app, MENU_THEME_DARK, "Dark", true, None::<&str>)?;
    let theme_system = MenuItem::with_id(app, MENU_THEME_SYSTEM, "System", true, None::<&str>)?;
    let theme_menu = SubmenuBuilder::new(app, "Theme")
        .item(&theme_light)
        .item(&theme_dark)
        .item(&theme_system)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItem::with_id(
            app,
            "menu.help.placeholder",
            "mdpro Help",
            false,
            None::<&str>,
        )?)
        .build()?;

    menu.append(&app_menu)?;
    menu.append(&file_menu)?;
    menu.append(&edit_menu)?;
    menu.append(&view_menu)?;
    menu.append(&format_menu)?;
    menu.append(&theme_menu)?;
    menu.append(&window_menu)?;
    menu.append(&help_menu)?;

    Ok(menu)
}

pub fn handle_menu_event(app: &AppHandle<Wry>, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        MENU_APP_STOP_WAITING_QUIT => {
            quit_guard::deliver_escape(app.try_state::<AppQuitGuard>().as_deref())
        }
        MENU_FILE_NEW => emit_menu_action(app, "file.new", None),
        MENU_FILE_NEW_WINDOW => emit_menu_action(app, "file.new_window", None),
        MENU_FILE_OPEN => emit_menu_action(app, "file.open", None),
        MENU_FILE_SAVE => emit_menu_action(app, "file.save", None),
        MENU_FILE_CLOSE => emit_menu_action(app, "file.close", None),
        MENU_FILE_EXPORT_HTML => emit_menu_action(app, "file.export_html", None),
        MENU_FILE_PREFERENCES => emit_menu_action(app, "file.preferences", None),
        MENU_VIEW_CYCLE => emit_menu_action(app, "cycle-view-mode", None),
        MENU_VIEW_SOURCE => emit_menu_action(app, "set-view-mode", Some("source".to_string())),
        MENU_VIEW_WYSIWYG => emit_menu_action(app, "set-view-mode", Some("wysiwyg".to_string())),
        MENU_VIEW_TOGGLE_SIDEBAR => emit_menu_action(app, "view.toggle_sidebar", None),
        MENU_FORMAT_HIGHLIGHT => emit_menu_action(app, "format.highlight", None),
        MENU_FORMAT_INSERT_TABLE => emit_menu_action(app, "paragraph.table", None),
        MENU_THEME_LIGHT => emit_menu_action(app, "theme.light", None),
        MENU_THEME_DARK => emit_menu_action(app, "theme.dark", None),
        MENU_THEME_SYSTEM => emit_menu_action(app, "theme.system", None),
        _ => {
            if let Some(index) = id.strip_prefix(MENU_FILE_RECENT_PREFIX) {
                if let Ok(idx) = index.parse::<usize>() {
                    let state = app.state::<MenuState>();
                    let recent_files = state.recent_files();
                    if let Some(path) = recent_files.get(idx) {
                        emit_menu_action(app, "file.open_recent", Some(path.to_string()));
                    }
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "menu_tests.rs"]
mod tests;
