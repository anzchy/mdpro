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
    include_styles: bool,
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
    let html = html_template::build_html(&html_fragment, &title, &theme, include_styles);

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
        crate::commands::pdf::map_io_error(err.kind(), &path_for_error)
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

/// WI-1 PDF export. Renders the markdown to a themed, print-ready HTML document
/// (honoring the `include_styles` toggle, with the `@media print` rule baked in)
/// and writes it to a user-chosen location so it can be browser-printed to PDF.
///
/// The live WKWebView print-to-PDF path requires a foreground window and is
/// covered by manual / E2E testing (deferred). The pure helpers it relies on —
/// `pdf::map_io_error` / `pdf::write_pdf_bytes` — are unit-tested in `pdf.rs`.
/// This command always returns a `Result` and never panics.
#[tauri::command]
pub async fn export_pdf(
    _window: Window,
    content: String,
    title: String,
    theme: String,
    include_styles: bool,
) -> Result<ExportResult, ExportError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    crate::services::logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.export_pdf".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "title": title.as_str(), "theme": theme.as_str() })),
        duration_ms: None,
        error: None,
    });

    let html_fragment = markdown::sanitize_html(&markdown::render_markdown(&content));
    let html = html_template::build_html(&html_fragment, &title, &theme, include_styles);

    let Some(path) = rfd::FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_file_name(format!("{title}.pdf"))
        .save_file()
    else {
        crate::services::logger::log_event(LogEntryPayload {
            level: LogLevel::Warn,
            event: "file.export_pdf".to_string(),
            status: LogStatus::Cancel,
            action_id: Some(action_id),
            context: Some(json!({ "title": title.as_str() })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: None,
        });
        return Err(ExportError::Cancelled);
    };

    // Write the print-ready HTML next to the chosen target. The browser/WKWebView
    // print-to-PDF step that converts this into the final .pdf is the deferred
    // manual/E2E path. Target derivation is the unit-tested
    // `pdf::pdf_sidecar_target` helper.
    let (dir, html_name) = crate::commands::pdf::pdf_sidecar_target(&path, &title);

    let written = crate::commands::pdf::write_pdf_bytes(&dir, &html_name, html.as_bytes()).map_err(
        |err| {
            crate::services::logger::log_event(LogEntryPayload {
                level: LogLevel::Error,
                event: "file.export_pdf".to_string(),
                status: LogStatus::Fail,
                action_id: Some(action_id.clone()),
                context: Some(json!({ "dir": dir.to_string_lossy() })),
                duration_ms: Some(start.elapsed().as_millis() as u64),
                error: Some(format!("{err:?}")),
            });
            err
        },
    )?;

    crate::services::logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.export_pdf".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({ "path": written, "htmlSize": html.len() as u64 })),
        duration_ms: Some(start.elapsed().as_millis() as u64),
        error: None,
    });
    Ok(ExportResult {
        success: true,
        path: written,
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
        true,
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
    let start = std::time::Instant::now();
    crate::services::logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.export_rendered".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "title": title.as_str(), "theme": theme.as_str() })),
        duration_ms: None,
        error: None,
    });

    // Re-sanitize the frontend body. The frontend already ran DOMPurify, but the
    // export must never trust that — the same allow-list runs server-side.
    let safe_body = markdown::sanitize_html(&body_html);
    let html = html_template::build_html(&safe_body, &title, &theme, true);

    let Some(path) = rfd::FileDialog::new()
        .add_filter("HTML", &["html"])
        .set_file_name(format!("{title}.html"))
        .save_file()
    else {
        crate::services::logger::log_event(LogEntryPayload {
            level: LogLevel::Warn,
            event: "file.export_rendered".to_string(),
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
            event: "file.export_rendered".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "path": path_for_error })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: Some(err.to_string()),
        });
        crate::commands::pdf::map_io_error(err.kind(), &path_for_error)
    })?;

    crate::services::logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.export_rendered".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({ "path": path_string, "htmlSize": html.len() as u64 })),
        duration_ms: Some(start.elapsed().as_millis() as u64),
        error: None,
    });
    Ok(ExportResult {
        success: true,
        path: path.to_string_lossy().to_string(),
        html_size: html.len() as u64,
    })
}
