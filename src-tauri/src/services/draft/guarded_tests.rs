//! D27 WI-2 g5-g13: `recover_draft_guarded` — refusals leave the bundle
//! byte-identical; a success stamps recovered/owner/last_modified only.
use super::super::draft_fixture::{doc, store_of, win, Fixture};
use super::super::draft_test_home::{ago, bundle_json, ctx, who, TempHome};
use super::super::{save_draft, save_draft_as};
use super::*;
use crate::models::ShadowStore;
use chrono::{DateTime, Utc};
use serde_json::json;

const S: &str = "sess-current";
const P: &str = "previous-run";

fn empty() -> ShadowStore {
    ShadowStore::default()
}

fn lm(v: &serde_json::Value) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(v["lastModified"].as_str().expect("lastModified"))
        .expect("rfc3339")
        .with_timezone(&Utc)
}

#[test]
fn g5_recover_of_a_draft_owned_by_live_a_from_b_is_refused() {
    let home = TempHome::new("guarded_g5");
    save_draft_as(
        Some(who(S, "A")),
        "d",
        "A-body",
        Some("/tmp/d.md".into()),
        "t",
    )
    .unwrap();
    let before = home.read_raw("d");
    let r = recover_draft_guarded("d", &who(S, "B"), &ctx(S, &["A", "B"], &empty()));
    assert!(matches!(r, Err(DraftError::OwnedByLiveWindow)), "{r:?}");
    assert_eq!(home.read_raw("d"), before);
}

#[test]
fn g6_recover_of_a_draft_open_via_a_symlinked_path_is_refused() {
    let home = TempHome::new("guarded_g6");
    let fx = Fixture::new();
    save_draft("d", "body", Some(fx.a.clone()), "t").unwrap();
    let before = home.read_raw("d");
    let store = store_of(vec![win(
        "A",
        vec![doc("other-id", Some(&fx.canon_a), true)],
        true,
        1,
    )]);
    let r = recover_draft_guarded("d", &who(S, "B"), &ctx(S, &["A", "B"], &store));
    assert!(matches!(r, Err(DraftError::OpenInWindow)), "{r:?}");
    assert_eq!(home.read_raw("d"), before);
    assert_eq!(home.value("d")["recovered"], json!(false));
}

#[test]
fn g7_calling_window_is_allowed_for_recovery() {
    let home = TempHome::new("guarded_g7");
    // (i) open in the caller itself
    save_draft("d", "b", None, "t").unwrap();
    let before = home.read_raw("d");
    let store = store_of(vec![win("B", vec![doc("d", None, true)], true, 1)]);
    let r = recover_draft_guarded("d", &who(S, "B"), &ctx(S, &["B"], &store));
    assert_eq!(r.expect("same-window id").target.unwrap().id, "d");
    assert_ne!(home.read_raw("d"), before);
    // (ii) owned by the caller itself
    save_draft_as(Some(who(S, "B")), "d2", "b", None, "t").unwrap();
    let before = home.read_raw("d2");
    let r = recover_draft_guarded("d2", &who(S, "B"), &ctx(S, &["B"], &empty()));
    assert!(r.is_ok(), "(ii) {r:?}");
    assert_ne!(home.read_raw("d2"), before);
}

#[test]
fn d299_wi2_same_id_in_calling_window_returns_target_and_claim() {
    let home = TempHome::new("d299_wi2_same_id");
    save_draft_as(
        Some(who(P, "main")),
        "b",
        "older unsaved text",
        Some("/tmp/b.md".into()),
        "B",
    )
    .unwrap();
    let store = store_of(vec![win(
        "B",
        vec![doc("b", Some("/tmp/b.md"), true)],
        true,
        1,
    )]);
    let result = recover_draft_guarded("b", &who(S, "B"), &ctx(S, &["B"], &store))
        .expect("same-window same-id recovery is allowed");
    let wire = serde_json::to_value(&result).unwrap();
    assert_eq!(wire["content"], json!("older unsaved text"));
    assert_eq!(wire["target"], json!({"id":"b","storedPath":"/tmp/b.md"}));
    assert_eq!(wire["claimToken"]["sourceId"], json!("b"));
    assert!(wire["claimToken"]["nonce"]
        .as_str()
        .is_some_and(|v| !v.is_empty()));
    assert_eq!(home.value("b")["claim"], wire["claimToken"]);
}

