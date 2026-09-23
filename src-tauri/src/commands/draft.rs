use serde_json::json;

use crate::models::{Draft, LogEntryPayload, LogLevel, LogStatus};
use crate::services::draft::{
    cleanup_old_drafts as cleanup_drafts_service, delete_draft as delete_draft_service,
    list_drafts as list_drafts_service, load_draft, recover_draft as recover_draft_service,
    save_draft as save_draft_service, DraftError, DraftMetadataEntry, DraftSaveResult,
    RecoverResult,
};
use crate::services::logger;
use crate::services::quit_guard::{DraftGate, QUIT_COMMITTED};

/// Save a draft unless a quit has already committed.
///
/// Once the quit path has deleted the discarded drafts, an auto-save tick that
/// is still holding the old content must not write them back (ADR-0025 §4).
/// `DraftGate::if_open` keeps the gate's read guard for the whole write, so the
/// check and the write are indivisible: a commit cannot close the gate between
/// them and then delete a draft this call is about to recreate.
///
/// The gate is a parameter rather than a global read so a test can close it
/// without closing it for the rest of the process. It is a synchronous
/// function, and the guard lives entirely inside `if_open`, so no caller can
/// hold it across an `.await`.
pub(crate) fn save_draft_gated(
    committed: &DraftGate,
    document_id: &str,
    content: &str,
    original_path: Option<String>,
    title: &str,
) -> Result<DraftSaveResult, DraftError> {
    committed
        .if_open(|| save_draft_service(document_id, content, original_path, title))
        .unwrap_or_else(|| {
            Err(DraftError::IoError {
                message: "a quit has committed: draft saving is closed".to_string(),
            })
        })
}

#[tauri::command]
pub async fn save_draft(
    document_id: String,
    content: String,
    original_path: Option<String>,
    title: String,
) -> Result<DraftSaveResult, DraftError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.write".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({
            "documentId": document_id.as_str(),
            "filePath": original_path.as_deref(),
            "title": title.as_str()
        })),
        duration_ms: None,
        error: None,
    });
    let result = save_draft_gated(
        &QUIT_COMMITTED,
        &document_id,
        &content,
        original_path,
        &title,
    )
    .inspect_err(|err| {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "file.write".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "documentId": document_id.as_str() })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: Some(err.to_string()),
        });
    })?;
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.write".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({
            "documentId": document_id.as_str(),
            "bytes": content.len()
        })),
        duration_ms: Some(start.elapsed().as_millis() as u64),
        error: None,
    });
    Ok(result)
}

#[tauri::command]
pub async fn get_draft(document_id: String) -> Result<Option<Draft>, DraftError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.read".to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: Some(json!({ "documentId": document_id.as_str() })),
        duration_ms: None,
        error: None,
    });
    let result = load_draft(&document_id).inspect_err(|err| {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "file.read".to_string(),
            status: LogStatus::Fail,
            action_id: Some(action_id.clone()),
            context: Some(json!({ "documentId": document_id.as_str() })),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            error: Some(err.to_string()),
        });
    })?;
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "file.read".to_string(),
        status: LogStatus::Success,
        action_id: Some(action_id),
        context: Some(json!({
            "documentId": document_id.as_str(),
            "found": result.is_some()
        })),
        duration_ms: Some(start.elapsed().as_millis() as u64),
        error: None,
    });
    Ok(result)
}

#[tauri::command]
pub async fn list_drafts() -> Result<Vec<DraftMetadataEntry>, DraftError> {
    list_drafts_service()
}

#[tauri::command]
pub async fn recover_draft(document_id: String) -> Result<RecoverResult, DraftError> {
    recover_draft_service(&document_id)
}

#[tauri::command]
pub async fn delete_draft(document_id: String) -> Result<bool, DraftError> {
    delete_draft_service(&document_id)
}

#[tauri::command]
pub async fn cleanup_old_drafts() -> Result<usize, DraftError> {
    cleanup_drafts_service()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // Use the crate-level HOME_LOCK so that commands::draft tests and
    // services::draft::migration tests cannot race on the process-wide $HOME.
    use crate::HOME_LOCK;

    fn make_temp_home(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("mdpro_test").join(label);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    struct HomeRestorer(Option<String>);
    impl Drop for HomeRestorer {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => unsafe { std::env::set_var("HOME", v) },
                None => unsafe { std::env::remove_var("HOME") },
            }
        }
    }

    /// Sets HOME and returns a guard that restores the original value on drop.
    /// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
    fn set_home(path: &std::path::Path) -> HomeRestorer {
        let prev = std::env::var("HOME").ok();
        unsafe { std::env::set_var("HOME", path.to_str().unwrap()) };
        HomeRestorer(prev)
    }

    // HOME_LOCK is deliberately held across the await: it serializes mutation of
    // the process-wide $HOME, and the awaited call reads $HOME, so the guard must
    // outlive it. `#[tokio::test]` runs on a current_thread runtime, so the future
    // never migrates between threads. Releasing the lock earlier would let two
    // tests race on $HOME and make the suite flaky.
    /// Regression test: get_draft must propagate IO/parse errors instead of
    /// silently coercing them to None (the original bug).
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn get_draft_propagates_parse_error_for_corrupt_metadata() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("gd_corrupt_meta");
        let _home_guard = set_home(&home);

        // After fix/audit-128, drafts live under data_dir() not home_dir().
        // With HOME set above, dirs::data_dir() returns HOME/Library/Application Support on macOS.
        let drafts_dir = dirs::data_dir()
            .unwrap_or_else(|| home.clone())
            .join("mdpro")
            .join("drafts");
        fs::create_dir_all(&drafts_dir).unwrap();
        fs::write(drafts_dir.join("test-doc-corrupt.draft.md"), "content").unwrap();
        fs::write(drafts_dir.join("test-doc-corrupt.meta.json"), "{invalid}").unwrap();

        let result = get_draft("test-doc-corrupt".to_string()).await;
        let _ = fs::remove_dir_all(&home);

        assert!(
            result.is_err(),
            "get_draft must propagate errors instead of returning Ok(None); got {result:?}"
        );
    }

    // Same rationale as above: $HOME serialization requires holding HOME_LOCK
    // across the await, and the current_thread test runtime makes that safe.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn get_draft_returns_ok_none_for_missing_draft() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = make_temp_home("gd_missing");
        let _home_guard = set_home(&home);

        let result = get_draft("no-such-doc-xyzzy".to_string()).await;
        let _ = fs::remove_dir_all(&home);

        assert!(
            matches!(result, Ok(None)),
            "expected Ok(None) for missing draft; got {result:?}"
        );
    }
}
