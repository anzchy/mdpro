//! D16F WI-5 (audit row 16): the `app.quit.commit` line says `fail` when a
//! draft deletion failed, and `success` only when none did.
//!
//! These run against the real JSONL file and real draft bundles, under
//! `HOME_LOCK` in a temp `$HOME` (see `driver_fixtures`). Request ids come from
//! the 5_000 band this module owns, so no other guard's line can match.
//!
//! Law: `fail` at level `error` iff `failed > 0`; context exactly
//! `{requestId, deleted, failed}`; error `"{failed} draft deletions failed"`
//! when present and null/absent otherwise. The quit still commits (ADR-0025 §4).

use super::driver::*;
use super::driver_fixtures::{
    bundle, drafts_dir, effects_of, entries_where, fresh_log_home, guard_at, later, set_home,
    Effect, QuitCommittedReset,
};
use super::logging::log_commit;
use crate::models::{LogLevel, LogSettings};
use crate::services::{draft, logger};
use crate::HOME_LOCK;
use serde_json::{json, Value};
use std::fs;

const WIN: &str = "w5win";

fn all(_: &Value) -> bool {
    true
}

/// The one `app.quit.commit` line for `request_id`, checked against the law.
fn assert_commit_line(home: &std::path::Path, request_id: u64, deleted: u64, failed: u64) {
    let lines = entries_where(home, "app.quit.commit", request_id, all);
    assert_eq!(lines.len(), 1, "request {request_id}: expected one commit line, got {lines:?}");
    let line = &lines[0];
    let (status, level) = if failed > 0 { ("fail", "error") } else { ("success", "info") };
    assert_eq!(line["status"], status, "request {request_id} ({deleted},{failed}): {line}");
    assert_eq!(line["level"], level, "request {request_id} ({deleted},{failed}): {line}");
    assert_eq!(
        line["context"],
        json!({ "requestId": request_id, "deleted": deleted, "failed": failed }),
        "request {request_id}: context must be exactly the counts"
    );
    let error = line.get("error").filter(|e| !e.is_null());
    if failed > 0 {
        assert_eq!(
            error.and_then(Value::as_str),
            Some(format!("{failed} draft deletions failed").as_str()),
            "request {request_id}: wrong error text"
        );
    } else {
        assert!(error.is_none(), "request {request_id}: success line carries an error: {line}");
    }
}

#[test]
fn wi5_status_mapping_over_enumerated_reports() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi5prop");
    let _home = set_home(&home);
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });

    for d in 0..=3usize {
        for f in 0..=3usize {
            let request_id = 5_000 + (d * 10 + f) as u64;
            log_commit(request_id, &CommitReport { deleted: d, failed: f });
        }
    }
    for d in 0..=3u64 {
        for f in 0..=3u64 {
            assert_commit_line(&home, 5_000 + d * 10 + f, d, f);
        }
    }
}

#[test]
fn wi5_blocked_deletion_yields_a_fail_commit_line_and_still_replies_yes() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi5blocked");
    let _home = set_home(&home);
    let _reset = QuitCommittedReset;
    let drafts = drafts_dir(&home);
    draft::save_draft("w5ok", "BODY", None, "t").unwrap();
    // A directory where the bundle should be: deleting it fails.
    let blocked = bundle(&drafts, "w5blk");
    fs::create_dir_all(&blocked).unwrap();

    let guard = guard_at(5_100);
    let r = later(guard.begin(&[WIN], 0));
    assert_eq!(r, 5_100, "guard_at did not land on its floor");
    let baseline = effects_of(&guard).len();
    guard.handle_reply(WIN, r, QuitAnswer::Dirty, None, 1).unwrap();
    let discard = Some(vec!["w5ok".to_string(), "w5blk".to_string()]);
    guard
        .handle_reply(WIN, r, QuitAnswer::Discard, discard, 2)
        .unwrap();

    assert_eq!(
        effects_of(&guard)[baseline..].last(),
        Some(&Effect::Reply(true)),
        "a failed delete must not block the quit"
    );
    assert_eq!(
        guard.last_commit_report(),
        Some(CommitReport { deleted: 1, failed: 1 })
    );
    assert!(!bundle(&drafts, "w5ok").exists(), "the deletable draft survived");
    assert!(blocked.is_dir(), "the blocked path was destroyed");

    assert_commit_line(&home, r, 1, 1);
    let raw = entries_where(&home, "app.quit.commit", r, all)[0].to_string();
    for marker in ["w5ok", "w5blk", WIN, "drafts"] {
        assert!(!raw.contains(marker), "{marker:?} leaked into the commit line: {raw}");
    }
}

#[test]
fn wi5_clean_commit_is_success_with_no_error() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi5clean");
    let _home = set_home(&home);
    let _reset = QuitCommittedReset;
    let drafts = drafts_dir(&home);
    for id in ["w5c1", "w5c2"] {
        draft::save_draft(id, "BODY", None, "t").unwrap();
    }

    let guard = guard_at(5_200);
    let r = later(guard.begin(&[WIN], 0));
    assert_eq!(r, 5_200, "guard_at did not land on its floor");
    let baseline = effects_of(&guard).len();
    guard.handle_reply(WIN, r, QuitAnswer::Dirty, None, 1).unwrap();
    let discard = Some(vec!["w5c1".to_string(), "w5c2".to_string()]);
    guard
        .handle_reply(WIN, r, QuitAnswer::Discard, discard, 2)
        .unwrap();

    assert_eq!(effects_of(&guard)[baseline..].last(), Some(&Effect::Reply(true)));
    assert_eq!(
        guard.last_commit_report(),
        Some(CommitReport { deleted: 2, failed: 0 })
    );
    for id in ["w5c1", "w5c2"] {
        assert!(!bundle(&drafts, id).exists(), "{id} was not deleted");
    }
    assert_commit_line(&home, r, 2, 0);
}
