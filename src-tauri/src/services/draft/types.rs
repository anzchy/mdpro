//! Public draft types: the `DraftError` wire enum and the command result
//! structs. Split out of `mod.rs` (D27 WI-1) and re-exported from there, so
//! every `services::draft::X` path is unchanged.
//!
//! Key decisions:
//! - `DraftError` is externally tagged with no `rename_all`: unit variants go
//!   over IPC as bare strings (`"OpenInWindow"`), struct variants as
//!   `{"NotFound":{"document_id":…}}`. The frontend classifier depends on it.
//! - `kind()` names the variant only, so logs never carry an id or a path.
//! - Listing and cleanup return counts (ADR-0038 §3, §5) for logging.
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub enum DraftError {
    IoError {
        message: String,
    },
    NotFound {
        document_id: String,
    },
    ParseError {
        message: String,
    },
    /// Refused: the draft's owner is a live window of this session.
    OwnedByLiveWindow,
    /// Refused: the draft's id or file is open in a live window.
    OpenInWindow,
    /// Refused because the live-window shadow store could not be read.
    ShadowStoreUnavailable,
}

impl DraftError {
    /// The variant name, never its payload: safe to log.
    pub fn kind(&self) -> &'static str {
        match self {
            DraftError::IoError { .. } => "IoError",
            DraftError::NotFound { .. } => "NotFound",
            DraftError::ParseError { .. } => "ParseError",
            DraftError::OwnedByLiveWindow => "OwnedByLiveWindow",
            DraftError::OpenInWindow => "OpenInWindow",
            DraftError::ShadowStoreUnavailable => "ShadowStoreUnavailable",
        }
    }
}

impl std::fmt::Display for DraftError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DraftError::IoError { message } => write!(f, "io error: {message}"),
            DraftError::NotFound { document_id } => {
                write!(f, "draft not found: {document_id}")
            }
            DraftError::ParseError { message } => write!(f, "parse error: {message}"),
            DraftError::OwnedByLiveWindow => {
                write!(f, "draft is in use: owned by a live window")
            }
            DraftError::OpenInWindow => write!(f, "draft is in use: open in a window"),
            DraftError::ShadowStoreUnavailable => write!(f, "draft status could not be checked"),
        }
    }
}

impl std::error::Error for DraftError {}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSaveResult {
    pub success: bool,
    pub draft_path: String,
    pub saved_at: i64,
    pub revision: String,
    pub save_order: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftMetadataEntry {
    pub id: String,
    pub original_path: Option<String>,
    pub last_modified: String,
    pub recovered: bool,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverResult {
    pub content: String,
    pub original_path: Option<String>,
    pub title: String,
    /// D173: the gen of the watch hold this reply's acquisition confirmed;
    /// 0 when it took none (refused, fenced, failed). Gen 0 is never issued.
    #[serde(default)]
    pub hold_gen: u64,
    /// Open tab selected by the guarded Rust check; absent if no file is open.
    #[serde(default)]
    pub target: Option<RecoverTarget>,
    /// Authorizes the placement write and conditional source deletion.
    pub claim_token: DraftClaimToken,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverTarget {
    pub id: String,
    pub stored_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftClaimToken {
    pub source_id: String,
    pub nonce: String,
    pub session_id: String,
}

/// Who is using a draft: the launch that wrote it and the window in it
/// (ADR-0038 §1). A label alone is not enough, because labels such as `main`
/// recur across runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftOwner {
    pub session_id: String,
    pub window_label: String,
}

/// Where every draft id on disk went: `listed + hidden_in_use +
/// hidden_recovered` is the number of distinct ids. `relisted` counts the
/// listed drafts that were recovered by a now-dead owner.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftListCounts {
    pub listed: usize,
    pub hidden_in_use: usize,
    pub hidden_recovered: usize,
    pub relisted: usize,
}

/// The drafts to offer for recovery, and how the rest were hidden.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct DraftListing {
    pub entries: Vec<DraftMetadataEntry>,
    pub counts: DraftListCounts,
}

/// `skipped_live` counts stale recovered drafts kept because they were in
/// use, or because the shadow store could not be read.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCounts {
    pub deleted: usize,
    pub skipped_live: usize,
}

#[cfg(test)]
#[path = "error_wire_tests.rs"]
mod error_wire_tests;
