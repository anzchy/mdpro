//! D255 Save As preflight: refuse a different target already held by any window.
//! The original path uses the existing disk-baseline conflict check.
use super::super::file::{log_file_event, FileError};
use super::same_file;
use crate::models::{LogLevel, LogStatus};
use crate::services::file_watcher::FileWatcher;
use serde_json::json;
use std::path::{Path, PathBuf};

/// Match the holder registry's group key, including a canonical parent for a
/// missing file. Keep in step with file_watcher_holders_teardown::group_key.
fn holder_group_key(raw: &Path) -> PathBuf {
    if let Ok(canonical) = std::fs::canonicalize(raw) {
        return canonical;
    }
    raw.parent()
        .zip(raw.file_name())
        .and_then(|(parent, name)| std::fs::canonicalize(parent).ok().map(|p| p.join(name)))
        .unwrap_or_else(|| raw.to_path_buf())
}

/// Bytes seen before the native picker opened; only used if it picks this same path.
pub(crate) fn original_bytes_before_dialog(path: Option<&str>) -> Option<Vec<u8>> {
    path.and_then(|p| std::fs::read(p).ok())
}

pub(crate) fn refuse_original_changed_during_dialog(
    picked: &str,
    original_path: Option<&str>,
    before: Option<&[u8]>,
    action_id: Option<&str>,
) -> Result<(), FileError> {
    if !original_path.is_some_and(|own| same_file(picked, own)) {
        return Ok(());
    }
    let current = std::fs::read(picked).ok();
    if current.as_deref() != before {
        log_file_event(
            "file.save_as",
            LogStatus::Fail,
            LogLevel::Warn,
            action_id,
            json!({ "source": "dialog", "reason": "changed_during_dialog" }),
            None,
            Some("original file changed while Save As was open".to_string()),
        );
        return Err(FileError::ExternalChangeConflict {
            path: picked.to_string(),
        });
    }
    Ok(())
}

#[cfg(test)]
#[path = "save_as_target_tests.rs"]
mod tests;

pub(crate) fn refuse_open_target(
    picked: &str,
    original_path: Option<&str>,
    action_id: Option<&str>,
    watcher: &FileWatcher,
) -> Result<(), FileError> {
    if original_path.is_some_and(|own| same_file(picked, own)) {
        let target = PathBuf::from(picked);
        let key = std::fs::canonicalize(&target).unwrap_or_else(|_| target.clone());
        if watcher.baselines().entry_of(&key).is_some()
            && watcher.baselines().is_unchanged_why(&target).as_str() != "unchanged"
        {
            log_file_event(
                "file.save_as",
                LogStatus::Fail,
                LogLevel::Warn,
                action_id,
                json!({ "source": "dialog", "reason": "external_change" }),
                None,
                Some("external change at original path".to_string()),
            );
            return Err(FileError::ExternalChangeConflict {
                path: picked.to_string(),
            });
        }
        return Ok(());
    }
    let target = PathBuf::from(picked);
    let group = holder_group_key(&target);
    if !watcher.consumer_spellings(&group).is_empty() {
        log_file_event(
            "file.save_as",
            LogStatus::Fail,
            LogLevel::Warn,
            action_id,
            json!({ "source": "dialog", "reason": "already_open" }),
            None,
            Some("selected target is already open in mdpro".to_string()),
        );
        return Err(FileError::AlreadyOpen {
            path: picked.to_string(),
        });
    }
    Ok(())
}
