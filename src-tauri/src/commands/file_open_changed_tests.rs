//! D111-WI-3: `open_file` and `open_file_dialog` put the seed check that
//! `watch_seeded` returns on their reply as `changedSinceRead`, and both
//! replies serialise the field camelCase for the frontend. The commands
//! need a Tauri `State`, which no test can build, so the wiring is a source
//! tripwire on file.rs; the check itself is proven in
//! services/file_watcher_seed_check_tests.rs.
use super::file::{OpenFileResult, SaveResult};
use crate::models::Document;
use crate::services::file_watcher::kinds_fixture::{code_lines, fn_slice};
use serde_json::json;

const FILE_SRC: &str = include_str!("file.rs");

/// The command body with comments dropped and all whitespace removed.
fn squeezed(anchor: &str) -> String {
    code_lines(fn_slice(FILE_SRC, anchor))
        .collect::<String>()
        .split_whitespace()
        .collect()
}

#[test]
fn d111_wi3_open_commands_reply_with_the_seed_check() {
    for anchor in ["pub async fn open_file(", "pub async fn open_file_dialog("] {
        let body = squeezed(anchor);
        let assign = body
            .find("result.changed_since_read=watcher.watch_seeded(")
            .unwrap_or_else(|| panic!("{anchor}: the reply takes the check:\n{body}"));
        let changed = body[assign..].find(").changed();").map(|i| assign + i);
        let ok = body.rfind("Ok(").expect("the reply");
        assert!(
            changed.is_some_and(|c| c < ok),
            "{anchor}: before Ok:\n{body}"
        );
        assert_eq!(body.matches("watch_seeded(").count(), 1, "{anchor}");
        assert!(body.contains("let(mutresult,seed)"), "{anchor}:\n{body}");
    }
}

#[test]
fn d111_wi3_replies_serialise_changed_since_read_camel_case() {
    let open = OpenFileResult {
        document: Document::new(),
        recovered_draft: None,
        changed_since_read: true,
    };
    let v = serde_json::to_value(&open).expect("json");
    assert_eq!(v["changedSinceRead"], json!(true), "{v}");
    assert!(v.get("changed_since_read").is_none(), "{v}");

    let save = SaveResult {
        success: true,
        path: "/d/a.md".into(),
        saved_at: 1,
        changed_since_read: true,
        blocked_by_pending_change: false,
    };
    let v = serde_json::to_value(&save).expect("json");
    assert_eq!(v["changedSinceRead"], json!(true), "{v}");
    assert_eq!(v["blockedByPendingChange"], json!(false), "{v}");
}
