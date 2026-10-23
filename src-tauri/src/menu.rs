//! Purpose: the native menu bar (macOS, and Windows/Linux since D190) and its
//! `menu:action` dispatch.
//!
//! Key decisions:
//! - Each `menu:action` goes to one window, `emit_to` the target `route`
//!   resolves in `menu_target.rs` (D261); nothing broadcasts it.
//! - The pure platform root/item plan lives in `menu_construction_plan.rs`;
//!   `menu_plan_builder.rs` renders the macOS tree and applies the same plan
//!   to the existing off-Mac native items. Item specs derive from the layout
//!   through `menu_from_layout.rs`.
//! - Recent-files state and the "Open Recent" submenu live in `menu_recent.rs`.
//!   `MenuState::publish_op` merges a window's op under a sync lock and
//!   publishes only once the menu built from it has installed (audit row 18);
//!   the click handler below reads the list through the data mutex only.
//! - The pure session-list merge (`RecentOp`, `apply_recent_op`) lives in
//!   `menu_recent_merge.rs` (D43), shared by Rust and TS through a fixture.
//! - The quit escape follows Quit; off macOS Exit uses the quit guard.
//! - macOS custom items derive labels, ids, keys and enabled state from the
//!   command layout and applied snapshot. A mode-limited click is checked
//!   against its resolved window before emit (M4-WI-2/3).
//!
//! @coordinates-with src/menu_about.rs
//! @coordinates-with src/menu_target.rs
//! @coordinates-with src/menu_quit.rs
//! @coordinates-with src/menu_submenus.rs
//! @coordinates-with src/menu_edit.rs
//! @coordinates-with src/menu_format.rs
//! @coordinates-with src/menu_paragraph.rs
//! @coordinates-with src/menu_from_layout.rs
//! @coordinates-with src/menu_recent.rs
//! @coordinates-with src/menu_recent_merge.rs
//! @coordinates-with src/menu_construction_plan.rs
//! @coordinates-with src/menu_plan_builder.rs
//! @coordinates-with src/commands/menu.rs
//! @coordinates-with src-tauri/src/services/quit_guard/driver_escape.rs

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::menu_layout::{menu_layout, Platform};
use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use crate::services::quit_guard::{self, effects::AppQuitGuard};

const MENU_FILE_NEW: &str = "menu.file.new";
const MENU_FILE_NEW_WINDOW: &str = "menu.file.new_window";
const MENU_FILE_OPEN: &str = "menu.file.open";
const MENU_FILE_SAVE: &str = "menu.file.save";
const MENU_FILE_SAVE_AS: &str = "menu.file.save_as";
const MENU_FILE_CLOSE: &str = "menu.file.close";
const MENU_FILE_EXPORT_HTML: &str = "menu.file.export_html";
const MENU_FILE_RECENT_PREFIX: &str = "menu.file.recent.";
const MENU_FILE_PREFERENCES: &str = "menu.file.preferences";

const MENU_VIEW_CYCLE: &str = "menu.view.cycle";
const MENU_VIEW_SOURCE: &str = "menu.view.source";
const MENU_VIEW_WYSIWYG: &str = "menu.view.wysiwyg";
const MENU_VIEW_TOGGLE_SIDEBAR: &str = "menu.view.toggle_sidebar";
const MENU_VIEW_SWITCH_DOCUMENTS: &str = "menu.view.switch_documents";
const MENU_VIEW_TOGGLE_FULLSCREEN: &str = "menu.view.toggle_fullscreen";

const MENU_FORMAT_HIGHLIGHT: &str = "menu.format.highlight";
const MENU_FORMAT_INSERT_TABLE: &str = "menu.format.insert_table";

const MENU_THEME_LIGHT: &str = "menu.theme.light";
const MENU_THEME_DARK: &str = "menu.theme.dark";
const MENU_THEME_SYSTEM: &str = "menu.theme.system";
const MENU_HELP_KEYBOARD_SHORTCUTS: &str = "menu.help.keyboard_shortcuts";

/// "Stop Waiting and Quit…" — the stuck-quit escape hatch (ADR-0036). Routed
/// in Rust only; it never reaches the frontend as a `menu:action`.
pub const MENU_APP_STOP_WAITING_QUIT: &str = "menu.app.stop_waiting_quit";

/// "Exit" — the guarded quit off macOS (D190-WI-4, ADR-0090). Routed in Rust
/// only, into `QuitGuard::request_quit`.
pub const MENU_APP_QUIT: &str = "menu.app.quit";
const MENU_APP_HIDE: &str = "menu.app.hide";
#[path = "menu_recent.rs"]
mod menu_recent;
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

#[path = "menu_from_layout.rs"]
mod menu_from_layout;

#[path = "menu_construction_plan.rs"]
mod menu_construction_plan;

#[path = "menu_plan_builder.rs"]
mod menu_plan_builder;

