//! The open path's single read (D86 WI-3, finding ②).
//!
//! Purpose: open a document from ONE read of the file, and return, next to
//! the document, the D32 baseline entry that describes exactly the bytes it
//! was decoded from. `open_file` / `open_file_dialog` hand that entry to
//! `FileWatcher::watch_seeded`, so a write landing after the read is never
//! baselined as unchanged.
//!
//! Pipeline: `open_file_from_path_seeded` → exists → metadata (size cap,
//! mtime cache) → `read_for_open` (one capped read: the bytes and their seed)
//! → `over_cap` → `FileTooLarge` → `decode_opened` (file.rs; decodes exactly
//! those bytes) → `(OpenFileResult, seed)`.
//!
//! @coordinates-with commands/file.rs (parent; `open_file_from_path` is a
//! wrapper over `open_file_from_path_seeded`, `decode_opened` is its decode
//! half, and `open_file` / `open_file_dialog` call it; the private helpers
//! this uses live there), services/file_watcher_baseline_seed.rs
//! (`read_for_open`), services/file_watcher_seed.rs (`watch_seeded`),
//! file_open_seed_wiring_tests.rs (source tripwires on this file)
//!
//! Key decisions:
//! - **One read feeds both** the document and the seed: nothing here reads
//!   the file except `read_for_open`, and the decode takes its bytes.
//! - **The metadata pre-check stays** (`FileTooLarge` with the metadata size,
//!   as before), and the read itself is capped: a file whose metadata size
//!   passes but whose read returns more than the cap (a device behind a
//!   symlink, or growth during the open) is `FileTooLarge` too, never
//!   truncated. Its `size` is `max(s1 size, bytes read)` (`over_cap_error`).
//! - The decode region stays in file.rs, untouched; only its input changed.
use super::{decode_opened, mtime_cache, to_file_error, FileError, OpenFileResult, MAX_FILE_SIZE};
use crate::services::file_watcher::seed::{read_for_open, Entry};
use crate::services::logger;
use std::path::PathBuf;

/// Open `path` from one read; the document and the seed for its bytes.
pub(crate) fn open_file_from_path_seeded(
    path: &str,
    encoding_hint: Option<String>,
) -> Result<(OpenFileResult, Entry), FileError> {
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
    cache_mtime(path, &metadata);

    let (bytes, seed) = read_for_open(&path_buf).map_err(|err| {
        logger::log_line(&format!(
            "open_file_from_path: read error {}: {}",
            path, err
        ));
        to_file_error(err, path)
    })?;
    let over_cap = bytes.len() as u64 > MAX_FILE_SIZE;
    if over_cap {
        let s1_size = seed.stat.map_or(0, |(_, size)| size);
        logger::log_line(&format!(
            "open_file_from_path: read past the cap {} size={} read={}",
            path,
            s1_size,
            bytes.len()
        ));
        return Err(over_cap_error(path, s1_size, bytes.len() as u64));
    }
    let result = decode_opened(path, path_buf, bytes, encoding_hint)?;
    Ok((result, seed))
}

/// Record `path`'s mtime for `check_file_modified`, as the open always has.
fn cache_mtime(path: &str, metadata: &std::fs::Metadata) {
    if let Ok(modified) = metadata.modified() {
        if let Ok(duration) = modified.duration_since(std::time::SystemTime::UNIX_EPOCH) {
            if let Ok(mut cache) = mtime_cache().lock() {
                cache.insert(path.to_string(), duration.as_millis() as i64);
            }
        }
    }
}

/// `FileTooLarge` for a read that returned more than the cap: the larger of
/// the pre-read fstat size and the bytes read, so neither a size-0 device nor
/// a file that grew reports a size under the cap.
pub(crate) fn over_cap_error(path: &str, s1_size: u64, bytes_read: u64) -> FileError {
    FileError::FileTooLarge {
        path: path.to_string(),
        size: s1_size.max(bytes_read),
    }
}
