use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

const MENU_FILE_NEW: &str = "menu.file.new";
const MENU_FILE_OPEN: &str = "menu.file.open";
const MENU_FILE_SAVE: &str = "menu.file.save";
const MENU_FILE_CLOSE: &str = "menu.file.close";
const MENU_FILE_EXPORT_HTML: &str = "menu.file.export_html";
const MENU_FILE_RECENT_PREFIX: &str = "menu.file.recent.";
const MENU_FILE_PREFERENCES: &str = "menu.file.preferences";

const MENU_VIEW_CYCLE: &str = "menu.view.cycle";
const MENU_VIEW_SPLIT: &str = "menu.view.split";
const MENU_VIEW_EDITOR: &str = "menu.view.editor";
const MENU_VIEW_PREVIEW: &str = "menu.view.preview";
const MENU_VIEW_WYSIWYG: &str = "menu.view.wysiwyg";
const MENU_VIEW_TOGGLE_SIDEBAR: &str = "menu.view.toggle_sidebar";

const MENU_FORMAT_HIGHLIGHT: &str = "menu.format.highlight";

const MENU_THEME_LIGHT: &str = "menu.theme.light";
const MENU_THEME_DARK: &str = "menu.theme.dark";
const MENU_THEME_SYSTEM: &str = "menu.theme.system";

#[derive(Default)]
pub struct MenuState {
    recent_files: Mutex<Vec<String>>,
}

impl MenuState {
    pub fn set_recent_files(&self, recent_files: Vec<String>) {
        if let Ok(mut data) = self.recent_files.lock() {
            *data = recent_files;
        }
    }

    pub fn recent_files(&self) -> Vec<String> {
        self.recent_files
            .lock()
            .map(|data| data.clone())
            .unwrap_or_default()
    }
}

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

fn recent_label(path: &str) -> String {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path);
    file_name.to_string()
}

fn build_recent_submenu(app: &AppHandle<Wry>, recent_files: &[String]) -> tauri::Result<Submenu<Wry>> {
    let mut builder = SubmenuBuilder::new(app, "Open Recent");
    if recent_files.is_empty() {
        let empty_item = MenuItem::with_id(
            app,
            "menu.file.recent.empty",
            "No Recent Files",
            false,
            None::<&str>,
        )?;
        builder = builder.item(&empty_item);
    } else {
        for (index, path) in recent_files.iter().enumerate() {
            let id = format!("{}{}", MENU_FILE_RECENT_PREFIX, index);
            let label = recent_label(path);
            let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;
            builder = builder.item(&item);
        }
    }
    builder.build()
}

pub fn build_menu(app: &AppHandle<Wry>, recent_files: &[String]) -> tauri::Result<Menu<Wry>> {
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
        .build()?;

    let file_new = MenuItem::with_id(app, MENU_FILE_NEW, "New", true, Some("CmdOrCtrl+N"))?;
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
    let view_split = MenuItem::with_id(app, MENU_VIEW_SPLIT, "Split", true, None::<&str>)?;
    let view_editor =
        MenuItem::with_id(app, MENU_VIEW_EDITOR, "Editor Only", true, None::<&str>)?;
    let view_preview =
        MenuItem::with_id(app, MENU_VIEW_PREVIEW, "Preview Only", true, None::<&str>)?;
    let view_wysiwyg =
        MenuItem::with_id(app, MENU_VIEW_WYSIWYG, "WYSIWYG", true, None::<&str>)?;
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
        .item(&view_split)
        .item(&view_editor)
        .item(&view_preview)
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
    let format_menu = SubmenuBuilder::new(app, "Format")
        .item(&format_highlight)
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
        .item(&MenuItem::with_id(app, "menu.help.placeholder", "mdpro Help", false, None::<&str>)?)
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
        MENU_FILE_NEW => emit_menu_action(app, "file.new", None),
        MENU_FILE_OPEN => emit_menu_action(app, "file.open", None),
        MENU_FILE_SAVE => emit_menu_action(app, "file.save", None),
        MENU_FILE_CLOSE => emit_menu_action(app, "file.close", None),
        MENU_FILE_EXPORT_HTML => emit_menu_action(app, "file.export_html", None),
        MENU_FILE_PREFERENCES => emit_menu_action(app, "file.preferences", None),
        MENU_VIEW_CYCLE => emit_menu_action(app, "view.cycle", None),
        MENU_VIEW_SPLIT => emit_menu_action(app, "view.split", None),
        MENU_VIEW_EDITOR => emit_menu_action(app, "view.editor_only", None),
        MENU_VIEW_PREVIEW => emit_menu_action(app, "view.preview_only", None),
        MENU_VIEW_WYSIWYG => emit_menu_action(app, "view.wysiwyg", None),
        MENU_VIEW_TOGGLE_SIDEBAR => emit_menu_action(app, "view.toggle_sidebar", None),
        MENU_FORMAT_HIGHLIGHT => emit_menu_action(app, "format.highlight", None),
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