#[path = "menu_about.rs"]
mod menu_about;
use menu_about::about_metadata_for;

#[path = "menu_target.rs"]
pub mod menu_target;
pub(crate) use menu_quit::{app_menu_has_macos_items, log_menu_exit, quit_item_for, QuitItem};
pub use menu_target::{forget_window, MenuFocus};
use menu_target::{route, MenuActionPayload, UNMANAGED_FOCUS};

fn emit_menu_action(app: &AppHandle, action: &str, value: Option<String>) {
    let availability_cancelled = std::cell::Cell::new(false);
    let attempted_native_emit = std::cell::Cell::new(false);
    let managed = app.try_state::<MenuFocus>();
    let focus = managed.as_deref().unwrap_or(&UNMANAGED_FOCUS);
    let live: Vec<String> = app.webview_windows().into_keys().collect();
    let emit = |label: &str, p: &MenuActionPayload| {
        let menus = app.try_state::<MenuState>();
        let result = match menu_layout() {
            Ok(layout) => menu_availability::emit_to_window(
                layout,
                action,
                label,
                focus,
                menus.as_deref(),
                |target| {
                    attempted_native_emit.set(true);
                    app.emit_to(target, "menu:action", p).map_err(|_| ())
                },
            ),
            Err(_) => {
                menu_availability::log_invalid_layout();
                Err(())
            }
        };
        if result.is_err() && !attempted_native_emit.get() {
            // The guard already logged a refusal or invalid layout. A native
            // emit failure keeps D261's dispatch log below.
            availability_cancelled.set(true);
        }
        result
    };
    let log_event = |entry| {
        if !availability_cancelled.get() {
            logger::log_event(entry);
        }
    };
    route(action, value, focus, &live, emit, log_event);
}

pub fn build_menu(
    app: &AppHandle<Wry>,
    recent_files: &[String],
    active_view_mode: Option<&str>,
) -> tauri::Result<Menu<Wry>> {
    let mac_specs = menu_from_layout::specs_for_app(app, active_view_mode)?;
    let specs = mac_specs.as_deref();
    if let Some(specs) = specs {
        let layout = menu_layout()
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        let plan = menu_construction_plan::construction_plan(layout, Platform::Macos);
        let theme_mode = app
            .try_state::<MenuState>()
            .map(|state| state.theme_mode())
            .unwrap_or(menu_recent::ThemeMode::System);
        let menu = Menu::new(app)?;
        let build = |root| {
            menu_plan_builder::build_macos_root(
                app,
                root,
                specs,
                recent_files,
                active_view_mode,
                theme_mode,
            )
        };
        for root in &plan {
            match root.title.as_str() {
                "mdpro" => {
                    let app_menu = build(root)?;
                    menu.append(&app_menu)?;
                }
                "File" => {
                    let file_menu = build(root)?;
                    menu.append(&file_menu)?;
                }
                "Edit" => {
                    let edit_menu = build(root)?;
                    menu.append(&edit_menu)?;
                }
                "Paragraph" => {
                    let paragraph_menu = build(root)?;
                    let paragraph_menu = &paragraph_menu;
                    menu.append(paragraph_menu)?;
                }
                "Format" => {
                    let format_menu = build(root)?;
                    menu.append(&format_menu)?;
                }
                "View" => {
                    let view_menu = build(root)?;
                    menu.append(&view_menu)?;
                }
                "Themes" => {
                    let theme_menu = build(root)?;
                    menu.append(&theme_menu)?;
                }
                "Window" => {
                    let window_menu = build(root)?;
                    menu.append(&window_menu)?;
                }
                "Help" => {
                    let help_menu = build(root)?;
                    menu.append(&help_menu)?;
                }
                _ => unreachable!("closed macOS root order"),
            }
        }
        return Ok(menu);
    }
    let menu = Menu::new(app)?;
    let app_name = app.package_info().name.clone();
    let about_metadata = about_metadata_for(
        std::env::consts::OS,
        &app_name,
        &app.package_info().version.to_string(),
    );
    let about = PredefinedMenuItem::about(app, None, about_metadata)?;

    let preferences_item = menu_from_layout::menu_item_or(
        app,
        specs,
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
            .item(&MenuItem::with_id(
                app,
                MENU_APP_HIDE,
                "Hide mdpro",
                true,
                None::<&str>,
            )?)
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

    let file_menu = menu_submenus::file_menu(app, recent_files, specs)?;

    let edit_menu = menu_edit::edit_menu(app, specs)?;
    let view_menu = menu_submenus::view_menu(app, active_view_mode, specs)?;
    let format_menu = menu_format::format_menu(app, active_view_mode == Some("wysiwyg"), specs)?;

    let theme_mode = app
        .try_state::<MenuState>()
        .map(|state| state.theme_mode())
        .unwrap_or(menu_recent::ThemeMode::System);
    let theme_menu = menu_submenus::theme_menu(app, specs, theme_mode)?;
    let window_menu = menu_submenus::window_menu(app)?;
    let help_menu = menu_submenus::help_menu(app, specs)?;

    let platform = if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Linux
    };
    let layout = menu_layout()
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    for root in menu_construction_plan::construction_plan(layout, platform) {
        let existing = match root.title.as_str() {
            "mdpro" => &app_menu,
            "File" => &file_menu,
            "Edit" => &edit_menu,
            "Format" => &format_menu,
            "View" => &view_menu,
            "Theme" => &theme_menu,
            "Window" => &window_menu,
            "Help" => &help_menu,
            _ => unreachable!("closed root order"),
        };
        let built = menu_plan_builder::rebuild_offmac_root(app, existing, &root, layout)?;
        menu.append(&built)?;
    }

    Ok(menu)
}

