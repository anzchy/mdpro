//! D27 WI-3 c8: a failed recover logs its `DraftError::kind()` and the mapped
//! `outcome`. Split out of `draft_log_redaction_tests.rs` (file-size limit);
//! `start_log` and `draft_lines` are duplicated from there. The real logger
//! writes to a temp `$HOME`, and the JSONL file is parsed back.
use super::draft_recovery::recover_draft_logged;
use crate::models::{LogLevel, LogSettings};
// The mounted `draft_test_home` fixture resolves these through `super::`.
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use crate::services::logger::set_log_settings;
use crate::services::quit_guard::DraftGate;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/open_route/lookup_fixture.rs"]
mod draft_fixture;
#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/draft/draft_test_home.rs"]
mod draft_test_home;
use draft_fixture::{doc, store_of, win};
use draft_test_home::{ago, bundle_json, ctx, who, TempHome};

const S: &str = "sess-current";
const P: &str = "previous-run";

/// Enable Info logging and start from an empty log file.
fn start_log(home: &TempHome) -> PathBuf {
    set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    let path = home.path().join(".mdpro").join("mdpro.log");
    let _ = fs::remove_file(&path);
    path
}

/// Every `file.draft.*` line: (raw text, parsed JSON).
fn draft_lines(log: &PathBuf) -> Vec<(String, Value)> {
    let text = fs::read_to_string(log).unwrap_or_default();
    text.lines()
        .filter_map(|l| {
            serde_json::from_str::<Value>(l)
                .ok()
                .map(|v| (l.to_string(), v))
        })
        .filter(|(_, v)| {
            v["event"]
                .as_str()
                .is_some_and(|e| e.starts_with("file.draft."))
        })
        .collect()
}
#[test]
fn c8_failure_lines_carry_kind_and_the_mapped_outcome() {
    let home = TempHome::new("draft_log_c8");
    let log = start_log(&home);
    let t = ago(1);
    const OPEN: &str = "/tmp/mdpro-c8/open.md";
    home.write_raw("owned", &bundle_json("x", None, &t, false, Some((S, "A"))));
    home.write_raw("open", &bundle_json("x", Some(OPEN), &t, false, None));
    home.write_raw("corrupt", "{not json");
    home.write_raw(
        "late",
        &bundle_json("x", None, &t, false, Some((P, "main"))),
    );
    let store = store_of(vec![win("A", vec![doc("o", Some(OPEN), true)], true, 1)]);
    let c = ctx(S, &["A", "B"], &store);
    let caller = who(S, "B");
    let open = DraftGate::new();
    let closed = DraftGate::new();
    drop(closed.close());

    for (gate, id) in [
        (&open, "owned"),
        (&open, "open"),
        (&open, "missing"),
        (&open, "corrupt"),
        (&closed, "late"),
    ] {
        assert!(recover_draft_logged(gate, id, &caller, &c).is_err(), "{id}");
    }

    let got: Vec<(String, String)> = draft_lines(&log)
        .iter()
        .filter(|(_, v)| v["event"] == json!("file.draft.recover") && !v["error"].is_null())
        .map(|(_, v)| {
            (
                v["error"].as_str().unwrap().to_string(),
                v["context"]["outcome"].as_str().unwrap_or("").to_string(),
            )
        })
        .collect();
    let want: Vec<(String, String)> = [
        ("OwnedByLiveWindow", "in_use"),
        ("OpenInWindow", "in_use"),
        ("NotFound", "not_found"),
        ("ParseError", "error"),
        ("IoError", "error"),
    ]
    .iter()
    .map(|(e, o)| (e.to_string(), o.to_string()))
    .collect();
    assert_eq!(got, want);
}
