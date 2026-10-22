//! Purpose: the native menu bar (macOS, and Windows/Linux since D190) and its
//! `menu:action` dispatch.
//!
//! Key decisions:
//! - Each `menu:action` goes to one window, `emit_to` the target `route`
//!   resolves in `menu_target.rs` (D261); nothing broadcasts it.
//! - Recent-files state and the "Open Recent" submenu live in `menu_recent.rs`;
//!   Edit and Format builders live in `menu_edit.rs` and `menu_format.rs`,
//!   while View, Theme, Window and Help live in `menu_submenus.rs`.
//!   `MenuState::publish_op` merges a window's op under a sync lock and
//!   publishes only once the menu built from it has installed (audit row 18);
//!   the click handler below reads the list through the data mutex only.
//! - The pure session-list merge (`RecentOp`, `apply_recent_op`) lives in
//!   `menu_recent_merge.rs` (D43), shared by Rust and TS through a fixture.
//! - The quit escape follows Quit; off macOS Exit uses the quit guard.
//! - Insert Table is enabled only for the focused WYSIWYG window and checked
//!   again against the resolved target when clicked (M3a).
//!
//! @coordinates-with src/menu_about.rs
//! @coordinates-with src/menu_target.rs
//! @coordinates-with src/menu_quit.rs
//! @coordinates-with src/menu_submenus.rs
//! @coordinates-with src/menu_edit.rs
//! @coordinates-with src/menu_format.rs
//! @coordinates-with src/menu_paragraph.rs
//! @coordinates-with src/menu_recent.rs
//! @coordinates-with src/menu_recent_merge.rs
//! @coordinates-with src/commands/menu.rs
//! @coordinates-with src-tauri/src/services/quit_guard/driver_escape.rs

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::services::logger;
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

/// "Exit" — the guarded quit off macOS (D190-WI-4, ADR-0090). Routed in Rust
/// only, into `QuitGuard::request_quit`.
pub const MENU_APP_QUIT: &str = "menu.app.quit";
#[path = "menu_recent.rs"]
mod menu_recent;
use menu_recent::build_recent_submenu;
pub use menu_recent::{publish_after, MenuState, ModeReport};

#[path = "menu_recent_merge.rs"]
pub mod menu_recent_merge;

#[path = "menu_availability.rs"]
mod menu_availability;
pub use menu_availability::refresh_menu_for_focus;

#[path = "menu_quit.rs"]
mod menu_quit;

#[path = "menu_submenus.rs"]
mod menu_submenus;

#[path = "menu_edit.rs"]
mod menu_edit;

#[path = "menu_format.rs"]
mod menu_format;

#[path = "menu_paragraph.rs"]
mod menu_paragraph;

#[path = "menu_about.rs"]
mod menu_about;
use menu_about::about_metadata_for;

#[path = "menu_target.rs"]
pub mod menu_target;
pub(crate) use menu_quit::{app_menu_has_macos_items, log_menu_exit, quit_item_for, QuitItem};
pub use menu_target::{forget_window, MenuFocus};
use menu_target::{route, MenuActionPayload, UNMANAGED_FOCUS};

fn emit_menu_action(app: &AppHandle, action: &str, value: Option<String>) {
    let managed = app.try_state::<MenuFocus>();
    let focus = managed.as_deref().unwrap_or(&UNMANAGED_FOCUS);
    let live: Vec<String> = app.webview_windows().into_keys().collect();
    let emit = |label: &str, p: &MenuActionPayload| {
        if action == "paragraph.table" && !menu_availability::table_action_allowed(app, label) {
            return Err(());
        }
        app.emit_to(label, "menu:action", p).map_err(|_| ())
    };
    route(action, value, focus, &live, emit, logger::log_event);
}

pub fn build_menu(
    app: &AppHandle<Wry>,
    recent_files: &[String],
    active_view_mode: Option<&str>,
) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    let app_name = app.package_info().name.clone();
    let about_metadata = about_metadata_for(
        std::env::consts::OS,
        &app_name,
        &app.package_info().version.to_string(),
    );
    let about = PredefinedMenuItem::about(app, None, about_metadata)?;

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
        .separator();
    // Services / Hide / Hide Others / Show All are macOS-only (D190-WI-7).
    let app_menu = if app_menu_has_macos_items(std::env::consts::OS) {
        app_menu
            .item(&PredefinedMenuItem::services(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .item(&PredefinedMenuItem::show_all(app, None)?)
            .separator()
    } else {
        app_menu
    };
    // Guarded first: the predefined arm must stay directly before the escape
    // item, which follows whichever Quit this target carries (ADR-0036).
    let app_menu = match quit_item_for(std::env::consts::OS) {
        QuitItem::Guarded => app_menu.item(&MenuItem::with_id(
            app,
            MENU_APP_QUIT,
            "Exit",
            true,
            None::<&str>,
        )?),
        QuitItem::Predefined => app_menu.item(&PredefinedMenuItem::quit(app, None)?),
    };
    let app_menu = app_menu
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

    let edit_menu = menu_edit::edit_menu(app)?;
    let view_menu = menu_submenus::view_menu(app, active_view_mode)?;
    let format_menu = menu_format::format_menu(app, active_view_mode == Some("wysiwyg"))?;

    let theme_menu = menu_submenus::theme_menu(app)?;
    let window_menu = menu_submenus::window_menu(app)?;
    let help_menu = menu_submenus::help_menu(app)?;

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
        MENU_APP_QUIT => request_guarded_quit(app),
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

/// The Exit item off macOS: ask the guard, over a sorted snapshot of the open
/// windows (ADR-0025 §2). No guard means setup never finished, so there is no
/// document state to lose and the app exits, as the macOS hook does.
fn request_guarded_quit(app: &AppHandle<Wry>) {
    let mut labels: Vec<String> = app.webview_windows().into_keys().collect();
    labels.sort();
    let begin = app
        .try_state::<AppQuitGuard>()
        .map(|guard| guard.request_quit(&labels, quit_guard::effects::now_ms()));
    log_menu_exit(begin.as_ref(), labels.len());
    if begin.is_none() {
        app.exit(0);
    }
}

#[cfg(test)]
#[path = "menu_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "menu_layout_parity_tests.rs"]
mod menu_layout_parity_tests;
#[cfg(test)]
#[path = "menu_quit_tests.rs"]
mod quit_tests;
