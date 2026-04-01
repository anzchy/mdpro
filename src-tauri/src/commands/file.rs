use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{State, Window};

use crate::models::{Document, Draft, LogEntryPayload, LogLevel, LogStatus};
use crate::services::{draft::delete_draft as delete_draft_service, encoding, file_watcher::FileWatcher, logger};

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS: &[&str] = &["md", "markdown", "txt", "mdx"];

/// Validate that a file path is safe for open/save operations.
/// Rejects path traversal and non-document file extensions.
fn validate_file_path(path: &str) -> Result<(), FileError> {
    let p = std::path::Path::new(path);
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(FileError::InvalidPath {
            path: path.to_string(),
        });
    }
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !ALLOWED_EXTENSIONS.contains(&ext) {
        return Err(FileError::InvalidPath {
            path: format!("unsupported file type: .{}", ext),
        });
    }
    Ok(())
}

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

fn file_error_message(error: &FileError) -> String {
    match error {
        FileError::FileNotFound { path } => format!("file not found: {path}"),
        FileError::PermissionDenied { path } => format!("permission denied: {path}"),
        FileError::EncodingError { path, detected } => {
            format!("encoding error: {path} detected={detected}")
        }
        FileError::FileTooLarge { path, size } => {
            format!("file too large: {path} size={size}")
        }
        FileError::DiskFull => "disk full".to_string(),
        FileError::InvalidPath { path } => format!("invalid path: {path}"),
        FileError::IoError { message } => message.clone(),
    }
}

