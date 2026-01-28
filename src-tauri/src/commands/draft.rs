use serde_json::json;

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::draft::{
    cleanup_old_drafts as cleanup_drafts_service, delete_draft as delete_draft_service,
    list_drafts as list_drafts_service, load_draft, recover_draft as recover_draft_service,
    save_draft as save_draft_service, DraftError, DraftMetadataEntry, DraftSaveResult, RecoverResult,
};
use crate::services::logger;

#[tauri::command]
pub async fn save_draft(
    document_id: String,
    content: String,
    original_path: Option<String>,
    title: String,
) -> Result<DraftSaveResult, DraftError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.write".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({
            "documentId": document_id.as_str(),
            "filePath": original_path.as_deref(),
            "title": title.as_str()
        })),
        duration_ms: None,
        error: None,
    });
    let result = save_draft_service(&document_id, &content, original_path, &title).map_err(|err| {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "file.write".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "documentId": document_id.as_str() })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: Some(err.to_string()),
        });
        err
    })?;
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.write".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({
            "documentId": document_id.as_str(),
            "bytes": content.as_bytes().len()
        })),
        duration_ms: Some(start.elapsed().as_millis() as u64),
        error: None,
    });
    Ok(result)
}

#[tauri::command]
pub async fn get_draft(document_id: String) -> Option<crate::models::Draft> {
    load_draft(&document_id).ok().flatten()
}

#[tauri::command]
pub async fn list_drafts() -> Vec<DraftMetadataEntry> {
    list_drafts_service().unwrap_or_default()
}

#[tauri::command]
pub async fn recover_draft(document_id: String) -> Result<RecoverResult, DraftError> {
    recover_draft_service(&document_id)
}

#[tauri::command]
pub async fn delete_draft(document_id: String) -> bool {
    delete_draft_service(&document_id).unwrap_or(false)
}

#[tauri::command]
pub async fn cleanup_old_drafts() -> usize {
    cleanup_drafts_service().unwrap_or(0)
}
