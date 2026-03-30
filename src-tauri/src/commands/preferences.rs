use tauri::Theme;
use tauri::Window;

use crate::models::{UserPreferences, WindowState};
use crate::services::preferences::{
    load_preferences, merge_preferences, preferences_rw_lock, save_preferences, PartialPreferences,
    PreferencesError,
};

#[tauri::command]
pub async fn get_preferences() -> UserPreferences {
    load_preferences().unwrap_or_default()
}

#[tauri::command]
pub async fn set_preferences(
    preferences: PartialPreferences,
) -> Result<UserPreferences, PreferencesError> {
    // Hold the lock for the entire read → merge → write to prevent concurrent
    // calls from overwriting each other's changes.
    let _lock = preferences_rw_lock()
        .lock()
        .map_err(|_| PreferencesError::IoError {
            message: "preferences lock poisoned".to_string(),
        })?;
    let current = load_preferences().unwrap_or_default();
    let next = merge_preferences(current, preferences);
    save_preferences(&next)?;
    Ok(next)
}

#[tauri::command]
pub fn get_system_theme(window: Window) -> String {
    let theme = window.theme().unwrap_or(Theme::Light);
    match theme {
        Theme::Dark => "dark".to_string(),
        _ => "light".to_string(),
    }
}

#[tauri::command]
pub async fn pick_export_folder() -> Result<Option<String>, String> {
    let folder = rfd::AsyncFileDialog::new()
        .pick_folder()
        .await
        .map(|p| p.path().to_string_lossy().to_string());
    Ok(folder)
}

#[tauri::command]
pub async fn save_window_state(window_state: WindowState) -> Result<(), PreferencesError> {
    let _lock = preferences_rw_lock()
        .lock()
        .map_err(|_| PreferencesError::IoError {
            message: "preferences lock poisoned".to_string(),
        })?;
    let current = load_preferences().unwrap_or_default();
    let next = UserPreferences { window_state, ..current };
    save_preferences(&next)
}
