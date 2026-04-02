//! Shadow Store Service
//!
//! Provides thread-safe access to the Shadow Store which mirrors
//! frontend document state for MCP access.

use crate::models::mcp::{WindowState as McpWindowState};
use crate::models::{DocumentState, ShadowStore, SharedShadowStore, SyncDocumentsPayload};
use std::sync::{Arc, Mutex};

/// Create a new shared Shadow Store instance.
pub fn create_shadow_store() -> SharedShadowStore {
    Arc::new(Mutex::new(ShadowStore::default()))
}

/// Sync documents from frontend to the Shadow Store.
///
/// This is called by the `mcp_sync_documents` command when the frontend
/// sends updated document state.
pub fn sync_documents(
    store: &SharedShadowStore,
    payload: SyncDocumentsPayload,
) -> Result<(), String> {
    let mut shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    // Update or create window state
    let window_state = shadow
        .windows
        .entry(payload.window_label.clone())
        .or_insert_with(|| McpWindowState {
            label: payload.window_label.clone(),
            documents: Vec::new(),
            active_document_id: None,
            last_focused_at: chrono::Utc::now().timestamp_millis(),
        });

    // Update documents and active document
    window_state.documents = payload.documents;
    window_state.active_document_id = payload.active_document_id;

    Ok(())
}

/// Update the focused window in the Shadow Store.
///
/// Called when a window gains focus to update MCP routing.
pub fn set_focused_window(store: &SharedShadowStore, window_label: &str) -> Result<(), String> {
    let mut shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    shadow.focused_window = Some(window_label.to_string());

    // Update the window's last_focused_at timestamp
    if let Some(window) = shadow.windows.get_mut(window_label) {
        window.last_focused_at = chrono::Utc::now().timestamp_millis();
    }

    Ok(())
}

/// Remove a window from the Shadow Store.
///
/// Called when a window is closed.
pub fn remove_window(store: &SharedShadowStore, window_label: &str) -> Result<(), String> {
    let mut shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    shadow.windows.remove(window_label);

    // Clear focused window if it was the one being removed
    if shadow.focused_window.as_deref() == Some(window_label) {
        shadow.focused_window = None;
    }

    Ok(())
}

/// Clear focused window if it matches the given label.
///
/// Called when a window loses focus. Only clears if the blurring window
/// is still the focused one (avoids race with another window gaining focus first).
pub fn clear_focused_window_if(store: &SharedShadowStore, window_label: &str) -> Result<(), String> {
    let mut shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    if shadow.focused_window.as_deref() == Some(window_label) {
        shadow.focused_window = None;
    }

    Ok(())
}

/// Check if any window in the Shadow Store is focused.
pub fn is_any_window_focused(store: &SharedShadowStore) -> Result<bool, String> {
    let shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    Ok(shadow.focused_window.is_some())
}

/// Get a document by ID from any window.
pub fn get_document(store: &SharedShadowStore, id: &str) -> Result<Option<DocumentState>, String> {
    let shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    Ok(shadow.find_document(id).cloned())
}

/// Get all documents from the target window (focused or MRU).
pub fn get_all_documents(store: &SharedShadowStore) -> Result<Vec<DocumentState>, String> {
    let shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    Ok(shadow.all_documents().into_iter().cloned().collect())
}

/// Get the active document from the target window.
pub fn get_active_document(store: &SharedShadowStore) -> Result<Option<DocumentState>, String> {
    let shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    Ok(shadow.get_active_document().cloned())
}

/// Get the window label that contains a specific document.
pub fn get_window_for_document(store: &SharedShadowStore, doc_id: &str) -> Result<Option<String>, String> {
    let shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    Ok(shadow.find_window_for_document(doc_id).map(|s| s.to_string()))
}

