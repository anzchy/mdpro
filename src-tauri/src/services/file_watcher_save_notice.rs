//! The save notice (D173-WI-2, ADR-0086 decision 4): after a successful
//! write, tell every other holder of the written file.
//!
//! Purpose: `notice_saved` emits one `file:changed` (`modified`) per distinct
//! held spelling of the write target's canonical group, plus the spelling the
//! save was given, each carrying an additive `origin: {windowLabel,
//! documentId}`, through the watcher's `NoticeSink`, and logs one
//! `file.save.notice` line. A failed emit is logged at error level and never
//! retried; it never fails the save.
//!
//! Pipeline: `save_file` / `save_file_dialog` (after the save's `Ok`) →
//! `notice_saved(origin, path, written_to)` → `consumer_spellings(written_to)`
//! (file_watcher_holders.rs; lock H only, no I/O) ∪ `{path}` → one
//! `SaveNotice` per spelling → `NoticeSink::emit_notice` → `file.save.notice`.
//!
//! Key decisions:
//! - **The target is the one the save resolved** (`SaveResult.written_to`),
//!   never re-canonicalised here: a symlink retargeted after the write
//!   cannot redirect the notice.
//! - **Broadcast, not `emit_to`.** The frontend's global `listen` is not
//!   isolated by `emit_to`; each window skips only its own saving document
//!   (`externalChangeStore.recordFileChange`, by `origin`).
//! - **No lock but H, no I/O, no retry.** An emit `Err` is serialisation or
//!   a torn-down runtime, not a transient.
//! - The save's own notify event still routes `SelfWrite` /
//!   `IgnoredUnchanged` (D101); the notice, not the route, tells the others.
//!
//! @coordinates-with services/file_watcher.rs (parent; the `notices` field),
//! services/file_watcher_holders.rs (the consumer spellings, lock H only),
//! commands/file.rs (`save_file`, `save_file_dialog`),
//! src/stores/externalChangeStore.ts (the receipt and its origin filter)
use super::{FileChangedEvent, FileWatcher};
use crate::models::log_entry::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use serde::Serialize;
use serde_json::json;
use std::path::Path;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};

const NOTICE_EVENT: &str = "file.save.notice";

/// Who saved: the saving window's Tauri label and the saving document's id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOrigin {
    pub window_label: String,
    pub document_id: String,
}

impl SaveOrigin {
    pub(crate) fn new(window_label: &str, document_id: &str) -> Self {
        Self {
            window_label: window_label.to_string(),
            document_id: document_id.to_string(),
        }
    }
}

/// A `file:changed` payload from a save: the watcher's event shape plus
/// `origin`. Watcher events stay `FileChangedEvent`, with no `origin`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNotice {
    #[serde(flatten)]
    pub event: FileChangedEvent,
    pub origin: SaveOrigin,
}

/// Where a notice goes. Production broadcasts `file:changed` to every window;
/// tests inject a recorder that can refuse.
pub(crate) trait NoticeSink: Send + Sync {
    fn emit_notice(&self, notice: &SaveNotice) -> Result<(), String>;
}

/// The production sink: `AppHandle::emit("file:changed", notice)`.
pub(crate) struct AppNoticeSink(pub(crate) AppHandle);

impl NoticeSink for AppNoticeSink {
    fn emit_notice(&self, notice: &SaveNotice) -> Result<(), String> {
        self.0
            .emit("file:changed", notice)
            .map_err(|e| e.to_string())
    }
}

impl FileWatcher {
    /// After a successful write of `path` (the spelling the save was given)
    /// whose resolved target was `written_to`: one notice per distinct
    /// spelling (the group's held spellings, then `path` if not among them),
    /// then one `file.save.notice` line, which is also returned. Never fails
    /// the save: a refused emit is counted, logged at error level and not
    /// sent again.
    pub(crate) fn notice_saved(
        &self,
        origin: &SaveOrigin,
        path: &str,
        written_to: &Path,
        action_id: Option<&str>,
    ) -> LogEntryPayload {
        let mut spellings = self.consumer_spellings(written_to);
        if !spellings.iter().any(|s| s == path) {
            spellings.push(path.to_string());
        }
        let timestamp = now_millis();
        let mut first_error: Option<String> = None;
        let mut emitted = 0usize;
        for spelling in &spellings {
            let notice = SaveNotice {
                event: FileChangedEvent {
                    path: spelling.clone(),
                    change_type: "modified".to_string(),
                    new_path: None,
                    timestamp,
                },
                origin: origin.clone(),
            };
            match self.notices.emit_notice(&notice) {
                Ok(()) => emitted += 1,
                Err(e) => {
                    first_error.get_or_insert(e);
                }
            }
        }
        let entry = notice_line(path, spellings.len(), emitted, first_error, action_id);
        logger::log_event(entry.clone());
        entry
    }
}

/// The `file.save.notice` line: `success`/info when every emit went out,
/// `fail`/error with the first error otherwise.
fn notice_line(
    path: &str,
    spellings: usize,
    emitted: usize,
    error: Option<String>,
    action_id: Option<&str>,
) -> LogEntryPayload {
    let (level, status) = match error {
        None => (LogLevel::Info, LogStatus::Success),
        Some(_) => (LogLevel::Error, LogStatus::Fail),
    };
    LogEntryPayload {
        level,
        event: NOTICE_EVENT.to_string(),
        status,
        action_id: action_id.map(str::to_string),
        context: Some(json!({
            "filePath": path,
            "spellings": spellings,
            "emitted": emitted,
            "failed": spellings - emitted,
        })),
        duration_ms: None,
        error,
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
#[path = "file_watcher_save_notice_shape_tests.rs"]
mod shape_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_save_notice_tests.rs"]
mod tests;
