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
    ServerConfig, ShadowStore, SharedServerConfig, SharedShadowStore, StatusResponse,
    SyncDocumentsPayload, UpdateDocumentRequest, WriteDocumentEvent, WriteResult,
};
// MCP WindowState is only used internally, not re-exported to avoid conflict with preferences::WindowState
pub use preferences::{
    AppearanceConfig, AutoSaveConfig, CloseFocusBehavior, CodeTheme, ContentWidth, EditorConfig,
    ExportConfig, ImageConfig, KeyboardShortcuts, MarkdownConfig, McpConfig, TabBarConfig,
    TabBarPosition, ThemeMode, UserPreferences, ViewMode, WindowGeometry, WindowState,
};
