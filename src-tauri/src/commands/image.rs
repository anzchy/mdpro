use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveImagePathResult {
    /// Resolved absolute path
    pub absolute_path: String,
    /// Whether the file exists
    pub exists: bool,
    /// Whether the path is remote (URL)
    pub is_remote: bool,
    /// File size in bytes (if local and exists)
    pub file_size: Option<u64>,
    /// MIME type (if detectable)
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadImageResult {
    /// Relative path to inserted image
    pub relative_path: String,
    /// Absolute path where image was saved
    pub absolute_path: String,
    /// Generated Markdown syntax
    pub markdown_syntax: String,
    /// File size in bytes
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageUploadItem {
    /// Base64-encoded image data
    pub data: String,
    /// Desired filename
    pub filename: String,
    /// Alt text for Markdown
    pub alt_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadImagesBatchResult {
    /// Results for each image
    pub results: Vec<BatchItemResult>,
    /// Number of successful uploads
    pub success_count: usize,
    /// Number of failed uploads
    pub failure_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BatchItemResult {
    Success(UploadImageResult),
    Error { error: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyExternalImageResult {
    /// Relative path in asset folder
    pub relative_path: String,
    /// Absolute path where copied
    pub absolute_path: String,
    /// Generated Markdown syntax
    pub markdown_syntax: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageConfig {
    /// Default folder for uploaded images
    pub asset_folder: String,
    /// Whether to copy external images
    pub copy_external_images: bool,
    /// Whether to show preview before paste
    pub show_paste_preview: bool,
    /// Maximum dimension for auto-resize
    pub max_dimension: Option<u32>,
}

impl Default for ImageConfig {
    fn default() -> Self {
        Self {
            asset_folder: "./assets".to_string(),
            copy_external_images: true,
            show_paste_preview: true,
            max_dimension: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub enum ImageError {
    InvalidPath { message: String },
    DocumentNotSaved,
    PermissionDenied { path: String },
    DiskFull,
    InvalidImageData { message: String },
    UnsupportedFormat { format: String },
    SourceNotFound { path: String },
    AlreadyInProject { path: String },
    IoError { message: String },
}

fn image_error_message(error: &ImageError) -> String {
    match error {
        ImageError::InvalidPath { message } => format!("invalid path: {message}"),
        ImageError::DocumentNotSaved => "document has no path (not yet saved)".to_string(),
        ImageError::PermissionDenied { path } => format!("permission denied: {path}"),
        ImageError::DiskFull => "disk full".to_string(),
        ImageError::InvalidImageData { message } => format!("invalid image data: {message}"),
        ImageError::UnsupportedFormat { format } => format!("unsupported format: {format}"),
        ImageError::SourceNotFound { path } => format!("source not found: {path}"),
        ImageError::AlreadyInProject { path } => format!("already in project: {path}"),
        ImageError::IoError { message } => message.clone(),
    }
}

/// Guess MIME type from file extension
fn guess_mime_type(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    match ext.as_str() {
        "png" => Some("image/png".to_string()),
        "jpg" | "jpeg" => Some("image/jpeg".to_string()),
        "gif" => Some("image/gif".to_string()),
        "webp" => Some("image/webp".to_string()),
        "svg" => Some("image/svg+xml".to_string()),
        "bmp" => Some("image/bmp".to_string()),
        "ico" => Some("image/x-icon".to_string()),
        "tiff" | "tif" => Some("image/tiff".to_string()),
        _ => None,
    }
}

/// Resolve a relative or absolute image path to an absolute path
#[tauri::command]
pub async fn resolve_image_path(
    document_path: String,
    image_path: String,
) -> Result<ResolveImagePathResult, ImageError> {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "image.resolve".to_string(),
        status: LogStatus::Start,
        action_id: None,
        context: Some(serde_json::json!({
            "document_path": &document_path,
            "image_path": &image_path
        })),
        duration_ms: None,
        error: None,
    });

    // Check if remote URL
    if image_path.starts_with("http://") || image_path.starts_with("https://") {
        return Ok(ResolveImagePathResult {
            absolute_path: image_path,
            exists: true, // Assume remote exists
            is_remote: true,
            file_size: None,
            mime_type: None,
        });
    }

    // Get document directory
    let doc_path = Path::new(&document_path);
    let doc_dir = doc_path.parent().ok_or(ImageError::InvalidPath {
        message: "cannot get parent directory".to_string(),
    })?;

    // Resolve the image path
    let image_path_obj = Path::new(&image_path);
    let absolute_path = if image_path_obj.is_absolute() {
        image_path_obj.to_path_buf()
    } else {
        doc_dir.join(&image_path)
    };

    // Canonicalize if possible (resolves .., symlinks, etc.)
    let absolute_path = absolute_path
        .canonicalize()
        .unwrap_or_else(|_| absolute_path.clone());

    let exists = absolute_path.exists();
    let (file_size, mime_type) = if exists {
        let metadata = fs::metadata(&absolute_path).ok();
        let size = metadata.map(|m| m.len());
        let mime = guess_mime_type(&absolute_path);
        (size, mime)
    } else {
        (None, None)
    };

    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "image.resolve".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(serde_json::json!({
            "exists": exists,
            "is_remote": false
        })),
        duration_ms: None,
        error: None,
    });

    Ok(ResolveImagePathResult {
        absolute_path: absolute_path.to_string_lossy().to_string(),
        exists,
        is_remote: false,
        file_size,
        mime_type,
    })
}

/// Upload an image file to the asset folder
#[tauri::command]
pub async fn upload_image(
    document_path: String,
    image_data: String,
    filename: String,
    asset_folder: Option<String>,
) -> Result<UploadImageResult, ImageError> {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "image.upload".to_string(),
        status: LogStatus::Start,
        action_id: None,
        context: Some(serde_json::json!({
            "document_path": &document_path,
            "filename": &filename
        })),
        duration_ms: None,
        error: None,
    });

    let start = std::time::Instant::now();

    // Decode base64
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD.decode(&image_data).map_err(|e| ImageError::InvalidImageData {
        message: e.to_string(),
    })?;

    // Get document directory
    let doc_path = Path::new(&document_path);
    let doc_dir = doc_path.parent().ok_or(ImageError::DocumentNotSaved)?;

    // Get asset folder
    let asset_dir = asset_folder.unwrap_or_else(|| "./assets".to_string());
    let target_dir = doc_dir.join(&asset_dir);

    // Create directory if needed
    fs::create_dir_all(&target_dir).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            ImageError::PermissionDenied {
                path: target_dir.to_string_lossy().to_string(),
            }
        } else {
            ImageError::IoError {
                message: e.to_string(),
            }
        }
    })?;

    // Sanitize filename: extract basename only and reject empty/separator-only names
    // to prevent path traversal (e.g. "../../evil.sh").
    let safe_filename = Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty() && !n.starts_with('.') || n.len() > 1)
        .ok_or_else(|| ImageError::InvalidImageData {
            message: "Invalid filename".to_string(),
        })?
        .to_string();

    // Write file
    let target_path = target_dir.join(&safe_filename);
    fs::write(&target_path, &bytes).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            ImageError::PermissionDenied {
                path: target_path.to_string_lossy().to_string(),
            }
        } else {
            ImageError::IoError {
                message: e.to_string(),
            }
        }
    })?;

    // Generate relative path using the sanitized filename
    let relative_path = format!("{}/{}", asset_dir, safe_filename);
    let file_size = bytes.len() as u64;

    let duration = start.elapsed().as_millis() as u64;

    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "image.upload".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(serde_json::json!({
            "relative_path": &relative_path,
            "file_size": file_size
        })),
        duration_ms: Some(duration),
        error: None,
    });

    Ok(UploadImageResult {
        relative_path: relative_path.clone(),
        absolute_path: target_path.to_string_lossy().to_string(),
        markdown_syntax: format!("![]({})", relative_path),
        file_size,
    })
}

