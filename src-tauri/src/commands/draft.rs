use crate::services::draft::{
    cleanup_old_drafts as cleanup_drafts_service, delete_draft as delete_draft_service,
    list_drafts as list_drafts_service, load_draft, recover_draft as recover_draft_service,
    save_draft as save_draft_service, DraftError, DraftMetadataEntry, DraftSaveResult, RecoverResult,
};

#[tauri::command]
pub async fn save_draft(
    document_id: String,
    content: String,
    original_path: Option<String>,
    title: String,
) -> Result<DraftSaveResult, DraftError> {
    save_draft_service(&document_id, &content, original_path, &title)
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
