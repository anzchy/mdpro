//! The registered-document snapshot and native Save As picker boundary.
//! A missing original may reach the picker; unsafe snapshot errors return
//! before it. Both direct Save As and D290's choice use `save_file_dialog`.
use super::file::{log_file_event, FileError};
use super::save_as_watch::original_bytes_before_dialog;
use crate::models::{LogLevel, LogStatus, SharedShadowStore};
use serde_json::json;
use std::path::PathBuf;

pub(crate) struct PickedSaveAs {
    pub original_path: Option<String>,
    pub original_bytes: Option<Vec<u8>>,
    pub picked: PathBuf,
}

/// Resolve the command-owned original, snapshot it, then invoke the picker.
/// A frontend hint never grants the own-path overwrite exception.
pub(crate) fn pick_registered_save_as(
    shadow: &SharedShadowStore,
    label: &str,
    document_id: &str,
    original_hint: Option<String>,
    action_id: &str,
    picker: impl FnOnce() -> Option<PathBuf>,
) -> Result<Option<PickedSaveAs>, FileError> {
    let registered_path = shadow
        .lock()
        .map_err(|_| FileError::IoError {
            message: "document registry unavailable".into(),
        })?
        .windows
        .get(label)
        .and_then(|state| state.documents.iter().find(|doc| doc.id == document_id))
        .and_then(|doc| doc.path.clone());
    let original_path = original_hint.filter(|path| registered_path.as_deref() == Some(path));
    let original_bytes = original_bytes_before_dialog(original_path.as_deref())
        .into_result()
        .inspect_err(|_| {
            log_file_event(
                "file.save_as",
                LogStatus::Fail,
                LogLevel::Warn,
                Some(action_id),
                json!({ "source": "dialog", "reason": "original_snapshot_refused" }),
                None,
                Some("original snapshot refused".into()),
            )
        })?;
    Ok(picker().map(|picked| PickedSaveAs {
        original_path,
        original_bytes,
        picked,
    }))
}

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_picker_tests.rs"]
mod tests;
