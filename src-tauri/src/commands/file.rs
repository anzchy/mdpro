use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{State, Window};

use super::save_as_watch::{refused_save_as, save_as_watched_with};
use crate::models::{Document, Draft, LogEntryPayload, LogLevel, LogStatus, SharedShadowStore};
use crate::services::{
    draft::delete_draft as delete_draft_service,
    encoding,
    file_watcher::{self, BaselineStore, FileWatcher},
    logger, shadow_store,
};

pub(crate) const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS: &[&str] = &["md", "markdown", "txt", "mdx"];

/// Validate that a file path is safe for open/save operations.
/// Rejects path traversal and non-document file extensions.
/// Also used by `draft_recover_watch` to gate the D59 recover-time watch.
pub(crate) fn validate_file_path(path: &str) -> Result<(), FileError> {
    let p = std::path::Path::new(path);
    if p.components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
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
    /// D111: the file changed between the open's read and the watch
    /// registration (or the check failed open), so the document may not hold
    /// what is on disk (`FileWatcher::watch_seeded`, ADR-0081).
    pub changed_since_read: bool,
    /// D173: the gen of the watch hold this reply's acquisition confirmed;
    /// 0 when it took none (refused, fenced, failed). Gen 0 is never issued.
    #[serde(default)]
    pub hold_gen: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub success: bool,
    pub path: String,
    pub saved_at: i64,
    /// D111: Save As only. The target changed between the write and the watch
    /// registration (or the check failed open). Always `false` from `save_file`.
    pub changed_since_read: bool,
    /// D111-WI-1: Save As only. The dialog picked the document's own path while
    /// it has an unresolved external change, so nothing was written
    /// (`success` is `false`). Always `false` from `save_file`.
    pub blocked_by_pending_change: bool,
    /// D173: the gen of the watch hold this reply's acquisition confirmed;
    /// 0 when it took none (refused, fenced, failed). Gen 0 is never issued.
    #[serde(default)]
    pub hold_gen: u64,
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

pub(crate) fn log_file_event(
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

/// Open `path` from one read and return the document; the seed is dropped.
/// `reload_file` uses it (no watcher registers there), and the D86 WI-3 tests
/// use it as the reference the seeded open must equal.
pub(crate) fn open_file_from_path(
    path: &str,
    encoding_hint: Option<String>,
) -> Result<OpenFileResult, FileError> {
    open_file_from_path_seeded(path, encoding_hint).map(|(result, _)| result)
}

/// The decode half of an open: the bytes `open_file_from_path_seeded` read
/// once, decoded into the document. Never reads the file (D86 WI-3), so the
/// editor holds exactly the bytes the open's baseline seed describes.
/// A hinted UTF-16 decode that fails `encoding::hinted_decode_refusal` (D52)
/// is an `EncodingError`, logged as `file.open.encoding_refused`.
pub(crate) fn decode_opened(
    path: &str,
    path_buf: PathBuf,
    bytes: Vec<u8>,
    encoding_hint: Option<String>,
) -> Result<OpenFileResult, FileError> {
    logger::log_line(&format!("open_file_from_path: read bytes {}", bytes.len()));
    // Detect with confidence (WI-0.3): a non-UTF-8 file with no recognised BOM
    // is "unknown"/Low — we refuse to guess (no blind Latin-1) and surface an
    // EncodingError rather than corrupt the content. A user-supplied hint still
    // takes precedence (explicit conversion), but a UTF-16 hint must pass the
    // D52 plausibility check below.
    let (detected, _confidence) = encoding::detect_encoding_with_confidence(&bytes);
    let encoding_value = encoding_hint.clone().unwrap_or_else(|| detected.clone());
    let content = encoding::decode_bytes(&bytes, &encoding_value).map_err(|_| {
        logger::log_line(&format!(
            "open_file_from_path: encoding error {} detected={}",
            path, detected
        ));
        FileError::EncodingError {
            path: path.to_string(),
            detected: detected.clone(),
        }
    })?;
    // D52 (ADR-0057 decision 3): a UTF-16 hint from the encoding dialog is
    // refused unless the decode is plausible, because `from_utf16` accepts
    // nearly any even-length bytes and ⌘S would then rewrite the file as
    // UTF-16. Same `EncodingError` shape as above, so no IPC contract change.
    if let Some(hint) = encoding_hint.as_deref() {
        if let Some(reason) = encoding::hinted_decode_refusal(&bytes, hint, &content) {
            log_file_event(
                "file.open.encoding_refused",
                LogStatus::Fail,
                LogLevel::Warn,
                None,
                json!({
                    "filePath": path,
                    "encodingHint": hint,
                    "detected": detected.as_str(),
                    "reason": reason.as_str(),
                }),
                None,
                None,
            );
            return Err(FileError::EncodingError {
                path: path.to_string(),
                detected,
            });
        }
    }
    logger::log_line(&format!(
        "open_file_from_path: decoded chars {}",
        content.len()
    ));

    // Capture the original EOL style before normalizing to LF so save can
    // restore it (Fix 2 — no silent CRLF→LF on round-trip).
    let line_ending = detect_line_ending(&content);
    let content = normalize_line_endings(&content);
    let mut document = Document::from_path(path_buf, content);
    document.encoding = encoding_value;
    document.line_ending = line_ending.to_string();
    logger::log_line(&format!(
        "open_file_from_path: created document id {}",
        document.id
    ));

    Ok(OpenFileResult {
        document,
        recovered_draft: None,
        changed_since_read: false,
        hold_gen: 0,
    })
}

#[path = "file_open_seed.rs"]
pub(crate) mod open_seed;
pub(crate) use open_seed::open_file_from_path_seeded;

/// Normalize all line endings to LF (`\n`).
///
/// Handles:
/// - `\r\n` (Windows CRLF) → `\n`
/// - lone `\r` (old Mac CR) → `\n`
fn normalize_line_endings(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

/// The line-ending style a file used on disk, so an open→edit→save round-trip
/// restores it instead of silently rewriting every line to LF.
///
/// Detection precedence: any `\r\n` ⇒ CRLF; otherwise any lone `\r` ⇒ CR;
/// otherwise LF (the editor's internal representation and our default).
fn detect_line_ending(content: &str) -> &'static str {
    if content.contains("\r\n") {
        "crlf"
    } else if content.contains('\r') {
        "cr"
    } else {
        "lf"
    }
}

/// Convert LF-only `content` (the editor's internal form) back to the document's
/// original line-ending style for writing to disk. An absent or `"lf"` style is
/// written unchanged. The input is normalized to LF first so a re-conversion is
/// idempotent and never produces `\r\r\n`.
fn restore_line_endings(content: &str, line_ending: Option<&str>) -> String {
    let normalized = normalize_line_endings(content);
    match line_ending {
        Some("crlf") => normalized.replace('\n', "\r\n"),
        Some("cr") => normalized.replace('\n', "\r"),
        _ => normalized,
    }
}

/// Encode document content for writing to disk, in the document's original
/// encoding (WI-0.3 — save back in the original encoding, no silent
/// conversion). An absent or empty hint means UTF-8. An unsupported encoding
/// returns an error so the save fails loudly instead of writing mislabelled
/// bytes.
fn encode_for_save(content: &str, encoding_hint: Option<&str>) -> Result<Vec<u8>, FileError> {
    let enc = match encoding_hint {
        None | Some("") => "UTF-8",
        Some(e) => e,
    };
    encoding::encode_bytes(content, enc).map_err(|message| FileError::IoError { message })
}

/// Process-wide sequence that makes every `atomic_write` temp name unique (D70).
static ATOMIC_WRITE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Same-directory temp path for one `atomic_write` call:
/// `.{file_name}.{pid}.{seq}.tmp`. The pid scopes it to this process and the
/// sequence number to this call, so two concurrent saves of one target (D70)
/// never write through the same temp file.
fn atomic_temp_path(parent: &std::path::Path, target: &std::path::Path) -> PathBuf {
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("mdpro");
    let seq = ATOMIC_WRITE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    parent.join(format!(".{}.{}.{}.tmp", file_name, std::process::id(), seq))
}

/// Atomically write `bytes` to `target`.
///
/// Truncate-then-write (`std::fs::write`) destroys the original file if the
/// process dies or the disk fills mid-write: the user is left with a truncated
/// or empty file and the prior contents are gone. Instead we:
///   1. Write to a temp file in the *same directory* (so the final `rename` is a
///      same-filesystem atomic operation, not a cross-device copy). The temp
///      name is unique per call and created with `create_new` (D70), so
///      concurrent writes to one target each rename a whole payload.
///   2. `flush` + `sync_all` (fsync) the temp file so its bytes are durable.
///   3. `rename` the temp over the target — atomic on POSIX: a concurrent reader
///      sees either the whole old file or the whole new file, never a partial.
///   4. fsync the parent directory so the rename itself is durable.
///   5. Preserve the original file's permissions on the replacement.
///
/// On any failure the temp file is removed and the original target is left
/// untouched, so a failed save never loses the prior contents.
fn atomic_write(target: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;

    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "target has no parent dir")
    })?;

    // Capture the original permissions (if the file exists) so the atomic
    // replacement keeps the same mode rather than inheriting the temp's.
    let original_perms = std::fs::metadata(target).ok().map(|m| m.permissions());

    // D70: a temp path unique to this call, opened with `create_new`, so two
    // concurrent saves of the same file never share (or truncate) one temp.
    let tmp_path = atomic_temp_path(parent, target);

    // Scoped block so the File handle is closed before the rename.
    let write_and_sync = || -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        Ok(())
    };

    if let Err(e) = write_and_sync() {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e);
    }

    // Restore original permissions onto the temp before the rename so the
    // replaced file keeps its mode.
    if let Some(perms) = original_perms {
        let _ = std::fs::set_permissions(&tmp_path, perms);
    }

    if let Err(e) = std::fs::rename(&tmp_path, target) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e);
    }

    // Durability of the rename itself: fsync the directory. Best-effort —
    // some platforms/filesystems don't support opening a dir for fsync, and a
    // failure here doesn't mean data loss (the rename already succeeded).
    if let Ok(dir) = std::fs::File::open(parent) {
        let _ = dir.sync_all();
    }

    Ok(())
}

