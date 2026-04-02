use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::Window;

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::{html_template, markdown};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderMarkdownResult {
    pub html: String,
}

#[tauri::command]
pub async fn render_markdown(content: String) -> Result<RenderMarkdownResult, String> {
    Ok(RenderMarkdownResult {
        html: markdown::render_markdown(&content),
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub success: bool,
    pub path: String,
    pub html_size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum ExportError {
    PermissionDenied { path: String },
    DiskFull,
    ExportFailed { message: String },
    Cancelled,
}

#[tauri::command]
pub async fn export_html(
    _window: Window,
    content: String,
    title: String,
    theme: String,
) -> Result<ExportResult, ExportError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    crate::services::logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.export".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "title": title.as_str(), "theme": theme.as_str() })),
        duration_ms: None,
        error: None,
    });

    let html_fragment = markdown::sanitize_html(&markdown::render_markdown(&content));
    let html = html_template::build_html(&html_fragment, &title, &theme);

    let Some(path) = rfd::FileDialog::new()
        .add_filter("HTML", &["html"])
        .set_file_name(format!("{title}.html"))
        .save_file()
    else {
        crate::services::logger::log_event(LogEntryPayload {
            level: LogLevel::Warn,
            event: "file.export".to_string(),
            status: LogStatus::Cancel,
            action_id: Some(action_id),
            context: Some(json!({ "title": title.as_str() })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: None,
        });
        return Err(ExportError::Cancelled);
    };

    let path_string = path.to_string_lossy().to_string();
    let path_for_error = path_string.clone();
    std::fs::write(&path, html.as_bytes()).map_err(|err| {
        crate::services::logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "file.export".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "path": path_for_error })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: Some(err.to_string()),
        });
        match err.kind() {
        std::io::ErrorKind::PermissionDenied => ExportError::PermissionDenied {
            path: path.to_string_lossy().to_string(),
        },
        std::io::ErrorKind::WriteZero | std::io::ErrorKind::OutOfMemory => ExportError::DiskFull,
        _ => ExportError::ExportFailed {
            message: err.to_string(),
        },
        }
    })?;

    crate::services::logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.export".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({
            "path": path_string,
            "htmlSize": html.len() as u64
        })),
        duration_ms: Some(start.elapsed().as_millis() as u64),
        error: None,
    });
    Ok(ExportResult {
        success: true,
        path: path.to_string_lossy().to_string(),
        html_size: html.len() as u64,
    })
}

#[tauri::command]
pub fn preview_html(content: String, theme: String) -> Result<String, String> {
    let html_fragment = markdown::sanitize_html(&markdown::render_markdown(&content));
    Ok(html_template::build_html(&html_fragment, "mdpro export", &theme))
}