pub fn handle_menu_event(app: &AppHandle<Wry>, event: MenuEvent) {
    let id = event.id().as_ref();
    if let Ok(layout) = menu_layout() {
        if let Some(action) = menu_from_layout::editor_action_for_menu_id(layout, id) {
            emit_menu_action(app, &action, None);
            return;
        }
        if let Some(action) = menu_from_layout::unavailable_action_for_menu_id(layout, id) {
            emit_menu_action(app, &action, None);
            return;
        }
    }
    match id {
        MENU_APP_STOP_WAITING_QUIT => {
            quit_guard::deliver_escape(app.try_state::<AppQuitGuard>().as_deref())
        }
        MENU_APP_QUIT => request_guarded_quit(app),
        MENU_APP_HIDE => hide_app(app),
        MENU_FILE_NEW => emit_menu_action(app, "file.new", None),
        MENU_FILE_NEW_WINDOW => emit_menu_action(app, "file.new_window", None),
        MENU_FILE_OPEN => emit_menu_action(app, "file.open", None),
        MENU_FILE_SAVE => emit_menu_action(app, "file.save", None),
        MENU_FILE_SAVE_AS => emit_menu_action(app, "file.save_as", None),
        MENU_FILE_CLOSE => emit_menu_action(app, "file.close", None),
        MENU_FILE_EXPORT_HTML => emit_menu_action(app, "file.export_html", None),
        MENU_FILE_PREFERENCES => emit_menu_action(app, "file.preferences", None),
        MENU_VIEW_CYCLE => emit_menu_action(app, "cycle-view-mode", None),
        MENU_VIEW_SOURCE => emit_menu_action(app, "set-view-mode", Some("source".to_string())),
        MENU_VIEW_WYSIWYG => emit_menu_action(app, "set-view-mode", Some("wysiwyg".to_string())),
        MENU_VIEW_TOGGLE_SIDEBAR => emit_menu_action(app, "view.toggle_sidebar", None),
        MENU_VIEW_SWITCH_DOCUMENTS => emit_menu_action(app, "view.switch_documents", None),
        MENU_VIEW_TOGGLE_FULLSCREEN => emit_menu_action(app, "view.toggle_fullscreen", None),
        MENU_FORMAT_HIGHLIGHT => emit_menu_action(app, "format.highlight", None),
        MENU_FORMAT_INSERT_TABLE => emit_menu_action(app, "paragraph.table", None),
        MENU_THEME_LIGHT => {
            emit_menu_action(app, "theme.light", None);
            refresh_menu_for_focus(app);
        }
        MENU_THEME_DARK => {
            emit_menu_action(app, "theme.dark", None);
            refresh_menu_for_focus(app);
        }
        MENU_THEME_SYSTEM => {
            emit_menu_action(app, "theme.system", None);
            refresh_menu_for_focus(app);
        }
        MENU_HELP_KEYBOARD_SHORTCUTS => emit_menu_action(
            app,
            "file.preferences",
            Some("keyboard-shortcuts".to_string()),
        ),
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

/// macOS Hide deliberately has no accelerator so Source can receive Cmd+H.
fn hide_app(app: &AppHandle<Wry>) {
    let action_id = uuid::Uuid::new_v4().to_string();
    let log = |status, error: Option<String>| {
        logger::log_event(LogEntryPayload {
            level: if error.is_some() {
                LogLevel::Error
            } else {
                LogLevel::Info
            },
            event: "ui.menu.hide".into(),
            status,
            action_id: Some(action_id.clone()),
            context: None,
            duration_ms: None,
            error,
        });
    };
    log(LogStatus::Start, None);
    #[cfg(target_os = "macos")]
    match app.hide() {
        Ok(()) => log(LogStatus::Success, None),
        Err(error) => log(LogStatus::Fail, Some(error.to_string())),
    }
    #[cfg(not(target_os = "macos"))]
    log(LogStatus::Fail, Some("Hide is macOS only".into()));
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
#[path = "menu_route_m4_success_tests.rs"]
mod menu_route_m4_success_tests;
#[cfg(test)]
#[path = "menu_quit_tests.rs"]
mod quit_tests;