/// Upload multiple images at once
#[tauri::command]
pub async fn upload_images_batch(
    document_path: String,
    images: Vec<ImageUploadItem>,
    asset_folder: Option<String>,
) -> Result<UploadImagesBatchResult, ImageError> {
    let mut results = Vec::new();
    let mut success_count = 0;
    let mut failure_count = 0;

    for item in images {
        match upload_image(
            document_path.clone(),
            item.data,
            item.filename,
            asset_folder.clone(),
        )
        .await
        {
            Ok(result) => {
                success_count += 1;
                results.push(BatchItemResult::Success(result));
            }
            Err(e) => {
                failure_count += 1;
                results.push(BatchItemResult::Error {
                    error: image_error_message(&e),
                });
            }
        }
    }

    Ok(UploadImagesBatchResult {
        results,
        success_count,
        failure_count,
    })
}

/// Copy an external image to the asset folder
#[tauri::command]
pub async fn copy_external_image(
    document_path: String,
    source_path: String,
    asset_folder: Option<String>,
) -> Result<CopyExternalImageResult, ImageError> {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "image.copy_external".to_string(),
        status: LogStatus::Start,
        action_id: None,
        context: Some(serde_json::json!({
            "source_path": &source_path
        })),
        duration_ms: None,
        error: None,
    });

    let source = Path::new(&source_path);

    // Check if source exists
    if !source.exists() {
        return Err(ImageError::SourceNotFound {
            path: source_path.clone(),
        });
    }

    // Get document directory
    let doc_path = Path::new(&document_path);
    let doc_dir = doc_path.parent().ok_or(ImageError::DocumentNotSaved)?;

    // Check if already in project
    if let Ok(source_canonical) = source.canonicalize() {
        if let Ok(doc_canonical) = doc_dir.canonicalize() {
            if source_canonical.starts_with(&doc_canonical) {
                return Err(ImageError::AlreadyInProject {
                    path: source_path.clone(),
                });
            }
        }
    }

    // Get asset folder
    let asset_dir = asset_folder.unwrap_or_else(|| "./assets".to_string());
    let target_dir = doc_dir.join(&asset_dir);

    // Create directory if needed
    fs::create_dir_all(&target_dir).map_err(|e| ImageError::IoError {
        message: e.to_string(),
    })?;

    // Copy file
    let filename = source
        .file_name()
        .ok_or(ImageError::InvalidPath {
            message: "cannot get filename".to_string(),
        })?
        .to_string_lossy()
        .to_string();

    let target_path = target_dir.join(&filename);
    fs::copy(source, &target_path).map_err(|e| ImageError::IoError {
        message: e.to_string(),
    })?;

    let relative_path = format!("{}/{}", asset_dir, filename);

    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "image.copy_external".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(serde_json::json!({
            "relative_path": &relative_path
        })),
        duration_ms: None,
        error: None,
    });

    Ok(CopyExternalImageResult {
        relative_path: relative_path.clone(),
        absolute_path: target_path.to_string_lossy().to_string(),
        markdown_syntax: format!("![]({})", relative_path),
    })
}

/// Get the user's image configuration
#[tauri::command]
pub async fn get_image_config() -> Result<ImageConfig, ImageError> {
    // For now, return default config
    // TODO: Load from preferences
    Ok(ImageConfig::default())
}

/// Update the user's image configuration
#[tauri::command]
pub async fn set_image_config(config: ImageConfig) -> Result<bool, ImageError> {
    // TODO: Save to preferences
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "image.config_update".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(serde_json::json!({
            "asset_folder": &config.asset_folder,
            "copy_external_images": config.copy_external_images,
            "show_paste_preview": config.show_paste_preview
        })),
        duration_ms: None,
        error: None,
    });

    Ok(true)
}
