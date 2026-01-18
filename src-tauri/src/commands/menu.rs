use tauri::{AppHandle, State, Wry};

use crate::menu::{build_menu, MenuState};

#[tauri::command]
pub fn set_recent_files_menu(
    app_handle: AppHandle<Wry>,
    state: State<MenuState>,
    recent_files: Vec<String>,
) -> Result<(), String> {
    state.set_recent_files(recent_files.clone());
    let menu = build_menu(&app_handle, &recent_files).map_err(|e| e.to_string())?;
    app_handle.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}
