//! D255 Save As preflight: refuse live open targets and unsafe original snapshots.
//! The original path uses a bounded before/after-picker read and the existing
//! disk-baseline conflict check. The caller holds the Save As/open lock while
//! checking live shadow documents, reserving and writing.
use super::super::file::{
    log_file_event, to_file_error, validate_file_path, FileError, MAX_FILE_SIZE,
};
use super::same_file;
use crate::models::{LogLevel, LogStatus, SharedShadowStore};
use crate::services::file_watcher::FileWatcher;
use crate::services::open_route::lookup;
use serde_json::json;
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
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

/// A missing original path is distinct from an unsafe or unreadable one.
#[derive(Debug)]
pub(crate) enum OriginalSnapshot {
    Missing,
    Bytes(Vec<u8>),
    Error(FileError),
}

impl OriginalSnapshot {
    pub(crate) fn as_deref(&self) -> Option<&[u8]> {
        match self {
            Self::Bytes(bytes) => Some(bytes),
            _ => None,
        }
    }

    pub(crate) fn into_result(self) -> Result<Option<Vec<u8>>, FileError> {
        match self {
            Self::Missing => Ok(None),
            Self::Bytes(bytes) => Ok(Some(bytes)),
            Self::Error(err) => Err(err),
        }
    }
}

/// Bounded, typed snapshot before the native picker. A shadow path authorises nothing.
pub(crate) fn original_bytes_before_dialog(path: Option<&str>) -> OriginalSnapshot {
    let Some(path) = path else {
        return OriginalSnapshot::Missing;
    };
    match read_snapshot(path) {
        Ok(bytes) => OriginalSnapshot::Bytes(bytes),
        Err(error) => OriginalSnapshot::Error(error),
    }
}

fn read_snapshot(path: &str) -> Result<Vec<u8>, FileError> {
    validate_file_path(path)?;
    let raw = Path::new(path);
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NONBLOCK);
    let mut file = options
        .open(raw)
        .map_err(|error| to_file_error(error, path))?;
    let metadata = file
        .metadata()
        .map_err(|error| to_file_error(error, path))?;
    if !metadata.is_file() {
        return Err(FileError::InvalidPath {
            path: path.to_string(),
        });
    }
    if metadata.len() > MAX_FILE_SIZE {
        return Err(FileError::FileTooLarge {
            path: path.to_string(),
            size: metadata.len(),
        });
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_FILE_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| to_file_error(error, path))?;
    snapshot_read_hook();
    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err(FileError::FileTooLarge {
            path: path.to_string(),
            size: bytes.len() as u64,
        });
    }
    let after = file
        .metadata()
        .map_err(|error| to_file_error(error, path))?;
    let at_path = std::fs::metadata(raw).map_err(|error| to_file_error(error, path))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.dev() != at_path.dev()
            || metadata.ino() != at_path.ino()
            || metadata.len() != after.len()
            || metadata.modified().ok() != after.modified().ok()
            || metadata.ctime() != after.ctime()
            || metadata.ctime_nsec() != after.ctime_nsec()
            || at_path.len() != after.len()
            || at_path.modified().ok() != after.modified().ok()
            || at_path.ctime() != after.ctime()
            || at_path.ctime_nsec() != after.ctime_nsec()
        {
            return Err(FileError::IoError {
                message: "original file changed during snapshot".into(),
            });
        }
    }
    Ok(bytes)
}

#[cfg(not(test))]
fn snapshot_read_hook() {}

#[cfg(test)]
thread_local! {
    static SNAPSHOT_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = std::cell::RefCell::new(None);
}

#[cfg(test)]
fn snapshot_read_hook() {
    SNAPSHOT_HOOK.with(|hook| {
        if let Some(hook) = hook.borrow_mut().take() {
            hook();
        }
    });
}

#[cfg(test)]
pub(crate) fn with_snapshot_read_hook<R>(
    hook: impl FnOnce() + 'static,
    f: impl FnOnce() -> R,
) -> R {
    SNAPSHOT_HOOK.with(|slot| *slot.borrow_mut() = Some(Box::new(hook)));
    let result = f();
    SNAPSHOT_HOOK.with(|slot| slot.borrow_mut().take());
    result
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
    let current = read_snapshot(picked).inspect_err(|_| {
        log_file_event(
            "file.save_as",
            LogStatus::Fail,
            LogLevel::Warn,
            action_id,
            json!({ "source": "dialog", "reason": "original_snapshot_refused" }),
            None,
            Some("original snapshot refused".into()),
        );
    })?;
    if Some(current.as_slice()) != before {
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

#[cfg(all(test, target_os = "macos"))]
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

/// Query live renderer-synced document paths at decision time using the open-route identity rule.
/// Only the saving document is excluded; an own-path spelling can retarget to
/// another open document while the picker is up.
pub(crate) fn refuse_live_open_target(
    picked: &str,
    own_window: &str,
    own_document_id: &str,
    action_id: Option<&str>,
    shadow: &SharedShadowStore,
    live_labels: &HashSet<String>,
) -> Result<(), FileError> {
    let incoming = lookup::canonical(picked);
    let paths: Vec<String> = shadow
        .lock()
        .map_err(|_| FileError::IoError {
            message: "document registry unavailable".into(),
        })?
        .windows
        .iter()
        .filter(|(label, _)| live_labels.contains(label.as_str()))
        .flat_map(|(label, state)| {
            state.documents.iter().filter_map(|doc| {
                (label.as_str() != own_window || doc.id != own_document_id)
                    .then(|| doc.path.clone())
                    .flatten()
            })
        })
        .collect();
    if paths
        .iter()
        .any(|stored| lookup::same_file(picked, incoming.as_ref(), stored))
    {
        log_file_event(
            "file.save_as",
            LogStatus::Fail,
            LogLevel::Warn,
            action_id,
            json!({ "source": "dialog", "reason": "already_open" }),
            None,
            Some("selected target is already open in mdpro".into()),
        );
        return Err(FileError::AlreadyOpen {
            path: picked.into(),
        });
    }
    Ok(())
}
