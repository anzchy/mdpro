use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::Window;

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::{html_template, markdown};

/// The file name the export dialog suggests for a document titled `title`:
/// a trailing `.md` / `.markdown` (any case) is dropped first, so `basic.md`
/// suggests `basic.html`, not `basic.md.html` (D190-WI-7, W7).
pub(crate) fn export_file_name(title: &str) -> String {
    let lower = title.to_ascii_lowercase();
    let stem = [".markdown", ".md"]
        .iter()
        .find(|ext| lower.ends_with(*ext) && title.len() > ext.len())
        .map_or(title, |ext| &title[..title.len() - ext.len()]);
    format!("{stem}.html")
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderMarkdownResult {
    pub html: String,
}

/// Render markdown to HTML without server-side sanitization.
/// The frontend caller (exportService.ts) is responsible for running DOMPurify
/// on this output before inserting it into the DOM. Export paths use
/// `sanitize_html()` instead.
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
    crate::services::logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.export".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "title": title.as_str(), "theme": theme.as_str() })),
        duration_ms: None,
        error: None,
    });

    // D1: the render is real work and is measured. The span is CLOSED before
    // the dialog opens, so the user's dwell there never enters any duration.
    let render_start = std::time::Instant::now();
    let html_fragment = markdown::sanitize_html(&markdown::render_markdown(&content));
    let html = html_template::build_html(&html_fragment, &title, &theme);
    let render_span = render_start.elapsed();

    let Some(path) = rfd::FileDialog::new()
        .add_filter("HTML", &["html"])
        .set_file_name(export_file_name(&title))
        .save_file()
    else {
        crate::services::logger::log_event(LogEntryPayload {
            level: LogLevel::Warn,
            event: "file.export".to_string(),
            status: LogStatus::Cancel,
            action_id: Some(action_id),
            context: Some(json!({ "title": title.as_str() })),
            // The render really happened before the user cancelled, so it is
            // still reported — it just no longer has their dwell time added.
            duration_ms: Some(render_span.as_millis() as u64),
            error: None,
        });
        return Err(ExportError::Cancelled);
    };

    // Second span: everything from here is work again. Total = render + write,
    // with the dialog's dwell falling in the gap between the two.
    let write_start = std::time::Instant::now();
    let path_string = path.to_string_lossy().to_string();
    let path_for_error = path_string.clone();
    std::fs::write(&path, html.as_bytes()).map_err(|err| {
        crate::services::logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "file.export".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "path": path_for_error })),
            duration_ms: Some((render_span + write_start.elapsed()).as_millis() as u64),
            error: Some(err.to_string()),
        });
        match err.kind() {
            std::io::ErrorKind::PermissionDenied => ExportError::PermissionDenied {
                path: path.to_string_lossy().to_string(),
            },
            std::io::ErrorKind::WriteZero | std::io::ErrorKind::OutOfMemory => {
                ExportError::DiskFull
            }
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
        duration_ms: Some((render_span + write_start.elapsed()).as_millis() as u64),
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
    Ok(html_template::build_html(
        &html_fragment,
        "mdpro export",
        &theme,
    ))
}

/// WI-1.1 export path: write HTML whose body was pre-rendered by the frontend
/// (KaTeX-typeset math, highlighted code). The body is **re-sanitized here**
/// (defense in depth — never trust frontend-supplied HTML) before being wrapped
/// in the themed template and written. KaTeX CSS is inlined by `build_html` when
/// the body contains math, so the exported file renders math with zero JS.
#[tauri::command]
pub async fn export_rendered_html(
    _window: Window,
    body_html: String,
    title: String,
    theme: String,
) -> Result<ExportResult, ExportError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    crate::services::logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.export_rendered".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "title": title.as_str(), "theme": theme.as_str() })),
        duration_ms: None,
        error: None,
    });

    // D1: the re-sanitize is real work and is measured. The span is CLOSED
    // before the dialog opens, so the user's dwell never enters any duration.
    let render_start = std::time::Instant::now();
    // Re-sanitize the frontend body. The frontend already ran DOMPurify, but the
    // export must never trust that — the same allow-list runs server-side.
    let safe_body = markdown::sanitize_html(&body_html);
    let html = html_template::build_html(&safe_body, &title, &theme);
    let render_span = render_start.elapsed();

    let Some(path) = rfd::FileDialog::new()
        .add_filter("HTML", &["html"])
        .set_file_name(export_file_name(&title))
        .save_file()
    else {
        crate::services::logger::log_event(LogEntryPayload {
            level: LogLevel::Warn,
            event: "file.export_rendered".to_string(),
            status: LogStatus::Cancel,
            action_id: Some(action_id),
            context: Some(json!({ "title": title.as_str() })),
            // The render really happened before the user cancelled, so it is
            // still reported — it just no longer has their dwell time added.
            duration_ms: Some(render_span.as_millis() as u64),
            error: None,
        });
        return Err(ExportError::Cancelled);
    };

    // Second span: everything from here is work again. Total = render + write,
    // with the dialog's dwell falling in the gap between the two.
    let write_start = std::time::Instant::now();
    let path_string = path.to_string_lossy().to_string();
    let path_for_error = path_string.clone();
    std::fs::write(&path, html.as_bytes()).map_err(|err| {
        crate::services::logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "file.export_rendered".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "path": path_for_error })),
            duration_ms: Some((render_span + write_start.elapsed()).as_millis() as u64),
            error: Some(err.to_string()),
        });
        match err.kind() {
            std::io::ErrorKind::PermissionDenied => ExportError::PermissionDenied {
                path: path.to_string_lossy().to_string(),
            },
            std::io::ErrorKind::WriteZero | std::io::ErrorKind::OutOfMemory => {
                ExportError::DiskFull
            }
            _ => ExportError::ExportFailed {
                message: err.to_string(),
            },
        }
    })?;

    crate::services::logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.export_rendered".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({ "path": path_string, "htmlSize": html.len() as u64 })),
        duration_ms: Some((render_span + write_start.elapsed()).as_millis() as u64),
        error: None,
    });
    Ok(ExportResult {
        success: true,
        path: path.to_string_lossy().to_string(),
        html_size: html.len() as u64,
    })
}

#[cfg(test)]
#[path = "export_file_name_wi7_tests.rs"]
mod file_name_wi7_tests;
