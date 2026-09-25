//! ADR-0035 WI-4 (A6): DL-4, redaction across every new and changed
//! `app.quit.*` line, split out of `driver_backstop_log_tests.rs` (rule 50 §6).
//!
//! Registered from `driver_tests.rs`; reads the real JSONL log under a temp
//! `$HOME`, holding `HOME_LOCK`, with request id 9_300 from the 9_000 band.
//!
//! Law: for each event the context key set equals its allowlist, and no value
//! carries any document id supplied during the run.

use super::driver_backstop_log_tests::{all, commit_line, keys, replies, set};
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    entries_where, finish_quit, fresh_log_home, guard_at, later, log_lines, set_home,
};
use crate::HOME_LOCK;
use serde_json::Value;

// ── DL-4 ──────────────────────────────────────────────────────────────────────

fn string_values(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => out.push(s.clone()),
        Value::Array(a) => a.iter().for_each(|x| string_values(x, out)),
        Value::Object(m) => m.values().for_each(|x| string_values(x, out)),
        _ => {}
    }
}

#[test]
fn dl4_redaction_across_every_new_and_changed_line() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("dl4");
    let _home = set_home(&home);
    let hostile = ["doc/../x", "é\"q", "a.b*c", "x"];
    let list = |ids: &[&str]| Some(ids.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    let guard = guard_at(9_300);
    let r = later(guard.begin(&["A", "B"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Clean, None, 2)
        .unwrap();
    // Phase 2: a hostile list (refused or not), then a plain one.
    let _ = guard.handle_reply("A", r, QuitAnswer::Discard, list(&hostile), 3);
    let _ = guard.handle_reply("A", r, QuitAnswer::Discard, list(&["x"]), 4);
    // The re-check: A is dirty again and is re-prompted.
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 5)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Clean, None, 6)
        .unwrap();
    let _ = guard.handle_reply("A", r, QuitAnswer::Discard, list(&hostile[1..3]), 7);
    let _ = guard.handle_reply("A", r, QuitAnswer::Discard, list(&["x"]), 8);
    finish_quit(&guard, r, &["A", "B"], 9);
    assert_eq!(replies(&guard), 1);

    let round_keys = set(&["requestId", "round", "windowCount"]);
    for event in ["app.quit.recheck", "app.quit.backstop"] {
        let lines = entries_where(&home, event, r, all);
        assert!(!lines.is_empty(), "no {event} line");
        for line in lines {
            assert_eq!(keys(&line["context"]), round_keys, "{event}: {line}");
        }
    }
    // ADR-0035 review M-1: the commit context gains the `undiscarded` count, so the exact key set grows by one.
    let commit_keys = set(&[
        "requestId",
        "deleted",
        "failed",
        "drafted",
        "draftFailed",
        "draftMissing",
        "capped",
        "backstop",
        "gateWaitMs",
        "undiscarded",
    ]);
    assert_eq!(keys(&commit_line(&home, r)["context"]), commit_keys);
    // The drafted answer: the existing answer keys plus the two counts. `round`
    // joins every answer line with the IPC round argument (WI-5).
    let drafted = entries_where(&home, "app.quit.answer", r, |v| {
        v["context"]["answer"] == "drafted"
    });
    assert_eq!(
        drafted.len(),
        2,
        "one drafted answer per window: {drafted:?}"
    );
    let base = set(&[
        "windowLabel",
        "answer",
        "requestId",
        "idCount",
        "draftedCount",
        "failedCount",
    ]);
    for line in &drafted {
        let got = keys(&line["context"]);
        assert!(base.is_subset(&got), "missing keys: {line}");
        let mut allowed = base.clone();
        allowed.insert("round".to_string());
        assert!(got.is_subset(&allowed), "unexpected keys: {line}");
    }

    let ours: Vec<Value> = log_lines(&home)
        .into_iter()
        .filter(|v| v.pointer("/context/requestId").and_then(Value::as_u64) == Some(r))
        .collect();
    assert!(!ours.is_empty());
    for line in &ours {
        let mut values = Vec::new();
        string_values(line, &mut values);
        for id in hostile {
            // "x" is a letter of ordinary words ("index"), so for it the law
            // is checked as equality; the other ids as substrings.
            let leaked = values
                .iter()
                .any(|v| if id == "x" { v == id } else { v.contains(id) });
            assert!(!leaked, "{id:?} leaked into {line}");
        }
    }
}