#[test]
fn d299_wi2_caller_alias_returns_the_stored_target() {
    let home = TempHome::new("d299_caller_alias");
    let fx = Fixture::new();
    save_draft("draft", "R", Some(fx.a.clone()), "R").unwrap();
    let store = store_of(vec![win(
        "B",
        vec![doc("tab", Some(&fx.canon_a), true)],
        true,
        1,
    )]);
    let result = recover_draft_guarded("draft", &who(S, "B"), &ctx(S, &["B"], &store))
        .expect("caller alias is recoverable");
    assert_eq!(
        result.target,
        Some(crate::services::draft::RecoverTarget {
            id: "tab".into(),
            stored_path: Some(fx.canon_a.clone()),
        })
    );
    assert_eq!(result.content, "R");
    assert_eq!(
        home.value("draft")["claim"],
        serde_json::to_value(result.claim_token).unwrap()
    );
}

#[test]
fn d299_wi2_foreign_alias_refuses_even_when_caller_match_is_first() {
    let home = TempHome::new("d299_mixed_windows");
    let fx = Fixture::new();
    save_draft("draft", "R", Some(fx.a.clone()), "R").unwrap();
    let before = home.read_raw("draft");
    let caller = win("B", vec![doc("draft", Some(&fx.a), true)], true, 1);
    let foreign = win("A", vec![doc("alias", Some(&fx.canon_a), true)], true, 1);
    for rows in [
        vec![caller.clone(), foreign.clone()],
        vec![foreign.clone(), caller.clone()],
    ] {
        let store = store_of(rows);
        let result = recover_draft_guarded("draft", &who(S, "B"), &ctx(S, &["A", "B"], &store));
        assert!(
            matches!(result, Err(DraftError::OpenInWindow)),
            "{result:?}"
        );
        assert_eq!(home.read_raw("draft"), before);
    }
    let caller_alias = win("B", vec![doc("alias", Some(&fx.canon_a), true)], true, 1);
    let foreign_id = win("A", vec![doc("draft", Some(&fx.a), true)], true, 1);
    for rows in [
        vec![caller_alias.clone(), foreign_id.clone()],
        vec![foreign_id, caller_alias],
    ] {
        let store = store_of(rows);
        let result = recover_draft_guarded("draft", &who(S, "B"), &ctx(S, &["A", "B"], &store));
        assert!(
            matches!(result, Err(DraftError::OpenInWindow)),
            "{result:?}"
        );
        assert_eq!(home.read_raw("draft"), before);
    }
}

#[test]
fn g8_successful_recover_result_and_every_reloaded_field() {
    let home = TempHome::new("guarded_g8");
    let raw = json!({"content":"C","originalPath":"/tmp/d.md",
        "lastModified":"2020-01-01T00:00:00+00:00","recovered":false,"title":"T",
        "owner":{"sessionId":"previous-run","windowLabel":"main"}});
    home.write_raw("d", &raw.to_string());
    let t0 = Utc::now();
    let r = recover_draft_guarded("d", &who(S, "B"), &ctx(S, &["main", "B"], &empty()))
        .expect("recover succeeds");
    let t1 = Utc::now();
    assert_eq!(r.content, "C");
    assert_eq!(r.original_path.as_deref(), Some("/tmp/d.md"));
    assert_eq!(r.title, "T");
    let v = home.value("d");
    assert_eq!(v["recovered"], json!(true));
    assert_eq!(v["owner"], json!({"sessionId": S, "windowLabel": "B"}));
    let stamped = lm(&v);
    assert!(t0 <= stamped && stamped <= t1, "{t0} <= {stamped} <= {t1}");
    assert_eq!(v["content"], json!("C"));
    assert_eq!(v["originalPath"], json!("/tmp/d.md"));
    assert_eq!(v["title"], json!("T"));
}

#[test]
fn g9_save_then_recover_returns_the_same_triple() {
    let _home = TempHome::new("guarded_g9");
    let big = "x".repeat(1 << 20);
    let contents = [
        "",
        "# 你好 🎉",
        "a\r\nb\r\n",
        big.as_str(),
        "\"quoted\" \\ back",
    ];
    let c = ctx(S, &["main", "B"], &empty());
    let mut n = 0;
    for content in contents {
        for path in [None, Some("/tmp/r.md".to_string())] {
            for title in ["", "T"] {
                let id = format!("r{n}");
                n += 1;
                save_draft_as(Some(who(P, "main")), &id, content, path.clone(), title).unwrap();
                let r = recover_draft_guarded(&id, &who(S, "B"), &c).expect("recover");
                assert_eq!(r.content, content, "{id}");
                assert_eq!(r.original_path, path, "{id}");
                assert_eq!(r.title, title, "{id}");
            }
        }
    }
    assert_eq!(n, 20);
}

