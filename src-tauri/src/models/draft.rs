use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Draft {
    /// Hash-based identifier
    pub id: String,
    /// Original file path (if saved file)
    pub original_path: Option<PathBuf>,
    /// Draft content
    pub content: String,
    /// Last modification timestamp
    pub last_modified: i64,
    /// Has this draft been recovered?
    pub recovered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftMetadata {
    /// Original file path
    pub original_path: Option<String>,
    /// Last modification timestamp (ISO 8601)
    pub last_modified: String,
    /// Has been recovered
    pub recovered: bool,
    /// Document title (first heading or filename)
    pub title: String,
}