/// Allowed file extensions for save operations.
const ALLOWED_SAVE_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "mdown", "mkd", "mkdn", "mdtxt", "mdtext", "html", "htm",
    "css", "json", "yaml", "yml", "toml", "xml", "csv", "tsv", "log", "cfg", "conf", "ini", "rst",
    "adoc", "tex", "bib",
];

/// Validate that a save path is safe:
/// 1. No path traversal (`..` components)
/// 2. File extension is in the allowlist
fn validate_save_path(path: &std::path::Path) -> Result<(), &'static str> {
    // Reject path traversal
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return Err("path traversal (..) is not allowed");
        }
    }

    // Also check the resolved path for symlink-based traversal
    // (only if parent exists — new files may not be resolvable yet)
    if let Some(parent) = path.parent() {
        if parent.exists() {
            if let (Ok(canonical_parent), Some(file_name)) =
                (parent.canonicalize(), path.file_name())
            {
                let canonical_path = canonical_parent.join(file_name);
                // Ensure the canonical path doesn't escape to unexpected locations
                // by checking it still starts with the canonical parent
                if !canonical_path.starts_with(&canonical_parent) {
                    return Err("resolved path escapes parent directory");
                }
            }
        }
    }

    // Validate extension
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext_lower = ext.to_lowercase();
            if !ALLOWED_SAVE_EXTENSIONS.contains(&ext_lower.as_str()) {
                return Err("file extension is not allowed for save operations");
            }
        }
        None => {
            return Err("file must have an extension");
        }
    }

    Ok(())
}

