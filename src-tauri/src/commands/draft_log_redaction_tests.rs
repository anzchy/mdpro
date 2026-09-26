//! D27 WI-3 c6-c7: every `file.draft.*` log line is redacted (no id, path,
//! title or label; `error` is a `DraftError::kind()`), and its counts equal
//! the returned counts. c8 (failures carry kind + outcome) is in
//! `draft_log_redaction_failure_tests.rs`. The real logger writes to a temp
//! `$HOME`, and the JSONL file is parsed back.
use super::draft_recovery::{
    cleanup_old_drafts_logged, discard_recovery_draft_logged, list_drafts_logged,
    recover_draft_logged,
};
use crate::models::{LogLevel, LogSettings};
use crate::services::draft::{
    CleanupCounts, DraftListCounts, DraftOwner, LiveContext, OpenSet, ShadowUnavailable,
};
use crate::services::logger::set_log_settings;
use crate::services::quit_guard::DraftGate;
use serde_json::{json, Value};
use std::collections::BTreeSet;
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
const LA: &str = "SENTINELLABEL_A";
const LB: &str = "SENTINELLABEL_B";
const SPATH: &str = "/tmp/SENTINELPATH/x.md";
const SENTINELS: [&str; 4] = [
    "SENTINELID",
    "SENTINELPATH",
    "SENTINELTITLE",
    "SENTINELLABEL",
];
const FORBIDDEN_KEYS: [&str; 4] = ["documentId", "filePath", "title", "windowLabel"];
const KINDS: [&str; 5] = [
    "IoError",
    "NotFound",
    "ParseError",
    "OwnedByLiveWindow",
    "OpenInWindow",
];
const OUTCOMES: [&str; 4] = ["ok", "in_use", "not_found", "error"];

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

/// A raw bundle carrying the title and path sentinels.
fn sentinel_bundle(
    path: Option<&str>,
    lm: &str,
    recovered: bool,
    owner: Option<(&str, &str)>,
) -> String {
    let mut v: Value = serde_json::from_str(&bundle_json(
        "SENTINELTITLE body",
        path,
        lm,
        recovered,
        owner,
    ))
    .unwrap();
    v["title"] = json!("SENTINELTITLE");
    v.to_string()
}

#[test]
fn c6_every_file_draft_line_is_redacted_across_all_outcomes() {
    let home = TempHome::new("draft_log_c6");
    let log = start_log(&home);
    let (t, old) = (ago(1), ago(8));
    home.write_raw(
        "SENTINELID_l",
        &sentinel_bundle(None, &t, false, Some((P, LA))),
    );
    home.write_raw(
        "SENTINELID_r",
        &sentinel_bundle(None, &t, true, Some((P, "main"))),
    );
    home.write_raw(
        "SENTINELID_h",
        &sentinel_bundle(None, &t, false, Some((S, LA))),
    );
    home.write_raw(
        "SENTINELID_o",
        &sentinel_bundle(Some(SPATH), &t, false, None),
    );
    home.write_raw("SENTINELID_c", "{not json SENTINELTITLE");
    home.write_raw(
        "SENTINELID_s1",
        &sentinel_bundle(None, &old, true, Some((P, "main"))),
    );
    home.write_raw(
        "SENTINELID_s2",
        &sentinel_bundle(None, &old, true, Some((S, LA))),
    );
    let store = store_of(vec![win(
        LA,
        vec![doc("SENTINELID_x", Some(SPATH), true)],
        true,
        1,
    )]);
    let c = ctx(S, &[LA, LB], &store);
    let gate = DraftGate::new();
    let caller = who(S, LB);

    list_drafts_logged(&c).expect("list");
    assert!(recover_draft_logged(&gate, "SENTINELID_r", &caller, &c).is_ok());
    assert!(recover_draft_logged(&gate, "SENTINELID_h", &caller, &c).is_err());
    assert!(recover_draft_logged(&gate, "SENTINELID_o", &caller, &c).is_err());
    assert!(recover_draft_logged(&gate, "SENTINELID_missing", &caller, &c).is_err());
    assert!(recover_draft_logged(&gate, "SENTINELID_c", &caller, &c).is_err());
    assert_eq!(
        discard_recovery_draft_logged("SENTINELID_l", &c).ok(),
        Some(true)
    );
    assert_eq!(
        discard_recovery_draft_logged("SENTINELID_missing", &c).ok(),
        Some(false)
    );
    assert!(discard_recovery_draft_logged("SENTINELID_h", &c).is_err());
    let counts = cleanup_old_drafts_logged(&c).expect("cleanup");
    assert_eq!((counts.deleted, counts.skipped_live), (1, 1));

    let lines = draft_lines(&log);
    let mut seen: BTreeSet<(String, String)> = BTreeSet::new();
    for (raw, v) in &lines {
        for s in SENTINELS {
            assert!(!raw.contains(s), "log line leaks {s}: {raw}");
        }
        let context = v["context"].as_object().cloned().unwrap_or_default();
        for k in FORBIDDEN_KEYS {
            assert!(!context.contains_key(k), "log context has {k}: {raw}");
        }
        if let Some(e) = v["error"].as_str() {
            assert!(KINDS.contains(&e), "error is not a kind(): {raw}");
        }
        let event = v["event"].as_str().unwrap().to_string();
        let outcome = context
            .get("outcome")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let terminal = v["status"] != json!("start");
        if terminal && (event == "file.draft.recover" || event == "file.draft.discard") {
            assert!(OUTCOMES.contains(&outcome.as_str()), "bad outcome: {raw}");
        }
        if terminal {
            seen.insert((event, outcome));
        }
    }
    let want = [
        ("file.draft.list", ""),
        ("file.draft.cleanup", ""),
        ("file.draft.recover", "ok"),
        ("file.draft.recover", "in_use"),
        ("file.draft.recover", "not_found"),
        ("file.draft.recover", "error"),
        ("file.draft.discard", "ok"),
        ("file.draft.discard", "in_use"),
    ];
    for (e, o) in want {
        assert!(
            seen.contains(&(e.to_string(), o.to_string())),
            "no {e} line with outcome {o:?}; saw {seen:?}"
        );
    }
}

