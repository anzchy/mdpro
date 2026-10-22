//! Native image picker boundary and its pure filter/cancel mapping.

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use std::path::PathBuf;

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

fn selected_path(path: Option<PathBuf>) -> Option<String> {
    path.map(|item| item.to_string_lossy().to_string())
}

#[tauri::command]
pub fn pick_image() -> Result<Option<String>, String> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let log = |status: LogStatus| {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "image.pick".to_string(),
            status,
            action_id: Some(action_id.clone()),
            context: None,
            duration_ms: None,
            error: None,
        });
    };
    log(LogStatus::Start);
    let path = selected_path(
        rfd::FileDialog::new()
            .add_filter("Images", IMAGE_EXTENSIONS)
            .pick_file(),
    );
    log(if path.is_some() {
        LogStatus::Success
    } else {
        LogStatus::Cancel
    });
    Ok(path)
}

#[cfg(test)]
#[path = "image_pick_tests.rs"]
mod tests;
