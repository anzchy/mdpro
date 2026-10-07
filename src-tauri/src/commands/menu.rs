use tauri::{AppHandle, State, Wry};

use crate::menu::menu_recent_merge::RecentOp;
use crate::menu::{build_menu, MenuState};

/// Apply one window's `RecentOp` to the app-wide session recent list, rebuild
/// the native menu from the result, and return the list the window should show
/// (D43). `view_mode` is remembered by `MenuState`; `None` keeps the last mode
/// any window reported. Input bounds, the sync lock, publish-after-install and
/// the `menu.recent_files.sync` log all live in `MenuState::publish_op`.
#[tauri::command]
pub fn sync_recent_files_menu(
    app_handle: AppHandle<Wry>,
    state: State<MenuState>,
    op: RecentOp,
    view_mode: Option<String>,
) -> Result<Vec<String>, String> {
    state.publish_op(op, view_mode, |list, mode| {
        let menu = build_menu(&app_handle, list, mode).map_err(|e| e.to_string())?;
        app_handle.set_menu(menu).map_err(|e| e.to_string())?;
        Ok(())
    })
}
