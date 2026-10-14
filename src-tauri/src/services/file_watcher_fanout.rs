//! The watcher's emit step (D185): where a routed `file:changed` goes.
//!
//! Purpose: `emit_file_changed` sends the event `handle_event` routed to every
//! recipient through the watcher's `NoticeSink::emit_plain`, the same
//! origin-less `file:changed` the reconcile uses, and logs one
//! `file.watch.fanout` line when an emit failed or a spelling was added. A
//! failed emit is logged at error level and never retried; before D185 the
//! emit's `Result` was discarded.
//!
//! Pipeline: the notify callback → `handle_event` (file_watcher.rs: route,
//! one `file.watch.event` line) → `emit_file_changed(sink, event)` →
//! `recipients` → one `emit_plain` per recipient → `fanout_line`.
//!
//! Key decisions:
//! - **The callback gets an `EventSink`, never the `FileWatcher` or
//!   `Holders`.** Its `holders` is a `HoldsLeaf` (file_watcher_holders_fanout.rs),
//!   which reaches lock H only, so the callback cannot take lock T
//!   (ADR-0086 decision 2: notify's `stop()` joins the callback's thread).
//! - **Recipients (D185-WI-2):** the event's own path plus every spelling
//!   held in its canonical group, de-duplicated by exact string. Each copy is
//!   the routed `FileChangedEvent` with only `path` changed: the same
//!   timestamp and change type, and a rename's `newPath` stays the reported
//!   real path, so a renamed alias tab follows the real file. With no alias
//!   held the single emit is byte-identical to before D185.
//! - **The line** is logged when a spelling was added or an emit failed; it
//!   carries `recipients` (a count) and `failed_spellings`.
//! - **Paths, never content**, as in file_watcher_log.rs.
//!
//! @coordinates-with services/file_watcher.rs (parent; `new` builds the
//! `EventSink`, `handle_event` calls `emit_file_changed`),
//! services/file_watcher_save_notice.rs (`NoticeSink::emit_plain`,
//! `AppNoticeSink`), services/file_watcher_holders_fanout.rs (`HoldsLeaf`)
use super::holders::fanout::HoldsLeaf;
use super::save_notice::NoticeSink;
use super::FileChangedEvent;
use crate::models::log_entry::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use serde_json::json;
use std::path::Path;
use std::sync::Arc;

const FANOUT_EVENT: &str = "file.watch.fanout";

/// Everything the notify callback emits through: the notice sink and the
/// leaf (H-only) half of the holders. Deliberately holds no `Holders`.
pub(super) struct EventSink {
    pub(super) notices: Arc<dyn NoticeSink>,
    pub(super) holders: HoldsLeaf,
}

/// Send `event` to every recipient, then log a `file.watch.fanout` line
/// when one is due. Never retries and never panics.
pub(super) fn emit_file_changed(sink: &EventSink, event: FileChangedEvent) {
    if let Some(line) = fan_out(sink, &event) {
        logger::log_event(line);
    }
}

/// The emits `emit_file_changed` makes, and the line it would log: `Some`
/// when an emit failed or the recipients went beyond the event's own path.
fn fan_out(sink: &EventSink, event: &FileChangedEvent) -> Option<LogEntryPayload> {
    let recipients = recipients(sink, event);
    let mut first_error: Option<String> = None;
    let mut failed_spellings: Vec<String> = Vec::new();
    let mut emitted = 0usize;
    for path in &recipients {
        let copy = FileChangedEvent {
            path: path.clone(),
            ..event.clone()
        };
        match sink.notices.emit_plain(&copy) {
            Ok(()) => emitted += 1,
            Err(e) => {
                first_error.get_or_insert(e);
                failed_spellings.push(path.clone());
            }
        }
    }
    let added = recipients.len() > 1;
    (added || first_error.is_some())
        .then(|| fanout_line(event, &recipients, emitted, failed_spellings, first_error))
}

/// Who gets `event` (D185-WI-2): the event's own path, then every spelling
/// held in its canonical group, de-duplicated by exact string. With no alias
/// held this is exactly the event's own path, as before D185.
fn recipients(sink: &EventSink, event: &FileChangedEvent) -> Vec<String> {
    let mut out = vec![event.path.clone()];
    for spelling in sink.holders.spellings_of(Path::new(&event.path)) {
        if !out.contains(&spelling) {
            out.push(spelling);
        }
    }
    out
}

/// The `file.watch.fanout` line: `success`/info when every emit went out,
/// `fail`/error with the first error otherwise.
fn fanout_line(
    event: &FileChangedEvent,
    recipients: &[String],
    emitted: usize,
    failed_spellings: Vec<String>,
    error: Option<String>,
) -> LogEntryPayload {
    let (level, status) = match error {
        None => (LogLevel::Info, LogStatus::Success),
        Some(_) => (LogLevel::Error, LogStatus::Fail),
    };
    LogEntryPayload {
        level,
        event: FANOUT_EVENT.to_string(),
        status,
        action_id: None,
        context: Some(json!({
            "path": event.path,
            "changeType": event.change_type,
            "timestamp": event.timestamp,
            "recipients": recipients.len(),
            "emitted": emitted,
            "failed": recipients.len() - emitted,
            "failed_spellings": failed_spellings,
        })),
        duration_ms: None,
        error,
    }
}

#[cfg(test)]
#[path = "file_watcher_fanout_seam_tests.rs"]
mod seam_tests;

#[cfg(all(test, target_os = "macos"))]
#[path = "file_watcher_fanout_tests.rs"]
mod tests;