fn log_file_event(
    event: &str,
    status: LogStatus,
    level: LogLevel,
    action_id: Option<&str>,
    context: serde_json::Value,
    duration_ms: Option<u64>,
    error: Option<String>,
) {
    logger::log_event(LogEntryPayload {
        level,
        event: event.to_string(),
        status,
        action_id: action_id.map(|value| value.to_string()),
        context: Some(context),
        duration_ms,
        error,
    });
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

    let content = normalize_line_endings(&content);
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

/// Normalize all line endings to LF (`\n`).
///
/// Handles:
/// - `\r\n` (Windows CRLF) → `\n`
/// - lone `\r` (old Mac CR) → `\n`
fn normalize_line_endings(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_crlf_to_lf() {
        let input = "line one\r\nline two\r\nline three";
        let expected = "line one\nline two\nline three";
        assert_eq!(normalize_line_endings(input), expected);
    }

    #[test]
    fn test_normalize_preserves_lf_only() {
        let input = "line one\nline two\nline three";
        assert_eq!(normalize_line_endings(input), input);
    }

    #[test]
    fn test_normalize_handles_cr_only() {
        let input = "line one\rline two\rline three";
        let expected = "line one\nline two\nline three";
        assert_eq!(normalize_line_endings(input), expected);
    }

    #[test]
    fn test_normalize_mixed_line_endings() {
        let input = "crlf\r\nlf\ncr\r";
        let expected = "crlf\nlf\ncr\n";
        assert_eq!(normalize_line_endings(input), expected);
    }

    #[test]
    fn test_normalize_empty_string() {
        assert_eq!(normalize_line_endings(""), "");
    }

    #[test]
    fn test_normalize_no_newlines() {
        let input = "no newlines here";
        assert_eq!(normalize_line_endings(input), input);
    }

    #[test]
    fn test_validate_file_path_accepts_md() {
        assert!(validate_file_path("/Users/test/doc.md").is_ok());
    }

    #[test]
    fn test_validate_file_path_accepts_markdown() {
        assert!(validate_file_path("/Users/test/doc.markdown").is_ok());
    }

    #[test]
    fn test_validate_file_path_accepts_txt() {
        assert!(validate_file_path("/Users/test/notes.txt").is_ok());
    }

    #[test]
    fn test_validate_file_path_accepts_mdx() {
        assert!(validate_file_path("/Users/test/page.mdx").is_ok());
    }

    #[test]
    fn test_validate_file_path_rejects_traversal() {
        let result = validate_file_path("/Users/test/../../../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_file_path_rejects_unsupported_extension() {
        let result = validate_file_path("/Users/test/.bashrc");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_file_path_rejects_no_extension() {
        let result = validate_file_path("/Users/test/authorized_keys");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_file_path_rejects_sensitive_paths() {
        assert!(validate_file_path("/Users/test/.ssh/id_rsa").is_err());
        assert!(validate_file_path("/etc/passwd").is_err());
    }
}

#[tauri::command]
pub async fn open_file(
    path: String,
    encoding: Option<String>,
    action_id: Option<String>,
    watcher: State<'_, FileWatcher>,
) -> Result<OpenFileResult, FileError> {
    validate_file_path(&path)?;
    let action_id = action_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let start = std::time::Instant::now();
    log_file_event(
        "file.open",
        LogStatus::Start,
        LogLevel::Info,
        Some(&action_id),
        json!({ "filePath": path.as_str(), "encodingHint": encoding.as_deref() }),
        None,
        None,
    );
    let path_for_error = path.clone();
    let result = open_file_from_path(&path, encoding).map_err(|err| {
        log_file_event(
            "file.open",
            LogStatus::Fail,
            LogLevel::Error,
            Some(&action_id),
            json!({ "filePath": path_for_error }),
            Some(start.elapsed().as_millis() as u64),
            Some(file_error_message(&err)),
        );
        err
    })?;
    watcher.watch(&PathBuf::from(&path));
    log_file_event(
        "file.open",
        LogStatus::Success,
        LogLevel::Info,
        Some(&action_id),
        json!({
            "filePath": path.as_str(),
            "fileSizeBytes": result.document.file_size,
            "encoding": result.document.encoding
        }),
        Some(start.elapsed().as_millis() as u64),
        None,
    );
    Ok(result)
}

#[tauri::command]
pub fn create_document() -> Result<Document, String> {
    Ok(Document::new())
}

#[tauri::command]
pub async fn open_file_dialog(
    _window: Window,
    watcher: State<'_, FileWatcher>,
    action_id: Option<String>,
) -> Result<Option<OpenFileResult>, FileError> {
    let action_id = action_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let start = std::time::Instant::now();
    log_file_event(
        "file.open",
        LogStatus::Start,
        LogLevel::Info,
        Some(&action_id),
        json!({ "source": "dialog" }),
        None,
        None,
    );
    let picked = rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file();

    let Some(path) = picked else {
        log_file_event(
            "file.open",
            LogStatus::Cancel,
            LogLevel::Warn,
            Some(&action_id),
            json!({ "source": "dialog" }),
            Some(start.elapsed().as_millis() as u64),
            None,
        );
        return Ok(None);
    };

    let path_string = path.to_string_lossy().to_string();
    let path_for_error = path_string.clone();
    let result = open_file_from_path(&path_string, None).map_err(|err| {
        log_file_event(
            "file.open",
            LogStatus::Fail,
            LogLevel::Error,
            Some(&action_id),
            json!({ "filePath": path_for_error }),
            Some(start.elapsed().as_millis() as u64),
            Some(file_error_message(&err)),
        );
        err
    })?;
    watcher.watch(&PathBuf::from(&path_string));
    log_file_event(
        "file.open",
        LogStatus::Success,
        LogLevel::Info,
        Some(&action_id),
        json!({
            "filePath": path_string.as_str(),
            "fileSizeBytes": result.document.file_size,
            "encoding": result.document.encoding,
            "source": "dialog"
        }),
        Some(start.elapsed().as_millis() as u64),
        None,
    );
    Ok(Some(result))
}

#[tauri::command]
pub async fn save_file(
    _document_id: String,
    content: String,
    path: Option<String>,
    action_id: Option<String>,
) -> Result<SaveResult, FileError> {
    let path_value = path.ok_or_else(|| FileError::InvalidPath {
        path: "missing path".to_string(),
    })?;
    validate_file_path(&path_value)?;
    let action_id = action_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let start = std::time::Instant::now();
    log_file_event(
        "file.save",
        LogStatus::Start,
        LogLevel::Info,
        Some(&action_id),
        json!({ "filePath": path_value.as_str() }),
        None,
        None,
    );

    let path_buf = PathBuf::from(&path_value);
    if let Some(parent) = path_buf.parent() {
        if !parent.exists() {
            let path_for_error = path_value.clone();
            std::fs::create_dir_all(parent).map_err(|err| {
                let mapped = to_file_error(err, &path_value);
                log_file_event(
                    "file.save",
                    LogStatus::Fail,
                    LogLevel::Error,
                    Some(&action_id),
                    json!({ "filePath": path_for_error }),
                    Some(start.elapsed().as_millis() as u64),
                    Some(file_error_message(&mapped)),
                );
                mapped
            })?;
        }
    }

    let path_for_error = path_value.clone();
    std::fs::write(&path_buf, content.as_bytes()).map_err(|err| {
        let mapped = to_file_error(err, &path_value);
        log_file_event(
            "file.save",
            LogStatus::Fail,
            LogLevel::Error,
            Some(&action_id),
            json!({ "filePath": path_for_error }),
            Some(start.elapsed().as_millis() as u64),
            Some(file_error_message(&mapped)),
        );
        mapped
    })?;

    log_file_event(
        "file.save",
        LogStatus::Success,
        LogLevel::Info,
        Some(&action_id),
        json!({
            "filePath": path_value.as_str(),
            "fileSizeBytes": content.as_bytes().len()
        }),
        Some(start.elapsed().as_millis() as u64),
        None,
    );
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
    action_id: Option<String>,
) -> Result<Option<SaveResult>, FileError> {
    let action_id = action_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut dialog = rfd::FileDialog::new().add_filter("Markdown", &["md", "markdown"]);
    if let Some(name) = suggested_name {
        dialog = dialog.set_file_name(&name);
    }

    let Some(path) = dialog.save_file() else {
        log_file_event(
            "file.save",
            LogStatus::Cancel,
            LogLevel::Warn,
            Some(&action_id),
            json!({ "source": "dialog" }),
            None,
            None,
        );
        return Ok(None);
    };

    save_file(
        document_id,
        content,
        Some(path.to_string_lossy().to_string()),
        Some(action_id),
    )
        .await
        .map(Some)
}

#[tauri::command]
pub async fn close_document(
    document_id: String,
    discard_changes: bool,
    path: Option<String>,
    watcher: State<'_, FileWatcher>,
) -> Result<CloseResult, FileError> {
    if !discard_changes {
        return Err(FileError::IoError {
            message: format!("Document {document_id} has unsaved changes"),
        });
    }

    if let Some(ref p) = path {
        watcher.unwatch(&PathBuf::from(p));
    }

    let draft_deleted = delete_draft_service(&document_id).unwrap_or(false);

    Ok(CloseResult {
        success: true,
        draft_deleted,
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