#[cfg(test)]
#[path = "file_size_limit_tests.rs"]
mod file_size_limit_tests;

#[cfg(test)]
#[path = "atomic_write_tests.rs"]
mod atomic_write_tests;

#[cfg(test)]
#[path = "file_encoding_hint_tests.rs"]
mod file_encoding_hint_tests;

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

    // -----------------------------------------------------------------------
    // WI-0.3 — safe save round-trip (no silent re-encoding)
    // -----------------------------------------------------------------------

    #[test]
    fn test_encode_for_save_defaults_to_utf8_when_no_encoding() {
        let bytes = encode_for_save("hello", None).expect("encode");
        assert_eq!(bytes, b"hello".to_vec());
    }

    #[test]
    fn test_encode_for_save_preserves_utf16le() {
        // A document opened as UTF-16LE must be saved back as UTF-16LE (with
        // BOM), not silently downgraded to UTF-8.
        let bytes = encode_for_save("hi", Some("UTF-16LE")).expect("encode");
        assert_eq!(&bytes[..2], &[0xFF, 0xFE], "UTF-16LE BOM must be written");
        // Decoding it back yields the original content.
        assert_eq!(encoding::decode_bytes(&bytes, "UTF-16LE").unwrap(), "hi");
    }

    #[test]
    fn test_encode_for_save_round_trips_open_then_save() {
        // Full round-trip: original UTF-16 file → open content → save content
        // → byte-identical file.
        let original = encoding::encode_bytes("世界\r\nsecond", "UTF-16BE").unwrap();
        let opened = encoding::decode_bytes(&original, "UTF-16BE").unwrap();
        let saved = encode_for_save(&opened, Some("UTF-16BE")).unwrap();
        assert_eq!(
            saved, original,
            "save must not corrupt the original encoding"
        );
    }

    // -----------------------------------------------------------------------
    // Fix 2 — CRLF preserved across a REAL open→edit→save round-trip.
    //
    // These go through open_file_from_path (which calls normalize_line_endings)
    // and save_file, NOT the encoder in isolation. The bypassed test only
    // checked the encoder; this proves the line-ending survives the full path.
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_line_ending() {
        assert_eq!(detect_line_ending("a\r\nb"), "crlf");
        assert_eq!(detect_line_ending("a\rb"), "cr");
        assert_eq!(detect_line_ending("a\nb"), "lf");
        assert_eq!(detect_line_ending("plain"), "lf");
        // CRLF wins when both present.
        assert_eq!(detect_line_ending("a\r\nb\nc"), "crlf");
    }

    #[test]
    fn test_restore_line_endings_is_idempotent() {
        // Editor content is LF; restoring CRLF must not produce \r\r\n even if
        // the content somehow already contains CRLF.
        assert_eq!(restore_line_endings("a\nb", Some("crlf")), "a\r\nb");
        assert_eq!(restore_line_endings("a\r\nb", Some("crlf")), "a\r\nb");
        assert_eq!(restore_line_endings("a\nb", Some("lf")), "a\nb");
        assert_eq!(restore_line_endings("a\nb", None), "a\nb");
    }

    #[tokio::test]
    async fn test_utf8_crlf_round_trip_preserves_crlf_on_disk() {
        let dir = io_test_dir("crlf_utf8");
        let path = dir.join("doc.md");
        // A genuine CRLF UTF-8 file on disk.
        std::fs::write(&path, b"line one\r\nline two\r\n").unwrap();

        // Open through the real path: it normalizes to LF internally and records
        // the original EOL on the document.
        let opened = open_file_from_path(&path.to_string_lossy(), None).expect("open");
        assert_eq!(opened.document.line_ending, "crlf");
        assert_eq!(
            opened.document.content, "line one\nline two\n",
            "editor sees LF"
        );

        // The editor saves its LF content back; the original EOL must be restored.
        let edited_lf = format!("{}line three\n", opened.document.content);
        save_file_with(
            "d1".into(),
            edited_lf,
            Some(path.to_string_lossy().to_string()),
            Some(opened.document.encoding.clone()),
            Some(opened.document.line_ending.clone()),
            None,
            &BaselineStore::default(),
        )
        .await
        .expect("save");

        let on_disk = std::fs::read(&path).unwrap();
        assert_eq!(
            on_disk,
            b"line one\r\nline two\r\nline three\r\n".to_vec(),
            "CRLF must be restored on save, not silently rewritten to LF"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_utf16_crlf_round_trip_preserves_crlf_and_encoding() {
        let dir = io_test_dir("crlf_utf16");
        let path = dir.join("doc.md");
        // A genuine UTF-16LE-with-BOM, CRLF file on disk.
        let original = encoding::encode_bytes("héllo\r\nwörld\r\n", "UTF-16LE").unwrap();
        std::fs::write(&path, &original).unwrap();

        let opened = open_file_from_path(&path.to_string_lossy(), None).expect("open");
        assert_eq!(opened.document.encoding, "UTF-16LE");
        assert_eq!(opened.document.line_ending, "crlf");
        assert_eq!(opened.document.content, "héllo\nwörld\n", "editor sees LF");

        save_file_with(
            "d1".into(),
            opened.document.content.clone(),
            Some(path.to_string_lossy().to_string()),
            Some(opened.document.encoding.clone()),
            Some(opened.document.line_ending.clone()),
            None,
            &BaselineStore::default(),
        )
        .await
        .expect("save");

        let on_disk = std::fs::read(&path).unwrap();
        assert_eq!(
            on_disk, original,
            "UTF-16 CRLF file must round-trip byte-identical (encoding AND line endings preserved)"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_encode_for_save_rejects_unsupported_encoding() {
        // Refuse rather than write UTF-8 bytes mislabelled as the original.
        assert!(encode_for_save("内容", Some("GBK")).is_err());
    }

    #[test]
    fn test_encode_for_save_empty_encoding_is_utf8() {
        // An empty string encoding hint must behave like UTF-8, not error.
        let bytes = encode_for_save("x", Some("")).expect("encode");
        assert_eq!(bytes, b"x".to_vec());
    }

    // -----------------------------------------------------------------------
    // WI-0.4 — I/O failure paths
    //
    // These exercise the save path against the real filesystem through
    // save_file_with (the command needs a Tauri State no test can build),
    // with an empty baseline store so no notify watcher is started.
    // -----------------------------------------------------------------------

    fn io_test_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join("mdpro_io_test")
            .join(format!("{label}_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn test_save_to_existing_file_round_trips_content() {
        let dir = io_test_dir("roundtrip");
        let path = dir.join("doc.md");
        std::fs::write(&path, b"old").unwrap();
        let res = save_file_with(
            "d1".into(),
            "new content".into(),
            Some(path.to_string_lossy().to_string()),
            None,
            None,
            None,
            &BaselineStore::default(),
        )
        .await;
        assert!(res.is_ok(), "save should succeed: {res:?}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new content");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_save_to_readonly_dir_surfaces_error_not_silent() {
        use std::os::unix::fs::PermissionsExt;
        let dir = io_test_dir("readonly");
        // A brand-new file in a read-only directory → EACCES on create.
        let path = dir.join("new.md");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();

        let res = save_file_with(
            "d1".into(),
            "content".into(),
            Some(path.to_string_lossy().to_string()),
            None,
            None,
            None,
            &BaselineStore::default(),
        )
        .await;

        // Restore perms so cleanup can proceed regardless of outcome.
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));

        // The key property: the failure is SURFACED, never a silent success
        // that discards the user's content.
        assert!(
            res.is_err(),
            "read-only save must surface an error, got: {res:?}"
        );
        assert!(
            !path.exists(),
            "no partial/empty file should be left behind"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_save_after_file_deleted_recreates_without_data_loss() {
        // Open then delete the file, then save: the parent dir still exists, so
        // the write must recreate it with the in-editor content (no silent
        // discard of the user's edits).
        let dir = io_test_dir("deleted");
        let path = dir.join("doc.md");
        std::fs::write(&path, b"original").unwrap();
        std::fs::remove_file(&path).unwrap();
        assert!(!path.exists());

        let res = save_file_with(
            "d1".into(),
            "rescued edits".into(),
            Some(path.to_string_lossy().to_string()),
            None,
            None,
            None,
            &BaselineStore::default(),
        )
        .await;
        assert!(res.is_ok(), "save after delete should recreate: {res:?}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "rescued edits");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_save_filename_with_spaces_and_emoji_round_trips() {
        let dir = io_test_dir("fancy_names");
        for name in ["my notes.md", "memo 📝 draft.md", "über café.md"] {
            let path = dir.join(name);
            let res = save_file_with(
                "d1".into(),
                "body".into(),
                Some(path.to_string_lossy().to_string()),
                None,
                None,
                None,
                &BaselineStore::default(),
            )
            .await;
            assert!(res.is_ok(), "save of {name:?} should succeed: {res:?}");
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "body");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_save_filename_with_quote_round_trips() {
        let dir = io_test_dir("quote_name");
        // A single quote in the filename must not break the write path.
        let path = dir.join("o'brien's list.md");
        let res = save_file_with(
            "d1".into(),
            "x".into(),
            Some(path.to_string_lossy().to_string()),
            None,
            None,
            None,
            &BaselineStore::default(),
        )
        .await;
        assert!(
            res.is_ok(),
            "save with quote in name should succeed: {res:?}"
        );
        assert!(path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_save_very_long_single_line_and_large_content() {
        // ~10MB of a single very long line (minified-content shape). The save
        // path must remain responsive and lossless — no truncation, no hang.
        let dir = io_test_dir("large");
        let path = dir.join("big.md");
        let big = "a".repeat(10 * 1024 * 1024 - 16); // just under the 10MB open cap
        let start = std::time::Instant::now();
        let res = save_file_with(
            "d1".into(),
            big.clone(),
            Some(path.to_string_lossy().to_string()),
            None,
            None,
            None,
            &BaselineStore::default(),
        )
        .await;
        let elapsed = start.elapsed();
        assert!(res.is_ok(), "large save should succeed: {res:?}");
        assert_eq!(std::fs::metadata(&path).unwrap().len() as usize, big.len());
        // Generous smoke bound — catches an accidental O(n^2) regression, not a
        // perf benchmark. 10MB to a temp file should be well under this.
        assert!(
            elapsed.as_secs() < 10,
            "10MB save took too long: {elapsed:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------
    // Fix 1 — atomic save (no truncate-then-write data loss)
    // -----------------------------------------------------------------------

    #[test]
    fn test_atomic_write_replaces_content_and_leaves_no_tmp() {
        let dir = io_test_dir("atomic_ok");
        let path = dir.join("doc.md");
        std::fs::write(&path, b"old contents").unwrap();

        atomic_write(&path, b"brand new contents").expect("atomic_write");
        assert_eq!(std::fs::read(&path).unwrap(), b"brand new contents");

        // No `.tmp` sibling may be left behind after a successful write.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "no .tmp file should remain, found: {leftovers:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_atomic_write_failure_preserves_original_and_no_tmp() {
        use std::os::unix::fs::PermissionsExt;
        // The original file exists with known contents. We make the *directory*
        // read-only so creating the same-dir temp file fails. The atomic write
        // must error AND leave the original file byte-for-byte intact — the
        // truncate-then-write path would have destroyed it.
        let dir = io_test_dir("atomic_fail");
        let path = dir.join("doc.md");
        std::fs::write(&path, b"PRECIOUS ORIGINAL").unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();

        let res = atomic_write(&path, b"this write must not land");

        // Restore perms so we can read/clean up regardless of outcome.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();

        assert!(
            res.is_err(),
            "write to read-only dir must fail, got: {res:?}"
        );
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"PRECIOUS ORIGINAL",
            "original contents must survive a failed atomic write"
        );
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "no .tmp file should remain after failure, found: {leftovers:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_atomic_write_preserves_file_permissions() {
        use std::os::unix::fs::PermissionsExt;
        // A file saved with restrictive perms must keep them after an atomic
        // overwrite (the temp file would otherwise impose its own default mode).
        let dir = io_test_dir("atomic_perms");
        let path = dir.join("doc.md");
        std::fs::write(&path, b"v1").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();

        atomic_write(&path, b"v2").expect("atomic_write");

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o640,
            "original permissions must be preserved, got {mode:o}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_normalize_no_newlines() {
        let input = "no newlines here";
        assert_eq!(normalize_line_endings(input), input);
    }

    #[test]
    fn test_validate_save_path_allows_markdown() {
        assert!(validate_save_path(std::path::Path::new("/tmp/doc.md")).is_ok());
        assert!(validate_save_path(std::path::Path::new("/tmp/doc.markdown")).is_ok());
        assert!(validate_save_path(std::path::Path::new("/tmp/doc.txt")).is_ok());
    }

    #[test]
    fn test_validate_save_path_allows_other_text_formats() {
        assert!(validate_save_path(std::path::Path::new("/tmp/doc.html")).is_ok());
        assert!(validate_save_path(std::path::Path::new("/tmp/doc.json")).is_ok());
        assert!(validate_save_path(std::path::Path::new("/tmp/doc.yaml")).is_ok());
    }

    #[test]
    fn test_validate_save_path_rejects_dangerous_extensions() {
        assert!(validate_save_path(std::path::Path::new("/tmp/evil.sh")).is_err());
        assert!(validate_save_path(std::path::Path::new("/tmp/evil.exe")).is_err());
        assert!(validate_save_path(std::path::Path::new("/tmp/evil.zshrc")).is_err());
        assert!(validate_save_path(std::path::Path::new("/tmp/evil.py")).is_err());
    }

    #[test]
    fn test_validate_save_path_rejects_no_extension() {
        assert!(validate_save_path(std::path::Path::new("/tmp/authorized_keys")).is_err());
    }

    #[test]
    fn test_validate_save_path_rejects_traversal() {
        assert!(validate_save_path(std::path::Path::new("/tmp/../etc/passwd.md")).is_err());
        assert!(validate_save_path(std::path::Path::new("../../.zshrc.md")).is_err());
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

    // #351: check_file_modified must validate path
    #[tokio::test]
    async fn test_check_file_modified_rejects_traversal() {
        let result = check_file_modified("/tmp/../../../etc/passwd".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_check_file_modified_rejects_sensitive_path() {
        let result = check_file_modified("/Users/test/.ssh/id_rsa".to_string()).await;
        assert!(result.is_err());
    }

    // #346: reload_file must validate path
    #[tokio::test]
    async fn test_reload_file_rejects_traversal() {
        let result = reload_file("/tmp/../../../etc/passwd".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_reload_file_rejects_sensitive_path() {
        let result = reload_file("/Users/test/.ssh/id_rsa".to_string()).await;
        assert!(result.is_err());
    }

    // Shared test helpers — match the HomeRestorer pattern used in
    // commands::draft and services::draft::migration tests.
    use crate::HOME_LOCK;

    struct HomeRestorer(Option<String>);
    impl Drop for HomeRestorer {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => unsafe { std::env::set_var("HOME", v) },
                None => unsafe { std::env::remove_var("HOME") },
            }
        }
    }

    /// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
    fn set_home(path: &std::path::Path) -> HomeRestorer {
        let prev = std::env::var("HOME").ok();
        unsafe { std::env::set_var("HOME", path.to_str().expect("temp dir path is non-UTF-8")) };
        HomeRestorer(prev)
    }

    fn make_temp_home(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("mdpro_test").join(label);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // Regression tests for issue #75:
    // discard_and_close() is the branch of close_document reached when
    // discard_changes=true. Before the fix this branch returned
    // draft_deleted: false without calling delete_draft_service, leaving
    // stale drafts on disk that were offered for recovery on next launch.
    //
    // Uses HOME_LOCK + HomeRestorer so $HOME is restored even on panic.
    #[test]
    fn test_discard_and_close_deletes_draft_and_reports_true() {
        use crate::services::draft::{load_draft, save_draft};

        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("dac_exists");
        let _home_guard = set_home(&home);

        let drafts = dirs::data_dir()
            .unwrap_or_else(|| home.clone())
            .join("mdpro")
            .join("drafts");
        std::fs::create_dir_all(&drafts).unwrap();

        let id = "test75_cmd_exists";
        save_draft(id, "# regression", None, "Reg Test").expect("save_draft");
        assert!(
            load_draft(id).expect("load_draft").is_some(),
            "draft must exist before close"
        );

        let result = discard_and_close(id);
        assert!(result.success, "success must be true");
        assert!(
            result.draft_deleted,
            "draft_deleted must be true when draft existed"
        );
        assert!(
            load_draft(id).expect("load_draft after close").is_none(),
            "draft must be gone after discard_and_close"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn test_discard_and_close_returns_false_when_no_draft() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("dac_absent");
        let _home_guard = set_home(&home);

        // Pre-create the drafts directory so dirs::data_dir() resolves
        // correctly. Without this, a missing directory causes
        // delete_draft_service to error → unwrap_or(false) → false,
        // satisfying the assertion for the wrong reason (dir not found,
        // not "no draft exists").
        let drafts = dirs::data_dir()
            .unwrap_or_else(|| home.clone())
            .join("mdpro")
            .join("drafts");
        std::fs::create_dir_all(&drafts).unwrap();

        let result = discard_and_close("test75_cmd_no_draft");
        assert!(result.success, "success must be true even with no draft");
        assert!(
            !result.draft_deleted,
            "draft_deleted must be false when no draft existed"
        );

        let _ = std::fs::remove_dir_all(&home);
    }
}

#[tauri::command]
pub async fn open_file(
    window: Window,
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
    let (mut result, seed) = open_file_from_path_seeded(&path, encoding).inspect_err(|err| {
        log_file_event(
            "file.open",
            LogStatus::Fail,
            LogLevel::Error,
            Some(&action_id),
            json!({ "filePath": path_for_error }),
            Some(start.elapsed().as_millis() as u64),
            Some(file_error_message(err)),
        );
    })?;
    let raw = PathBuf::from(&path);
    if let Some(hold) = watcher.reserve_hold(window.label(), &raw) {
        result.changed_since_read = watcher.watch_seeded(&raw, seed).changed();
        if watcher.confirm_hold(&hold) {
            result.hold_gen = hold.gen;
        }
    }
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
    window: Window,
    watcher: State<'_, FileWatcher>,
    action_id: Option<String>,
) -> Result<Option<OpenFileResult>, FileError> {
    let action_id = action_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
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
        // No duration: the only thing that happened was the user deciding not
        // to open anything, and that is their time, not the program's. A `0`
        // here would be indistinguishable from an instantaneous cancel that we
        // did not actually measure.
        log_file_event(
            "file.open",
            LogStatus::Cancel,
            LogLevel::Warn,
            Some(&action_id),
            json!({ "source": "dialog" }),
            None,
            None,
        );
        return Ok(None);
    };

    // D1: the timer starts AFTER the picker closes. Nothing above it does work
    // worth measuring, so unlike the export paths there is no span to bank.
    let start = std::time::Instant::now();

    let path_string = path.to_string_lossy().to_string();
    let path_for_error = path_string.clone();
    let (mut result, seed) = open_file_from_path_seeded(&path_string, None).inspect_err(|err| {
        log_file_event(
            "file.open",
            LogStatus::Fail,
            LogLevel::Error,
            Some(&action_id),
            json!({ "filePath": path_for_error }),
            Some(start.elapsed().as_millis() as u64),
            Some(file_error_message(err)),
        );
    })?;
    let raw = PathBuf::from(&path_string);
    if let Some(hold) = watcher.reserve_hold(window.label(), &raw) {
        result.changed_since_read = watcher.watch_seeded(&raw, seed).changed();
        if watcher.confirm_hold(&hold) {
            result.hold_gen = hold.gen;
        }
    }
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
    encoding: Option<String>,
    line_ending: Option<String>,
    action_id: Option<String>,
    watcher: State<'_, FileWatcher>,
) -> Result<SaveResult, FileError> {
    save_file_with(
        _document_id,
        content,
        path,
        encoding,
        line_ending,
        action_id,
        watcher.baselines(),
    )
    .await
}

/// `save_file`'s body: `save_file_written` with the written bytes dropped.
/// After a successful `atomic_write`, and before the
/// self-write mark clears, the save refreshes the D32 baseline of the final path
/// if one is registered, so late FSEvents flags for this write compare
/// against the saved bytes (ADR-0068 decision 4). The entry is the hash of
/// the bytes written, whatever their size, with no re-read, and the path's
/// stat only when its size is the written length (`None` otherwise, D129);
/// if another writer got in after the rename, the disk no longer hashes to
/// them and that writer's event still emits (`refresh_after_save`,
/// D32 WI-6b, D112). A failed write refreshes nothing.
pub(crate) async fn save_file_with(
    _document_id: String,
    content: String,
    path: Option<String>,
    encoding: Option<String>,
    line_ending: Option<String>,
    action_id: Option<String>,
    baselines: &BaselineStore,
) -> Result<SaveResult, FileError> {
    save_file_written(
        _document_id,
        content,
        path,
        encoding,
        line_ending,
        action_id,
        baselines,
    )
    .await
    .map(|(result, _)| result)
}

/// The save itself (the refresh described on `save_file_with` lives here),
/// also returning the exact encoded bytes `atomic_write` wrote, so the Save
/// As seam can seed the new path's baseline from them (D69,
/// `save_as_watch.rs`). The IPC result is unchanged.
pub(crate) async fn save_file_written(
    _document_id: String,
    content: String,
    path: Option<String>,
    encoding: Option<String>,
    line_ending: Option<String>,
    action_id: Option<String>,
    baselines: &BaselineStore,
) -> Result<(SaveResult, Vec<u8>), FileError> {
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

    // Validate file extension — only allow markdown/text files
    validate_save_path(&path_buf).map_err(|msg| {
        log_file_event(
            "file.save",
            LogStatus::Fail,
            LogLevel::Error,
            Some(&action_id),
            json!({ "filePath": path_value.as_str(), "reason": msg }),
            Some(start.elapsed().as_millis() as u64),
            Some(msg.to_string()),
        );
        FileError::InvalidPath {
            path: format!("{}: {}", path_value, msg),
        }
    })?;

    // Canonicalize path to prevent directory traversal attacks (audit #209).
    // For existing files, canonicalize directly. For new files, canonicalize the parent.
    let path_buf = path_buf
        .canonicalize()
        .or_else(|_| {
            path_buf
                .parent()
                .and_then(|p| p.canonicalize().ok())
                .map(|p| p.join(path_buf.file_name().unwrap_or_default()))
                .ok_or_else(|| {
                    std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid path")
                })
        })
        .map_err(|e| to_file_error(e, &path_value))?;
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

    // Restore the document's original line-ending style (Fix 2) before encoding
    // so a CRLF/CR file isn't silently rewritten to LF. The editor works in LF
    // internally; we convert back only at the write boundary.
    let content = restore_line_endings(&content, line_ending.as_deref());

    // Re-encode in the document's original encoding so a UTF-16/BOM file is
    // not silently rewritten as UTF-8 (WI-0.3). An unsupported encoding errors
    // here rather than corrupting the file.
    let bytes = encode_for_save(&content, encoding.as_deref()).inspect_err(|err| {
        log_file_event(
            "file.save",
            LogStatus::Fail,
            LogLevel::Error,
            Some(&action_id),
            json!({ "filePath": path_value.as_str(), "encoding": encoding.as_deref() }),
            Some(start.elapsed().as_millis() as u64),
            Some(file_error_message(err)),
        );
    })?;
    let byte_len = bytes.len();

    let path_for_error = path_value.clone();
    file_watcher::mark_write_start(&path_buf);
    let write_result = atomic_write(&path_buf, &bytes);
    if write_result.is_ok() {
        baselines.refresh_after_save(&path_buf, &bytes);
    }
    file_watcher::mark_write_end(&path_buf);
    write_result.map_err(|err| {
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
            "fileSizeBytes": byte_len
        }),
        Some(start.elapsed().as_millis() as u64),
        None,
    );
    let result = SaveResult {
        success: true,
        path: path_value,
        saved_at: chrono::Utc::now().timestamp_millis(),
        changed_since_read: false,
        blocked_by_pending_change: false,
        hold_gen: 0,
    };
    Ok((result, bytes))
}

/// Show the Save As dialog and save to the path picked. The save and the
/// watch registration of that path (seeded from the bytes written, only on
/// a successful save) run in `save_as_watch::save_as_watched_with` (D69). A
/// cancelled dialog logs a `file.save` cancel and touches nothing.
/// `refuse_path` (D111-WI-1) is the document's own path, sent only while it
/// has an unresolved external change: a pick of that path writes nothing and
/// returns `blocked_by_pending_change` (`save_as_watch::refused_save_as`).
/// D173: a save that is not refused reserves this window's hold on the
/// picked path first, confirms it after the register (reply `hold_gen`), and
/// releases it if the save fails.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_file_dialog(
    window: Window,
    document_id: String,
    content: String,
    suggested_name: Option<String>,
    encoding: Option<String>,
    line_ending: Option<String>,
    action_id: Option<String>,
    refuse_path: Option<String>,
    watcher: State<'_, FileWatcher>,
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

    let picked = path.to_string_lossy().to_string();
    if let Some(blocked) = refused_save_as(&picked, refuse_path.as_deref(), Some(&action_id)) {
        return Ok(Some(blocked));
    }
    let raw = PathBuf::from(&picked);
    let hold = watcher.reserve_hold(window.label(), &raw);
    let saved = save_as_watched_with(
        document_id,
        content,
        picked,
        encoding,
        line_ending,
        Some(action_id),
        &watcher,
    )
    .await;
    let Some(hold) = hold else {
        return saved.map(Some);
    };
    match saved {
        Ok(mut result) => {
            if watcher.confirm_hold(&hold) {
                result.hold_gen = hold.gen;
            }
            Ok(Some(result))
        }
        Err(err) => {
            watcher.release_hold(window.label(), &raw, hold.gen);
            Err(err)
        }
    }
}

/// Delete the draft for `document_id` and return the close result.
///
/// Extracted from `close_document` so the discard+delete path can be unit
/// tested without a Tauri `State<'_, FileWatcher>`.
fn discard_and_close(document_id: &str) -> CloseResult {
    let draft_deleted = delete_draft_service(document_id).unwrap_or_else(|e| {
        log_file_event(
            "file.close",
            LogStatus::Fail,
            LogLevel::Warn,
            None,
            json!({ "documentId": document_id, "error": e.to_string() }),
            None,
            Some(format!("delete_draft failed: {e}")),
        );
        false
    });
    CloseResult {
        success: true,
        draft_deleted,
    }
}

/// Close a document: delete its draft and drop it from the shadow store.
/// D173: it no longer unwatches; the window releases its watch hold through
/// `release_watch_hold` once no document in it holds the path.
#[tauri::command]
pub async fn close_document(
    document_id: String,
    discard_changes: bool,
    shadow: State<'_, SharedShadowStore>,
) -> Result<CloseResult, FileError> {
    if !discard_changes {
        return Err(FileError::IoError {
            message: format!("Document {document_id} has unsaved changes"),
        });
    }

    let _ = shadow_store::remove_document(&shadow, &document_id);

    Ok(discard_and_close(&document_id))
}

#[tauri::command]
pub async fn check_file_modified(path: String) -> Result<FileModifiedResult, FileError> {
    validate_file_path(&path)?;
    let metadata = std::fs::metadata(&path).map_err(|err| to_file_error(err, &path))?;
    let modified = metadata
        .modified()
        .map_err(|err| to_file_error(err, &path))?;
    let mtime = modified
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .map_err(|err| FileError::IoError {
            message: err.to_string(),
        })?
        .as_millis() as i64;

    let mut cache = mtime_cache().lock().map_err(|_| FileError::IoError {
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
    validate_file_path(&path)?;
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
