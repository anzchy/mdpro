//! D56: the autosave draft write logs as `draft.write`, never `file.write`.
//!
//! `save_draft_logged` writes a draft bundle under the data dir and never
//! touches the document file, but its log lines were named `file.write` with
//! the document's path in `filePath`, so they read as writes to the document.
//! These cases pin the event name, status, level and context of all three
//! lines (start / success / fail) against the real JSONL log in a temp `$HOME`.
use super::draft::save_draft_logged;
use crate::models::{LogLevel, LogSettings};
#[allow(unused_imports)] // draft_test_home reaches these through `super::`
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use crate::services::logger;
use crate::services::quit_guard::{self, QUIT_COMMITTED};
use serde_json::{json, Value};

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/draft/draft_test_home.rs"]
mod draft_test_home;
use draft_test_home::TempHome;

const DOC_PATH: &str = "/Users/someone/notes/doc.md";

struct QuitCommittedReset;
impl Drop for QuitCommittedReset {
    fn drop(&mut self) {
        quit_guard::reset_quit_committed_for_tests();
    }
}

fn enable_logging() {
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
}

/// Every JSONL record in the temp HOME's log.
fn log_entries(home: &TempHome) -> Vec<Value> {
    let path = logger::log_path().expect("log path resolves");
    assert!(
        path.starts_with(home.path()),
        "log {path:?} escaped temp HOME"
    );
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).expect("each log line is JSON"))
        .collect()
}

fn named<'a>(entries: &'a [Value], event: &str) -> Vec<&'a Value> {
    entries.iter().filter(|e| e["event"] == event).collect()
}

#[test]
fn d56_1_a_saved_draft_logs_draft_write_start_and_success_with_their_context() {
    let home = TempHome::new("d56_success");
    quit_guard::reset_quit_committed_for_tests();
    let _reset = QuitCommittedReset;
    enable_logging();

    save_draft_logged(None, "doc1", "BODY", Some(DOC_PATH.to_string()), "Doc")
        .expect("an open gate saves");

    let entries = log_entries(&home);
    assert!(
        named(&entries, "file.write").is_empty(),
        "a draft save must not log file.write: {entries:?}"
    );
    let lines = named(&entries, "draft.write");
    assert_eq!(lines.len(), 2, "start + success: {entries:?}");
    let (start, success) = (lines[0], lines[1]);

    assert_eq!(start["status"], json!("start"));
    assert_eq!(start["level"], json!("info"));
    assert_eq!(
        start["context"],
        json!({"documentId": "doc1", "filePath": DOC_PATH, "title": "Doc"})
    );
    assert!(start.get("durationMs").is_none_or(Value::is_null));

    assert_eq!(success["status"], json!("success"));
    assert_eq!(success["level"], json!("info"));
    assert_eq!(
        success["context"],
        json!({"documentId": "doc1", "bytes": 4})
    );
    assert!(success["durationMs"].is_u64());
    assert_eq!(success["actionId"], start["actionId"]);
    assert!(start["actionId"].is_string());
}

#[test]
fn d56_2_a_refused_draft_logs_draft_write_start_and_fail_with_the_error() {
    let home = TempHome::new("d56_fail");
    quit_guard::reset_quit_committed_for_tests();
    let _reset = QuitCommittedReset;
    enable_logging();
    drop(QUIT_COMMITTED.close());

    let err = save_draft_logged(None, "doc1", "BODY", Some(DOC_PATH.to_string()), "Doc")
        .expect_err("a committed quit refuses the save");

    let entries = log_entries(&home);
    assert!(
        named(&entries, "file.write").is_empty(),
        "a refused draft save must not log file.write: {entries:?}"
    );
    let lines = named(&entries, "draft.write");
    assert_eq!(lines.len(), 2, "start + fail: {entries:?}");
    let (start, fail) = (lines[0], lines[1]);

    assert_eq!(start["status"], json!("start"));
    assert_eq!(fail["status"], json!("fail"));
    assert_eq!(fail["level"], json!("error"));
    assert_eq!(fail["context"], json!({"documentId": "doc1"}));
    assert_eq!(fail["error"], json!(err.to_string()));
    assert!(fail["durationMs"].is_u64());
    assert_eq!(fail["actionId"], start["actionId"]);
}
