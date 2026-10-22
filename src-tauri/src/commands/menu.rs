use tauri::{AppHandle, State, WebviewWindow, Wry};

use crate::menu::menu_recent_merge::RecentOp;
use crate::menu::{build_menu, MenuState, ModeReport};

/// Apply one window's `RecentOp` to the app-wide session recent list, rebuild
/// the native menu from the result, and return the list the window should show
/// (D43). A mode report is bound to the injected calling window; `None` makes
/// no report. Input bounds, the sync lock, publish-after-install and
/// the `menu.recent_files.sync` log all live in `MenuState::publish_op`.
#[tauri::command]
pub fn sync_recent_files_menu(
    app_handle: AppHandle<Wry>,
    window: WebviewWindow<Wry>,
    state: State<MenuState>,
    op: RecentOp,
    view_mode: Option<String>,
    theme_mode: Option<String>,
) -> Result<Vec<String>, String> {
    let report = view_mode.map(|mode| ModeReport {
        window: window.label().to_string(),
        mode,
    });
    if let Some(theme_mode) = theme_mode.as_deref() {
        state.publish_op_with_theme(op, report, Some(theme_mode), |list, mode, _theme| {
            let menu = build_menu(&app_handle, list, mode).map_err(|e| e.to_string())?;
            app_handle.set_menu(menu).map_err(|e| e.to_string())?;
            Ok(())
        })
    } else {
        state.publish_op(op, report, |list, mode| {
            let menu = build_menu(&app_handle, list, mode).map_err(|e| e.to_string())?;
            app_handle.set_menu(menu).map_err(|e| e.to_string())?;
            Ok(())
        })
    }
}
