//! D173-WI-1: every acquisition reply carries the gen of the hold it
//! confirmed, as camelCase `holdGen`, so the frontend can release with the
//! latest gen it saw. The serde rows pin the wire name; the wiring rows pin
//! that each command sets it from its confirmed reservation (pure source
//! text, so ungated).
use super::file::{OpenFileResult, SaveResult};
use crate::models::Document;
use crate::services::draft::RecoverResult;
use crate::services::file_watcher::kinds_fixture::{code_lines, fn_slice};
use serde_json::json;

const FILE_SRC: &str = include_str!("file.rs");
const RECOVER_SRC: &str = include_str!("draft_recover_watch.rs");

fn code_of(src: &str, anchor: &str) -> String {
    code_lines(fn_slice(src, anchor))
        .collect::<Vec<_>>()
        .join("\n")
}

fn assert_hold_gen(v: &serde_json::Value, tag: &str) {
    assert_eq!(v["holdGen"], json!(7), "{tag}: {v}");
    assert!(v.get("hold_gen").is_none(), "{tag}: snake_case leaked: {v}");
}

#[test]
fn d173_wi1_s1_replies_serialise_hold_gen_camel_case() {
    let open = OpenFileResult {
        document: Document::new(),
        recovered_draft: None,
        changed_since_read: false,
        hold_gen: 7,
    };
    assert_hold_gen(&serde_json::to_value(&open).expect("json"), "open");
    let save = SaveResult {
        success: true,
        path: "/d/a.md".into(),
        saved_at: 1,
        changed_since_read: false,
        blocked_by_pending_change: false,
        hold_gen: 7,
        written_to: None,
    };
    assert_hold_gen(&serde_json::to_value(&save).expect("json"), "save as");
    let recover = RecoverResult {
        content: "body".into(),
        original_path: Some("/d/a.md".into()),
        title: "a".into(),
        hold_gen: 7,
        target: None,
        claim_token: crate::services::draft::DraftClaimToken {
            source_id: "a".into(),
            nonce: "n".into(),
            session_id: "s".into(),
        },
    };
    assert_hold_gen(&serde_json::to_value(&recover).expect("json"), "recover");
}

/// The text after the first `confirm_hold(` sets `hold_gen` from a
/// reservation's `.gen` (directly, or from a value whose source is one).
fn assert_set_after_confirm(body: &str, anchor: &str) {
    let confirm = body
        .find("confirm_hold(")
        .unwrap_or_else(|| panic!("{anchor}: no confirm_hold(:\n{body}"));
    let after = &body[confirm..];
    let line = after
        .lines()
        .find(|l| l.contains("hold_gen"))
        .unwrap_or_else(|| panic!("{anchor}: hold_gen is not set after confirm_hold:\n{body}"));
    assert!(
        line.contains(".gen") || after.contains(".gen"),
        "{anchor}: hold_gen comes from the confirmed reservation's gen:\n{body}"
    );
}

#[test]
fn d173_wi1_w7_acquisitions_set_hold_gen_from_the_confirmed_reservation() {
    for anchor in [
        "pub async fn open_file(",
        "pub async fn open_file_dialog(",
        "pub async fn save_file_dialog(",
    ] {
        assert_set_after_confirm(&code_of(FILE_SRC, anchor), anchor);
    }
    let watch = code_of(RECOVER_SRC, "fn watch_recovered(");
    let confirm = watch
        .find("confirm_hold(")
        .unwrap_or_else(|| panic!("watch_recovered: no confirm_hold(:\n{watch}"));
    assert!(
        watch[confirm..].contains(".gen"),
        "watch_recovered hands back the confirmed reservation's gen:\n{watch}"
    );
    let outer = code_of(RECOVER_SRC, "pub(crate) fn recover_draft_watched_with(");
    assert!(
        outer.contains("watch_recovered(") && outer.contains("hold_gen"),
        "recover_draft_watched_with puts watch_recovered's gen in hold_gen:\n{outer}"
    );
}