/// Optimistically update a document's content in the shadow store.
///
/// Called after emitting write/insert events so that subsequent reads
/// return the new content without waiting for the frontend sync roundtrip.
pub fn update_document_content(
    store: &SharedShadowStore,
    id: &str,
    content: String,
) -> Result<bool, String> {
    let mut shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    if let Some(doc) = shadow.find_document_mut(id) {
        doc.content = content;
        doc.is_dirty = true;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_document(id: &str) -> DocumentState {
        DocumentState {
            id: id.to_string(),
            title: format!("Test {}", id),
            path: Some(format!("/test/{}.md", id)),
            content: "# Test".to_string(),
            cursor: 0,
            is_dirty: false,
            is_active: false,
        }
    }

    #[test]
    fn test_sync_documents() {
        let store = create_shadow_store();
        let payload = SyncDocumentsPayload {
            window_label: "main".to_string(),
            documents: vec![create_test_document("doc1")],
            active_document_id: Some("doc1".to_string()),
        };

        sync_documents(&store, payload).unwrap();

        let docs = get_all_documents(&store).unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].id, "doc1");
    }

    #[test]
    fn test_focused_window() {
        let store = create_shadow_store();

        // Sync a window first
        let payload = SyncDocumentsPayload {
            window_label: "main".to_string(),
            documents: vec![],
            active_document_id: None,
        };
        sync_documents(&store, payload).unwrap();

        set_focused_window(&store, "main").unwrap();

        assert!(is_any_window_focused(&store).unwrap());
    }

    #[test]
    fn test_remove_window() {
        let store = create_shadow_store();

        let payload = SyncDocumentsPayload {
            window_label: "main".to_string(),
            documents: vec![create_test_document("doc1")],
            active_document_id: Some("doc1".to_string()),
        };
        sync_documents(&store, payload).unwrap();
        set_focused_window(&store, "main").unwrap();

        remove_window(&store, "main").unwrap();

        let docs = get_all_documents(&store).unwrap();
        assert!(docs.is_empty());
        assert!(!is_any_window_focused(&store).unwrap());
    }

    #[test]
    fn test_clear_focused_window_if() {
        let store = create_shadow_store();

        let payload = SyncDocumentsPayload {
            window_label: "main".to_string(),
            documents: vec![],
            active_document_id: None,
        };
        sync_documents(&store, payload).unwrap();

        // Set focused, then clear matching label
        set_focused_window(&store, "main").unwrap();
        assert!(is_any_window_focused(&store).unwrap());

        clear_focused_window_if(&store, "main").unwrap();
        assert!(!is_any_window_focused(&store).unwrap());
    }

    #[test]
    fn test_update_document_content_rollback() {
        // Regression for #243: update_document_content must be callable
        // twice — first with new content (optimistic update), then with the
        // original content (rollback on emit failure) — and the second call
        // must win so the shadow store does NOT diverge from the editor.
        let store = create_shadow_store();
        let original_content = "# Original".to_string();
        let new_content = "# Modified by MCP".to_string();

        let payload = SyncDocumentsPayload {
            window_label: "main".to_string(),
            documents: vec![DocumentState {
                id: "doc1".to_string(),
                title: "Test".to_string(),
                path: Some("/test/doc1.md".to_string()),
                content: original_content.clone(),
                cursor: 0,
                is_dirty: false,
                is_active: true,
            }],
            active_document_id: Some("doc1".to_string()),
        };
        sync_documents(&store, payload).unwrap();

        // Simulate optimistic update
        update_document_content(&store, "doc1", new_content).unwrap();
        let doc = get_document(&store, "doc1").unwrap().unwrap();
        assert_eq!(doc.content, "# Modified by MCP");

        // Simulate rollback after emit failure
        update_document_content(&store, "doc1", original_content.clone()).unwrap();
        let doc = get_document(&store, "doc1").unwrap().unwrap();
        assert_eq!(doc.content, original_content, "shadow store must reflect original after rollback");
    }

    #[test]
    fn test_clear_focused_window_if_different_label() {
        let store = create_shadow_store();

        set_focused_window(&store, "main").unwrap();
        assert!(is_any_window_focused(&store).unwrap());

        // Should NOT clear because label doesn't match
        clear_focused_window_if(&store, "other").unwrap();
        assert!(is_any_window_focused(&store).unwrap());
    }
}
