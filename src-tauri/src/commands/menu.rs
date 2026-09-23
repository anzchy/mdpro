use tauri::{AppHandle, State, Wry};

use crate::menu::{build_menu, publish_after, MenuState};

/// Rebuild the native menu with `recent_files`, publishing the list to
/// `MenuState` only after the new menu is installed (see `publish_after`).
#[tauri::command]
pub fn set_recent_files_menu(
    app_handle: AppHandle<Wry>,
    state: State<MenuState>,
    recent_files: Vec<String>,
    view_mode: Option<String>,
) -> Result<(), String> {
    publish_after(&state, recent_files, |list| {
        let menu =
            build_menu(&app_handle, list, view_mode.as_deref()).map_err(|e| e.to_string())?;
        app_handle.set_menu(menu).map_err(|e| e.to_string())?;
        Ok(())
    })
}
