//! D173-WI-2 (plan r2 §4, commit 2): the save notice's wire shape and its
//! source tripwires. Pure values and source text, so ungated.
//! - The payload is additive: a notice is the watcher's `file:changed`
//!   payload plus `origin: {windowLabel, documentId}`; a watcher event
//!   carries no `origin` and its bytes are what they were.
//! - `SaveResult`'s reply keys are unchanged (the written target is never
//!   serialised).
//! - The notice takes no lock but the holders map (H), does no file-system
//!   I/O and never re-canonicalises (ruling: snapshot the consumer spellings
//!   under H with no I/O).
//! - The production sink really emits `file:changed` and reports the emit's
//!   Result.
use super::super::kinds_fixture::code_lines;
use super::super::FileChangedEvent;
use super::{SaveNotice, SaveOrigin};
use crate::commands::file::SaveResult;
use serde_json::{json, Value};

const NOTICE_SRC: &str = include_str!("file_watcher_save_notice.rs");
const HOLDERS_SRC: &str = include_str!("file_watcher_holders.rs");
const TEARDOWN_SRC: &str = include_str!("file_watcher_holders_teardown.rs");
const WATCHER_SRC: &str = include_str!("file_watcher.rs");

/// The body of the method or function introduced by `anchor`: from the
/// anchor to the first line that closes at the anchor line's indent.
fn body_of(src: &str, anchor: &str) -> Option<String> {
    let start = src.find(anchor)?;
    let line_start = src[..start].rfind('\n').map_or(0, |i| i + 1);
    let indent = src[line_start..start].len() - src[line_start..start].trim_start().len();
    let close = format!("\n{}}}", " ".repeat(indent));
    let rest = &src[line_start..];
    let end = rest.find(&close).map_or(rest.len(), |i| i + close.len());
    Some(code_lines(&rest[..end]).collect::<Vec<_>>().join("\n"))
}

/// `anchor`'s body in whichever of the watcher's D173 sources defines it.
fn body_anywhere(anchor: &str) -> String {
    [NOTICE_SRC, HOLDERS_SRC, TEARDOWN_SRC]
        .iter()
        .find_map(|src| body_of(src, anchor))
        .unwrap_or_else(|| panic!("no `{anchor}` in the D173 watcher sources"))
}

fn notice() -> SaveNotice {
    SaveNotice {
        event: FileChangedEvent {
            path: "/d/a.md".into(),
            change_type: "modified".into(),
            new_path: None,
            timestamp: 5,
        },
        origin: SaveOrigin {
            window_label: "mdpro-w1".into(),
            document_id: "doc-a".into(),
        },
    }
}

#[test]
fn d173_wi2_s1_notice_is_the_watcher_payload_plus_camel_case_origin() {
    let got = serde_json::to_value(notice()).expect("json");
    assert_eq!(
        got,
        json!({
            "path": "/d/a.md",
            "changeType": "modified",
            "newPath": null,
            "timestamp": 5,
            "origin": { "windowLabel": "mdpro-w1", "documentId": "doc-a" },
        })
    );
}

#[test]
fn d173_wi2_s2_watcher_event_carries_no_origin_and_is_byte_identical() {
    let event = FileChangedEvent {
        path: "/d/a.md".into(),
        change_type: "renamed".into(),
        new_path: Some("/d/b.md".into()),
        timestamp: 7,
    };
    assert_eq!(
        serde_json::to_string(&event).expect("json"),
        r#"{"path":"/d/a.md","changeType":"renamed","newPath":"/d/b.md","timestamp":7}"#,
        "the watcher's file:changed bytes are unchanged"
    );
}

#[test]
fn d173_wi2_s3_save_reply_keys_unchanged_written_target_not_serialised() {
    let save = SaveResult {
        success: true,
        path: "/d/a.md".into(),
        saved_at: 1,
        changed_since_read: false,
        blocked_by_pending_change: false,
        hold_gen: 0,
        written_to: None,
    };
    let got = serde_json::to_value(&save).expect("json");
    let Value::Object(map) = got else {
        panic!("an object")
    };
    let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "blockedByPendingChange",
            "changedSinceRead",
            "holdGen",
            "path",
            "savedAt",
            "success"
        ]
    );
}

/// `d173_wi2_i`: the notice takes no lock but H, does no I/O, and never
/// re-canonicalises the target the save resolved.
#[test]
fn d173_wi2_i_notice_takes_no_lock_but_holders() {
    let spellings = body_anywhere("fn consumer_spellings(");
    assert!(
        spellings.contains("with_map"),
        "consumer_spellings reads the holders map through `with_map` (H):\n{spellings}"
    );
    let notice = body_anywhere("fn notice_saved(");
    assert!(
        notice.contains("consumer_spellings("),
        "notice_saved snapshots the consumer spellings:\n{notice}"
    );
    assert!(
        notice.contains("emit_notice("),
        "notice_saved emits through the sink:\n{notice}"
    );
    for (name, body) in [
        ("consumer_spellings", &spellings),
        ("notice_saved", &notice),
    ] {
        for banned in [
            "canonicalize",
            "group_key(",
            "fs::",
            ".lock()",
            "transition(",
            "baselines",
            "watched_paths",
        ] {
            assert!(
                !body.contains(banned),
                "{name} must not use `{banned}` (lock H only, no I/O):\n{body}"
            );
        }
    }
    for banned in ["loop", "while ", "retry"] {
        assert!(
            !notice.contains(banned),
            "notice_saved never retries (`{banned}`):\n{notice}"
        );
    }
}

#[test]
fn d173_wi2_s4_production_sink_emits_file_changed_and_reports_the_result() {
    let sink =
        body_of(NOTICE_SRC, "impl NoticeSink for AppNoticeSink").expect("the production sink");
    assert!(
        sink.contains(".emit(\"file:changed\"") || sink.contains(".emit(FILE_CHANGED"),
        "the production sink emits `file:changed`:\n{sink}"
    );
    assert!(
        sink.contains("map_err"),
        "the production sink returns the emit's Result:\n{sink}"
    );
    let new = body_of(WATCHER_SRC, "pub fn new(").expect("FileWatcher::new");
    assert!(
        new.contains("AppNoticeSink("),
        "FileWatcher::new installs the production sink:\n{new}"
    );
}
