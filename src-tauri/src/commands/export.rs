use serde::{Deserialize, Serialize};
use tauri::Window;

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
    let html_fragment = markdown::render_markdown(&content);
    let html = html_template::build_html(&html_fragment, &title, &theme);

    let Some(path) = rfd::FileDialog::new()
        .add_filter("HTML", &["html"])
        .set_file_name(format!("{title}.html"))
        .save_file()
    else {
        return Err(ExportError::Cancelled);
    };

    std::fs::write(&path, html.as_bytes()).map_err(|err| match err.kind() {
        std::io::ErrorKind::PermissionDenied => ExportError::PermissionDenied {
            path: path.to_string_lossy().to_string(),
        },
        std::io::ErrorKind::WriteZero | std::io::ErrorKind::OutOfMemory => ExportError::DiskFull,
        _ => ExportError::ExportFailed {
            message: err.to_string(),
        },
    })?;

    Ok(ExportResult {
        success: true,
        path: path.to_string_lossy().to_string(),
        html_size: html.len() as u64,
    })
}

#[tauri::command]
pub fn preview_html(content: String, theme: String) -> String {
    let html_fragment = markdown::render_markdown(&content);
    html_template::build_html(&html_fragment, "mdpro export", &theme)
}
