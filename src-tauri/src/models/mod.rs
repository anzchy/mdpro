pub mod document;
pub mod draft;
pub mod log_entry;
pub mod mcp;
pub mod preferences;

pub use document::Document;
pub use draft::{Draft, DraftMetadata};
pub use log_entry::{LogContext, LogEntry, LogEntryPayload, LogLevel, LogSettings, LogStatus};
pub use mcp::{
    CreateDocumentRequest, CreateDocumentResponse, DocumentContent, DocumentInfo, DocumentState,
    ErrorResponse, InsertContentEvent, InsertContentRequest, InsertPosition, InsertResult,
    ServerConfig, ShadowStore, SharedShadowStore, SharedServerConfig, StatusResponse,
    SyncDocumentsPayload, UpdateDocumentRequest, WriteDocumentEvent, WriteResult,
};
// MCP WindowState is only used internally, not re-exported to avoid conflict with preferences::WindowState
pub use preferences::{AutoSaveConfig, CloseFocusBehavior, ImageConfig, KeyboardShortcuts, McpConfig, TabBarConfig, TabBarPosition, ThemeMode, UserPreferences, ViewMode, WindowGeometry, WindowState};
