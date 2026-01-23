use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{State, Window};

use crate::models::{Document, Draft};
use crate::services::{encoding, file_watcher::FileWatcher, logger};

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileResult {
    pub document: Document,
    pub recovered_draft: Option<Draft>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub success: bool,
    pub path: String,
    pub saved_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseResult {
    pub success: bool,
    pub draft_deleted: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileModifiedResult {
    pub modified: bool,
    pub last_modified: i64,
    pub current_mtime: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum FileError {
    FileNotFound { path: String },
    PermissionDenied { path: String },
    EncodingError { path: String, detected: String },
    FileTooLarge { path: String, size: u64 },
    DiskFull,
    InvalidPath { path: String },
    IoError { message: String },
}

fn to_file_error(error: std::io::Error, path: &str) -> FileError {
    use std::io::ErrorKind;

    match error.kind() {
        ErrorKind::NotFound => FileError::FileNotFound {
            path: path.to_string(),
        },
        ErrorKind::PermissionDenied => FileError::PermissionDenied {
            path: path.to_string(),
        },
        ErrorKind::InvalidData => FileError::EncodingError {
            path: path.to_string(),
            detected: "unknown".to_string(),
        },
        ErrorKind::WriteZero | ErrorKind::OutOfMemory => FileError::DiskFull,
        _ => FileError::IoError {
            message: error.to_string(),
        },
    }
}

fn mtime_cache() -> &'static Mutex<HashMap<String, i64>> {
    static CACHE: OnceLock<Mutex<HashMap<String, i64>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn open_file_from_path(path: &str, encoding_hint: Option<String>) -> Result<OpenFileResult, FileError> {
    logger::log_line(&format!("open_file_from_path: {}", path));
    let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        logger::log_line(&format!("open_file_from_path: file not found {}", path));
        return Err(FileError::FileNotFound {
            path: path.to_string(),
        });
    }

    let metadata = std::fs::metadata(&path_buf).map_err(|err| {
        logger::log_line(&format!(
            "open_file_from_path: metadata error {}: {}",
            path, err
        ));
        to_file_error(err, path)
    })?;
    if metadata.len() > MAX_FILE_SIZE {
        logger::log_line(&format!(
            "open_file_from_path: file too large {} size={}",
            path,
            metadata.len()
        ));
        return Err(FileError::FileTooLarge {
            path: path.to_string(),
            size: metadata.len(),
        });
    }

    if let Ok(modified) = metadata.modified() {
        if let Ok(duration) = modified.duration_since(std::time::SystemTime::UNIX_EPOCH) {
            if let Ok(mut cache) = mtime_cache().lock() {
                cache.insert(path.to_string(), duration.as_millis() as i64);
            }
        }
    }

    let bytes = std::fs::read(&path_buf).map_err(|err| {
        logger::log_line(&format!("open_file_from_path: read error {}: {}", path, err));
        to_file_error(err, path)
    })?;
    logger::log_line(&format!(
        "open_file_from_path: read bytes {}",
        bytes.len()
    ));
    let detected = encoding::detect_encoding(&bytes);
    let encoding_value = encoding_hint.clone().unwrap_or_else(|| detected.clone());
    let content = encoding::decode_bytes(&bytes, &encoding_value).map_err(|_| {
        logger::log_line(&format!(
            "open_file_from_path: encoding error {} detected={}",
            path, detected
        ));
        FileError::EncodingError {
            path: path.to_string(),
            detected,
        }
    })?;
    logger::log_line(&format!(
        "open_file_from_path: decoded chars {}",
        content.len()
    ));

    let mut document = Document::from_path(path_buf, content);
    document.encoding = encoding_value;
    logger::log_line(&format!(
        "open_file_from_path: created document id {}",
        document.id
    ));

    Ok(OpenFileResult {
        document,
        recovered_draft: None,
    })
}

#[tauri::command]
pub async fn open_file(
    path: String,
    encoding: Option<String>,
    watcher: State<'_, FileWatcher>,
) -> Result<OpenFileResult, FileError> {
    logger::log_line(&format!(
        "command open_file: path={} encoding={:?}",
        path, encoding
    ));
    let result = open_file_from_path(&path, encoding)?;
    watcher.watch(&PathBuf::from(&path));
    logger::log_line(&format!("command open_file: watch {}", path));
    Ok(result)
}

#[tauri::command]
pub fn create_document() -> Document {
    Document::new()
}

#[tauri::command]
pub async fn open_file_dialog(
    _window: Window,
    watcher: State<'_, FileWatcher>,
) -> Result<Option<OpenFileResult>, FileError> {
    logger::log_line("command open_file_dialog: invoked");
    let picked = rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file();

    let Some(path) = picked else {
        logger::log_line("command open_file_dialog: cancelled");
        return Ok(None);
    };

    let path_string = path.to_string_lossy().to_string();
    logger::log_line(&format!(
        "command open_file_dialog: picked {}",
        path_string
    ));
    let result = open_file_from_path(&path_string, None)?;
    logger::log_line(&format!(
        "command open_file_dialog: read ok, chars {}",
        result.document.content.len()
    ));
    watcher.watch(&PathBuf::from(&path_string));
    logger::log_line(&format!(
        "command open_file_dialog: watch {}",
        path_string
    ));
    Ok(Some(result))
}

#[tauri::command]
pub async fn save_file(
    _document_id: String,
    content: String,
    path: Option<String>,
) -> Result<SaveResult, FileError> {
    let path_value = path.ok_or_else(|| FileError::InvalidPath {
        path: "missing path".to_string(),
    })?;

    let path_buf = PathBuf::from(&path_value);
    if let Some(parent) = path_buf.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|err| to_file_error(err, &path_value))?;
        }
    }

    std::fs::write(&path_buf, content).map_err(|err| to_file_error(err, &path_value))?;

    Ok(SaveResult {
        success: true,
        path: path_value,
        saved_at: chrono::Utc::now().timestamp_millis(),
    })
}

