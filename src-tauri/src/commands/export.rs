use serde::{Deserialize, Serialize};

use crate::services::markdown;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderMarkdownResult {
    pub html: String,
}

#[tauri::command]
pub async fn render_markdown(markdown: String) -> Result<RenderMarkdownResult, String> {
    Ok(RenderMarkdownResult {
        html: markdown::render_markdown(&markdown),
    })
}
