use serde_json::json;
use tauri::Theme;
use tauri::Window;

use crate::models::{LogEntryPayload, LogLevel, LogStatus, UserPreferences, WindowState};
use crate::services::logger;
use crate::services::preferences::{
    load_preferences, merge_preferences, preferences_rw_lock, save_preferences, PartialPreferences,
    PreferencesError,
};

#[tauri::command]
pub async fn get_preferences() -> Result<UserPreferences, String> {
    load_preferences().map_err(|e| format!("Failed to load preferences: {:?}", e))
}

#[tauri::command]
pub async fn set_preferences(
    preferences: PartialPreferences,
) -> Result<UserPreferences, PreferencesError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "preferences.set".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "partial": true })),
        duration_ms: None,
        error: None,
    });

    // Hold the lock for the entire read → merge → write to prevent concurrent
    // calls from overwriting each other's changes.
    let result = (|| {
        let _lock = preferences_rw_lock()
            .lock()
            .map_err(|_| PreferencesError::IoError {
                message: "preferences lock poisoned".to_string(),
            })?;
        let current = load_preferences().unwrap_or_default();
        let next = merge_preferences(current, preferences);
        save_preferences(&next)?;
        Ok(next)
    })();

    let elapsed = start.elapsed().as_millis() as u64;
    match &result {
        Ok(_) => logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "preferences.set".to_string(),
            status: LogStatus::Success,
            action_id: Some(action_id),
            context: None,
            duration_ms: Some(elapsed),
            error: None,
        }),
        Err(e) => logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "preferences.set".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id),
            context: None,
            duration_ms: Some(elapsed),
            error: Some(format!("{:?}", e)),
        }),
    }
    result
}

#[tauri::command]
pub fn get_system_theme(window: Window) -> Result<String, String> {
    let theme = window
        .theme()
        .map_err(|e| format!("Failed to get system theme: {}", e))?;
    Ok(match theme {
        Theme::Dark => "dark".to_string(),
        _ => "light".to_string(),
    })
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
    let next = UserPreferences {
        window_state,
        ..current
    };
    save_preferences(&next)
}