#[test]
fn g10_ownership_moves_by_recovery_and_dies_with_the_window() {
    let home = TempHome::new("guarded_g10");
    home.write_raw(
        "d",
        &bundle_json("D", None, &ago(1), false, Some((P, "main"))),
    );
    let abc = ctx(S, &["A", "B", "C"], &empty());
    let ac = ctx(S, &["A", "C"], &empty());

    recover_draft_guarded("d", &who(S, "B"), &abc).expect("1: B recovers");
    let v1 = home.value("d");
    assert_eq!(v1["owner"]["windowLabel"], json!("B"));
    let b1 = home.read_raw("d");

    let r2 = recover_draft_guarded("d", &who(S, "A"), &abc);
    assert!(
        matches!(r2, Err(DraftError::OwnedByLiveWindow)),
        "2: {r2:?}"
    );
    assert_eq!(home.read_raw("d"), b1);

    let r3 = recover_draft_guarded("d", &who(S, "B"), &abc);
    assert!(r3.is_ok(), "3: {r3:?}");
    assert_ne!(home.read_raw("d"), b1);

    recover_draft_guarded("d", &who(S, "C"), &ac).expect("4: C recovers once B closed");
    let v4 = home.value("d");
    assert_eq!(v4["owner"]["windowLabel"], json!("C"));
    assert!(lm(&v4) >= lm(&v1), "last_modified is non-decreasing");
    let b4 = home.read_raw("d");

    let r5 = recover_draft_guarded("d", &who(S, "A"), &ac);
    assert!(
        matches!(r5, Err(DraftError::OwnedByLiveWindow)),
        "5: {r5:?}"
    );
    assert_eq!(home.read_raw("d"), b4);
}

#[test]
fn g11_missing_and_invalid_ids() {
    let home = TempHome::new("guarded_g11");
    std::fs::create_dir_all(home.drafts_dir()).unwrap();
    let c = ctx(S, &["B"], &empty());
    let r = recover_draft_guarded("absent", &who(S, "B"), &c);
    match r {
        Err(DraftError::NotFound { document_id }) => assert_eq!(document_id, "absent"),
        other => panic!("(i) expected NotFound, got {other:?}"),
    }
    let r = recover_draft_guarded("../escape", &who(S, "B"), &c);
    assert!(matches!(r, Err(DraftError::IoError { .. })), "(ii) {r:?}");
    assert!(home.snapshot().is_empty(), "no file was created");
}

#[test]
fn g12_corrupt_bundle_recover_is_a_parse_error_and_changes_nothing() {
    let home = TempHome::new("guarded_g12");
    home.write_raw("c", "{not json");
    let r = recover_draft_guarded("c", &who(S, "B"), &ctx(S, &["B"], &empty()));
    assert!(matches!(r, Err(DraftError::ParseError { .. })), "{r:?}");
    assert_eq!(home.read_raw("c"), b"{not json");
}

#[test]
fn g13_legacy_two_file_recover_gets_the_open_set_check() {
    let home = TempHome::new("guarded_g13");
    home.write_legacy("L", "legacy", Some("/tmp/L.md"), &ago(1), false);
    let md = std::fs::read(home.legacy_md("L")).unwrap();
    let meta = std::fs::read(home.legacy_meta("L")).unwrap();

    let open = store_of(vec![win(
        "A",
        vec![doc("x", Some("/tmp/L.md"), true)],
        true,
        1,
    )]);
    let r = recover_draft_guarded("L", &who(S, "B"), &ctx(S, &["A", "B"], &open));
    assert!(matches!(r, Err(DraftError::OpenInWindow)), "(i) {r:?}");
    assert_eq!(std::fs::read(home.legacy_md("L")).unwrap(), md);
    assert_eq!(std::fs::read(home.legacy_meta("L")).unwrap(), meta);

    let r = recover_draft_guarded("L", &who(S, "B"), &ctx(S, &["A", "B"], &empty()))
        .expect("(ii) recover");
    assert_eq!(r.content, "legacy");
    assert_eq!(r.original_path.as_deref(), Some("/tmp/L.md"));
    assert_eq!(r.title, "legacy L");
    let migrated = home.value("L");
    assert_eq!(migrated["recovered"], json!(true));
    assert_eq!(
        migrated["claim"],
        serde_json::to_value(r.claim_token).unwrap()
    );
}
