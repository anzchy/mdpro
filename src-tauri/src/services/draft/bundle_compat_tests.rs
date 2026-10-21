//! D27 WI-1: the bundle's `owner` field on the wire (o1-o4) and on disk (o17).
//! Older builds must read owned bundles, and owner-less bundles must load.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::draft_test_home::TempHome;
use super::{load_draft, save_draft, save_draft_as, DraftBundle, DraftOwner};

/// The pre-change bundle struct, as an older build declares it.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyBundle {
    content: String,
    original_path: Option<String>,
    last_modified: String,
    recovered: bool,
    title: String,
}

const LEGACY_LITERALS: [&str; 4] = [
    r#"{"content":"a","originalPath":null,"lastModified":"2026-01-01T00:00:00+00:00","recovered":false,"title":"t"}"#,
    r#"{"content":"b","originalPath":"/tmp/a.md","lastModified":"2026-01-02T00:00:00+00:00","recovered":false,"title":"a.md"}"#,
    r#"{"content":"c","originalPath":null,"lastModified":"2026-01-03T00:00:00+00:00","recovered":true,"title":"t"}"#,
    r##"{"content":"# 你好 🎉\r\n","originalPath":null,"lastModified":"2026-01-04T00:00:00+00:00","recovered":false,"title":"say \"hi\""}"##,
];

fn owned_domain() -> Vec<DraftBundle> {
    let owners = [
        ("sess-current", "main"),
        ("", ""),
        ("uuid-5f1c2a", "win-3"),
        ("s", "标签 ✓"),
    ];
    let mut out = Vec::new();
    for (s, l) in owners {
        for recovered in [false, true] {
            out.push(DraftBundle {
                claim: None,
                claim_consumed: false,
                owner: Some(DraftOwner {
                    session_id: s.to_string(),
                    window_label: l.to_string(),
                }),
                content: format!("body {s} {l}"),
                original_path: Some("/tmp/o.md".to_string()),
                last_modified: "2026-09-26T00:00:00+00:00".to_string(),
                recovered,
                title: "o.md".to_string(),
            });
        }
    }
    out
}

#[test]
fn o1_legacy_bundle_round_trips_with_no_owner_key() {
    for literal in LEGACY_LITERALS {
        let original: Value = serde_json::from_str(literal).unwrap();
        let parsed: DraftBundle = serde_json::from_str(literal)
            .unwrap_or_else(|e| panic!("legacy bundle must parse: {e}: {literal}"));
        assert!(
            parsed.owner.is_none(),
            "legacy bundle has no owner: {literal}"
        );
        assert_eq!(
            serde_json::to_value(&parsed).unwrap(),
            original,
            "legacy bundle must round-trip unchanged: {literal}"
        );
    }
}

#[test]
fn o2_owner_none_writes_no_owner_key() {
    let b = DraftBundle {
        claim: None,
        claim_consumed: false,
        owner: None,
        content: "x".to_string(),
        original_path: None,
        last_modified: "2026-01-01T00:00:00+00:00".to_string(),
        recovered: false,
        title: "t".to_string(),
    };
    let v = serde_json::to_value(&b).unwrap();
    let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "content",
            "lastModified",
            "originalPath",
            "recovered",
            "title"
        ]
    );
}

#[test]
fn o3_owned_bundle_parses_into_the_pre_change_struct() {
    for b in owned_domain() {
        let text = serde_json::to_string(&b).unwrap();
        let old: LegacyBundle = serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("older build must read owned bundle: {e}: {text}"));
        assert_eq!(old.content, b.content);
        assert_eq!(old.original_path, b.original_path);
        assert_eq!(old.last_modified, b.last_modified);
        assert_eq!(old.recovered, b.recovered);
        assert_eq!(old.title, b.title);
    }
}

#[test]
fn o4_owned_bundle_round_trips_with_camel_case_owner_keys() {
    for b in owned_domain() {
        let text = serde_json::to_string(&b).unwrap();
        let back: DraftBundle = serde_json::from_str(&text).unwrap();
        assert_eq!(back, b, "owned bundle must round-trip: {text}");
        let owner = b.owner.as_ref().unwrap();
        assert_eq!(
            serde_json::to_value(&b).unwrap()["owner"],
            json!({"sessionId": owner.session_id, "windowLabel": owner.window_label})
        );
    }
}

fn raw_json(home: &TempHome, id: &str) -> Value {
    serde_json::from_slice(&home.read_raw(id)).expect("bundle is JSON")
}

#[test]
fn o17_owned_and_unowned_saves_on_disk() {
    const S: &str = "sess-current";
    let owner = DraftOwner {
        session_id: S.to_string(),
        window_label: "W".to_string(),
    };
    {
        let home = TempHome::new("draft_o17");
        save_draft_as(
            Some(owner.clone()),
            "d",
            "body",
            Some("/tmp/d.md".into()),
            "t",
        )
        .unwrap();
        let v = raw_json(&home, "d");
        assert_eq!(v["owner"], json!({"sessionId": S, "windowLabel": "W"}));
        assert_eq!(v["recovered"], json!(false));

        save_draft("d", "body2", None, "t").unwrap();
        let v = raw_json(&home, "d");
        assert!(
            !v.as_object().unwrap().contains_key("owner"),
            "an unowned save over an owned bundle leaves no owner: {v}"
        );
        assert_eq!(v["content"], json!("body2"));
    }
    let _home = TempHome::new("draft_o17_load");
    save_draft_as(Some(owner), "d", "body", Some("/tmp/d.md".into()), "t").unwrap();
    let draft = load_draft("d").unwrap().expect("owned bundle loads");
    assert_eq!(draft.content, "body");
    assert!(!draft.recovered);
}
