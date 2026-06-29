use crate::models::{LogEntryPayload, LogSettings, UserPreferences};
use crate::services::{logger, preferences};

/// Maximum serialized payload size in bytes (64 KB).
/// Prevents disk-filling attacks from a compromised frontend.
const MAX_LOG_PAYLOAD_BYTES: usize = 64 * 1024;

#[tauri::command]
pub async fn log_event(payload: LogEntryPayload) -> Result<(), String> {
    // Validate payload size to prevent log injection / disk-filling (fixes #316)
    let serialized = serde_json::to_string(&payload)
        .map_err(|e| format!("Failed to serialize log payload: {}", e))?;
    if serialized.len() > MAX_LOG_PAYLOAD_BYTES {
        return Err(format!(
            "Log payload too large: {} bytes (max {})",
            serialized.len(),
            MAX_LOG_PAYLOAD_BYTES
        ));
    }
    logger::log_event(payload);
    Ok(())
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
    let current =
        preferences::load_preferences().map_err(|e| preferences::PreferencesError::IoError {
            message: format!("Failed to load preferences: {:?}", e),
        })?;
    let next = UserPreferences {
        logging: settings.clone(),
        ..current
    };
    preferences::save_preferences(&next)?;
    logger::set_log_settings(settings.clone());
    Ok(settings)
}