#[test]
fn c7_logged_counts_equal_the_returned_counts() {
    let home = TempHome::new("draft_log_c7");
    let log = start_log(&home);
    let (t, old, fresh) = (ago(1), ago(8), ago(1));
    // The g20 population.
    home.write_raw("i", &bundle_json("i", None, &t, false, Some((P, "main"))));
    home.write_raw("ii", &bundle_json("ii", None, &t, true, Some((P, "main"))));
    home.write_raw("iii", &bundle_json("iii", None, &t, true, None));
    home.write_raw("iv", &bundle_json("iv", None, &t, false, Some((S, "A"))));
    home.write_raw("v", "{not json");
    home.write_raw("vi", &bundle_json("vi", None, &t, false, None));
    home.write_legacy("Lr", "lr", None, &t, true);
    home.write_legacy("Ln", "ln", None, &t, false);
    let store = store_of(vec![win("A", vec![doc("vi", None, true)], true, 1)]);

    let listing = list_drafts_logged(&ctx(S, &["A"], &store)).expect("list");
    let want = DraftListCounts {
        listed: 4,
        hidden_in_use: 2,
        hidden_recovered: 2,
        relisted: 1,
    };
    assert_eq!(listing.counts, want);

    // The g23 population, in a clean drafts dir.
    fs::remove_dir_all(home.drafts_dir()).expect("clear drafts");
    const OPEN: &str = "/tmp/mdpro-c7/s_open.md";
    home.write_raw(
        "s_dead",
        &bundle_json("x", None, &old, true, Some((P, "main"))),
    );
    home.write_raw(
        "s_live",
        &bundle_json("x", None, &old, true, Some((S, "A"))),
    );
    home.write_raw("s_open", &bundle_json("x", Some(OPEN), &old, true, None));
    home.write_raw(
        "f_dead",
        &bundle_json("x", None, &fresh, true, Some((P, "main"))),
    );
    home.write_raw(
        "f_live",
        &bundle_json("x", None, &fresh, true, Some((S, "A"))),
    );
    home.write_raw("s_unrec", &bundle_json("x", None, &old, false, None));
    let store = store_of(vec![win("A", vec![doc("o", Some(OPEN), true)], true, 1)]);
    let cleaned = cleanup_old_drafts_logged(&ctx(S, &["A"], &store)).expect("cleanup");
    assert_eq!(
        cleaned,
        CleanupCounts {
            deleted: 1,
            skipped_live: 2
        }
    );

    let lines = draft_lines(&log);
    let ctx_of = |event: &str| -> Vec<Value> {
        lines
            .iter()
            .filter(|(_, v)| v["event"] == json!(event) && v["status"] == json!("success"))
            .map(|(_, v)| v["context"].clone())
            .collect()
    };
    let list = json!({"listed":4,"hiddenInUse":2,"hiddenRecovered":2,"relisted":1});
    assert_eq!(ctx_of("file.draft.list"), vec![list.clone()]);
    assert_eq!(serde_json::to_value(listing.counts).unwrap(), list);
    assert_eq!(
        ctx_of("file.draft.cleanup"),
        vec![json!({"deleted":1,"skippedLive":2})]
    );
}
