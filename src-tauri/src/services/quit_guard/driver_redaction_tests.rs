//! D16F WI-3 (audit rows 4, 19): a refused discard list reaches the real log
//! as counts only, and deletes nothing.
//!
//! These run against the real JSONL file and real draft bundles, under
//! `HOME_LOCK` in a temp `$HOME` (see `driver_fixtures`). The markers below are
//! the id text a leak would carry: `zq7-` and `secret` from the hostile id,
//! `wi3keep` from the valid one sent alongside it.

use super::driver::*;
use super::driver_fixtures::{
    bundle, drafts_dir, effects_of, entries_where, fresh_log_home, guard_at, later, leak_gate,
    log_lines, recording_guard, set_home, Effect, QuitCommittedReset,
};
use crate::models::{LogLevel, LogSettings};
use crate::services::{draft, logger};
use crate::HOME_LOCK;
use serde_json::Value;

const WIN: &str = "wi3hostile";
const KEEP: &str = "wi3keep";
const HOSTILE: &str = "zq7-../secret";
const MARKERS: [&str; 3] = ["zq7-", "secret", KEEP];

fn hostile_list() -> Option<Vec<String>> {
    Some(vec![KEEP.to_string(), HOSTILE.to_string()])
}

fn mine(v: &Value) -> bool {
    v.pointer("/context/windowLabel").and_then(Value::as_str) == Some(WIN)
}

fn assert_no_marker(line: &str) {
    for marker in MARKERS {
        assert!(!line.contains(marker), "{marker:?} leaked into the log: {line}");
    }
}

#[test]
fn wi3_rejected_discard_writes_a_counts_only_answer_and_deletes_nothing() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi3hostile");
    let _home = set_home(&home);
    let _reset = QuitCommittedReset;
    draft::save_draft(KEEP, "BODY", None, "t").unwrap();
    let kept = bundle(&drafts_dir(&home), KEEP);
    assert!(kept.exists(), "fixture: the bundle to keep was not written");
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });

    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&[WIN], 0));
    guard.handle_reply(WIN, r, QuitAnswer::Dirty, None, 1).unwrap();

    let refused = guard.handle_reply(WIN, r, QuitAnswer::Discard, hostile_list(), 2);
    assert_eq!(refused, Err("invalid document id at index 1".to_string()));

    let fails: Vec<Value> = entries_where(&home, "app.quit.answer", r, mine)
        .into_iter()
        .filter(|v| v.get("status").and_then(Value::as_str) == Some("fail"))
        .collect();
    assert_eq!(fails.len(), 1, "expected one fail answer line, got {fails:?}");
    let line = &fails[0];
    assert_eq!(line.pointer("/context/idCount").and_then(Value::as_u64), Some(2));
    assert_eq!(
        line.get("error").and_then(Value::as_str),
        Some("invalid document id at index 1")
    );
    assert_no_marker(&line.to_string());

    assert!(kept.exists(), "a refused discard deleted {KEEP}");
    assert!(!gate.is_closed(), "a refused discard committed the quit");
}

#[test]
fn wi3_whole_request_lifetime_writes_no_id_to_the_log() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi3lifetime");
    let _home = set_home(&home);
    let _reset = QuitCommittedReset;
    draft::save_draft(KEEP, "BODY", None, "t").unwrap();
    let kept = bundle(&drafts_dir(&home), KEEP);

    let guard = guard_at(3_000);
    let r = later(guard.begin(&[WIN], 10));
    assert_eq!(r, 3_000, "guard_at did not land on its floor");
    let baseline = effects_of(&guard).len();

    guard.handle_reply(WIN, r, QuitAnswer::Dirty, None, 11).unwrap();
    assert!(guard
        .handle_reply(WIN, r, QuitAnswer::Discard, hostile_list(), 12)
        .is_err());
    guard.handle_reply(WIN, r, QuitAnswer::Cancel, None, 13).unwrap();
    assert_eq!(
        effects_of(&guard)[baseline..].last(),
        Some(&Effect::Reply(false)),
        "the request did not end in a cancel"
    );

    let all = |_: &Value| true;
    for event in ["app.quit.request", "app.quit.answer", "app.quit.cancel"] {
        assert!(
            !entries_where(&home, event, r, all).is_empty(),
            "no {event} line for request {r}: not a scan of a real lifetime"
        );
    }
    for line in log_lines(&home) {
        assert_no_marker(&line.to_string());
    }
    assert!(kept.exists(), "a refused discard deleted {KEEP}");
}