#[tauri::command]
pub async fn save_file_dialog(
    _window: Window,
    document_id: String,
    content: String,
    suggested_name: Option<String>,
) -> Result<Option<SaveResult>, FileError> {
    let mut dialog = rfd::FileDialog::new().add_filter("Markdown", &["md", "markdown"]);
    if let Some(name) = suggested_name {
        dialog = dialog.set_file_name(&name);
    }

    let Some(path) = dialog.save_file() else {
        return Ok(None);
    };

    save_file(document_id, content, Some(path.to_string_lossy().to_string()))
        .await
        .map(Some)
}

#[tauri::command]
pub async fn close_document(
    document_id: String,
    discard_changes: bool,
) -> Result<CloseResult, FileError> {
    if !discard_changes {
        return Err(FileError::IoError {
            message: format!("Document {document_id} has unsaved changes"),
        });
    }

    Ok(CloseResult {
        success: true,
        draft_deleted: false,
    })
}

#[tauri::command]
pub async fn check_file_modified(path: String) -> Result<FileModifiedResult, FileError> {
    let metadata = std::fs::metadata(&path).map_err(|err| to_file_error(err, &path))?;
    let modified = metadata.modified().map_err(|err| to_file_error(err, &path))?;
    let mtime = modified
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .map_err(|err| FileError::IoError {
            message: err.to_string(),
        })?
        .as_millis() as i64;

    let mut cache = mtime_cache()
        .lock()
        .map_err(|_| FileError::IoError {
            message: "mtime cache locked".to_string(),
        })?;
    let stored = cache.entry(path.clone()).or_insert(mtime);

    Ok(FileModifiedResult {
        modified: mtime > *stored,
        last_modified: mtime,
        current_mtime: *stored,
    })
}

#[tauri::command]
pub async fn reload_file(path: String) -> Result<Document, FileError> {
    let result = open_file_from_path(&path, None)?;
    if let Ok(mut cache) = mtime_cache().lock() {
        if let Ok(metadata) = std::fs::metadata(&path) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(duration) = modified.duration_since(std::time::SystemTime::UNIX_EPOCH) {
                    cache.insert(path.clone(), duration.as_millis() as i64);
                }
            }
        }
    }
    Ok(result.document)
}
