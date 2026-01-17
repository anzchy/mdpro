use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Window;

use crate::models::{Document, Draft};

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

fn open_file_from_path(path: &str) -> Result<OpenFileResult, FileError> {
    let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        return Err(FileError::FileNotFound {
            path: path.to_string(),
        });
    }

    let metadata = std::fs::metadata(&path_buf).map_err(|err| to_file_error(err, path))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(FileError::FileTooLarge {
            path: path.to_string(),
            size: metadata.len(),
        });
    }

    let content = std::fs::read_to_string(&path_buf).map_err(|err| to_file_error(err, path))?;
    let document = Document::from_path(path_buf, content);

    Ok(OpenFileResult {
        document,
        recovered_draft: None,
    })
}

#[tauri::command]
pub async fn open_file(path: String) -> Result<OpenFileResult, FileError> {
    open_file_from_path(&path)
}

#[tauri::command]
pub fn create_document() -> Document {
    Document::new()
}

#[tauri::command]
pub async fn open_file_dialog(_window: Window) -> Result<Option<OpenFileResult>, FileError> {
    let picked = rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file();

    let Some(path) = picked else {
        return Ok(None);
    };

    open_file_from_path(&path.to_string_lossy()).map(Some)
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

    Ok(FileModifiedResult {
        modified: false,
        last_modified: mtime,
        current_mtime: mtime,
    })
}

#[tauri::command]
pub async fn reload_file(path: String) -> Result<Document, FileError> {
    let result = open_file_from_path(&path)?;
    Ok(result.document)
}
