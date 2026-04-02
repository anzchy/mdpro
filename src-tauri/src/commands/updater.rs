use serde_json::json;

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;

#[tauri::command]
pub fn get_app_version() -> Result<String, String> {
    let action_id = uuid::Uuid::new_v4().to_string();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "app.version.get".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: None,
        duration_ms: None,
        error: None,
    });
    let version = env!("CARGO_PKG_VERSION").to_string();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "app.version.get".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({ "version": &version })),
        duration_ms: None,
        error: None,
    });
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_app_version_returns_ok() {
        let result = get_app_version();
        assert!(result.is_ok());
    }

    #[test]
    fn get_app_version_non_empty() {
        let version = get_app_version().unwrap();
        assert!(!version.is_empty());
    }

    #[test]
    fn get_app_version_matches_cargo_pkg() {
        let version = get_app_version().unwrap();
        assert_eq!(version, env!("CARGO_PKG_VERSION"));
    }
}
