use crate::models::{LogEntryPayload, LogSettings, UserPreferences};
use crate::services::{logger, preferences};

#[tauri::command]
pub async fn log_event(payload: LogEntryPayload) {
    logger::log_event(payload);
}

#[tauri::command]
pub async fn get_logging_settings() -> Result<LogSettings, String> {
    let prefs = preferences::load_preferences()
        .map_err(|e| format!("Failed to load logging settings: {:?}", e))?;
    Ok(prefs.logging)
}

#[tauri::command]
pub async fn set_logging_settings(
    settings: LogSettings,
) -> Result<LogSettings, preferences::PreferencesError> {
    let current = preferences::load_preferences().unwrap_or_default();
    let next = UserPreferences {
        logging: settings.clone(),
        ..current
    };
    preferences::save_preferences(&next)?;
    logger::set_log_settings(settings.clone());
    Ok(settings)
}
