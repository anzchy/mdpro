//! MCP Server models for Shadow Store and HTTP API
//!
//! These types mirror the frontend document state and enable MCP access
//! to document content via the internal HTTP API.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Document state mirrored from frontend Zustand store.
/// This is the Rust-side shadow of the frontend document state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentState {
    /// Unique document identifier (hash of path or UUID for unsaved)
    pub id: String,

    /// Display title (filename or "Untitled")
    pub title: String,

    /// Absolute file path (None for unsaved documents)
    pub path: Option<String>,

    /// Full document content (markdown)
    pub content: String,

    /// Cursor position (character offset from start)
    pub cursor: usize,

    /// Whether document has unsaved changes
    pub is_dirty: bool,

    /// Whether this is the active document in its window
    pub is_active: bool,
}

/// Per-window state tracking for multi-window MCP routing.
#[derive(Debug, Clone, Default)]
pub struct WindowState {
    /// Tauri window label (e.g., "main", "mdpro-{uuid}")
    pub label: String,

    /// All documents open in this window
    pub documents: Vec<DocumentState>,

    /// ID of the active document in this window
    pub active_document_id: Option<String>,

    /// Last focused timestamp (Unix millis for MRU routing)
    pub last_focused_at: i64,
}

/// Global Rust-side state for MCP access.
/// This store mirrors frontend document state and enables
/// the HTTP server to respond to MCP requests.
#[derive(Debug, Default)]
pub struct ShadowStore {
    /// Window label -> WindowState
    pub windows: HashMap<String, WindowState>,

    /// Most recently focused window label
    pub focused_window: Option<String>,
}

impl ShadowStore {
    /// Get the active document from the most recently focused window.
    /// Falls back to: focused window -> MRU window -> first window.
    pub fn get_active_document(&self) -> Option<&DocumentState> {
        let window = self.get_target_window()?;
        window.active_document_id.as_ref().and_then(|id| {
            window.documents.iter().find(|d| &d.id == id)
        })
    }

    /// Get the target window for MCP operations.
    /// Priority: focused -> MRU -> first
    pub fn get_target_window(&self) -> Option<&WindowState> {
        // Try focused window first
        if let Some(ref label) = self.focused_window {
            if let Some(window) = self.windows.get(label) {
                return Some(window);
            }
        }

        // Fall back to MRU (most recently used)
        self.windows
            .values()
            .max_by_key(|w| w.last_focused_at)
    }

    /// Get a mutable reference to the target window.
    pub fn get_target_window_mut(&mut self) -> Option<&mut WindowState> {
        // Try focused window first
        if let Some(ref label) = self.focused_window {
            if self.windows.contains_key(label) {
                return self.windows.get_mut(label);
            }
        }

        // Fall back to MRU
        let mru_label = self.windows
            .values()
            .max_by_key(|w| w.last_focused_at)
            .map(|w| w.label.clone());

        mru_label.and_then(move |label| self.windows.get_mut(&label))
    }

    /// Get all documents across all windows.
    pub fn all_documents(&self) -> Vec<&DocumentState> {
        self.windows
            .values()
            .flat_map(|w| w.documents.iter())
            .collect()
    }

    /// Find a document by ID across all windows.
    pub fn find_document(&self, id: &str) -> Option<&DocumentState> {
        self.windows
            .values()
            .flat_map(|w| w.documents.iter())
            .find(|d| d.id == id)
    }

    /// Find which window contains a document.
    pub fn find_window_for_document(&self, doc_id: &str) -> Option<&str> {
        self.windows
            .iter()
            .find(|(_, w)| w.documents.iter().any(|d| d.id == doc_id))
            .map(|(label, _)| label.as_str())
    }
}

/// Thread-safe shared access to the Shadow Store.
pub type SharedShadowStore = Arc<Mutex<ShadowStore>>;

/// Payload for frontend → Rust document sync.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDocumentsPayload {
    /// Tauri window label
    pub window_label: String,

    /// All documents in this window
    pub documents: Vec<DocumentState>,

    /// ID of the active document
    pub active_document_id: Option<String>,
}

/// HTTP API response for document list.
#[derive(Debug, Clone, Serialize)]
pub struct DocumentInfo {
    pub id: String,
    pub title: String,
    pub path: Option<String>,
    pub is_dirty: bool,
}

impl From<&DocumentState> for DocumentInfo {
    fn from(doc: &DocumentState) -> Self {
        Self {
            id: doc.id.clone(),
            title: doc.title.clone(),
            path: doc.path.clone(),
            is_dirty: doc.is_dirty,
        }
    }
}

/// HTTP API response for document content.
#[derive(Debug, Clone, Serialize)]
pub struct DocumentContent {
    pub content: String,
    pub cursor: usize,
}

/// HTTP API response for app status.
#[derive(Debug, Clone, Serialize)]
pub struct StatusResponse {
    pub version: String,
    pub window_focused: bool,
}

/// HTTP API error response.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: Option<String>,
}

/// Request body for updating document content.
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateDocumentRequest {
    pub content: String,
}

/// Request body for inserting content.
#[derive(Debug, Clone, Deserialize)]
pub struct InsertContentRequest {
    pub text: String,
    pub position: InsertPosition,
}

/// Position for content insertion.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InsertPosition {
    Cursor,
    Start,
    End,
    #[serde(untagged)]
    Offset(usize),
}

/// Result of a write operation.
#[derive(Debug, Clone, Serialize)]
pub struct WriteResult {
    pub success: bool,
}

/// Result of an insert operation.
#[derive(Debug, Clone, Serialize)]
pub struct InsertResult {
    pub success: bool,
    pub new_cursor: usize,
}

/// Request body for creating a new document.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct CreateDocumentRequest {
    #[serde(default)]
    pub content: String,
}

/// Response for creating a new document.
#[derive(Debug, Clone, Serialize)]
pub struct CreateDocumentResponse {
    pub id: String,
}

/// Event payload for Rust → Frontend write notification.
#[derive(Debug, Clone, Serialize)]
pub struct WriteDocumentEvent {
    pub document_id: String,
    pub content: String,
    pub window_label: Option<String>,
}

/// Event payload for Rust → Frontend insert notification.
#[derive(Debug, Clone, Serialize)]
pub struct InsertContentEvent {
    pub document_id: String,
    pub text: String,
    pub position: InsertPosition,
    pub window_label: Option<String>,
}

/// Server configuration for HTTP server.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Localhost port (dynamically assigned)
    pub port: u16,

    /// Authentication token
    pub token: String,
}

/// Thread-safe shared server config.
pub type SharedServerConfig = Arc<Mutex<Option<ServerConfig>>>;
