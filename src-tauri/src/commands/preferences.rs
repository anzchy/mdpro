use tauri::Theme;
use tauri::Window;

use crate::models::UserPreferences;
use crate::services::preferences::{
    load_preferences, merge_preferences, save_preferences, PartialPreferences, PreferencesError,
};

#[tauri::command]
pub async fn get_preferences() -> UserPreferences {
    load_preferences().unwrap_or_default()
}

#[tauri::command]
pub async fn set_preferences(
    preferences: PartialPreferences,
) -> Result<UserPreferences, PreferencesError> {
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
