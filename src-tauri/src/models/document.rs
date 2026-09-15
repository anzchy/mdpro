use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    /// Unique identifier (hash of original path or UUID for new docs)
    pub id: String,
    /// File path on disk (None for unsaved new documents)
    pub path: Option<PathBuf>,
    /// Raw markdown content
    pub content: String,
    /// File encoding (default: UTF-8)
    pub encoding: String,
    /// Original on-disk line-ending style ("lf" | "crlf" | "cr").
    /// Preserved on open so an edit→save round-trip restores it instead of
    /// silently rewriting every line to LF.
    pub line_ending: String,
    /// Whether document has unsaved changes
    pub is_modified: bool,
    /// Last saved timestamp (Unix epoch milliseconds)
    pub last_saved: Option<i64>,
    /// File size in bytes (for large file warnings)
    pub file_size: Option<u64>,
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

impl Document {
    pub fn new() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            path: None,
            content: String::new(),
            encoding: "UTF-8".to_string(),
            line_ending: "lf".to_string(),
            is_modified: false,
            last_saved: None,
            file_size: None,
        }
    }

    pub fn from_path(path: PathBuf, content: String) -> Self {
        let id = Self::generate_id(&path);
        let file_size = std::fs::metadata(&path).ok().map(|meta| meta.len());

        Self {
            id,
            path: Some(path),
            content,
            encoding: "UTF-8".to_string(),
            line_ending: "lf".to_string(),
            is_modified: false,
            last_saved: Some(chrono::Utc::now().timestamp_millis()),
            file_size,
        }
    }

    fn generate_id(path: &PathBuf) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        path.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }
}
