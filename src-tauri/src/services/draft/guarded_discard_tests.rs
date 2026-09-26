//! D27 WI-2 g14-g16, g5b + g14(vi), g26, g26b: `discard_draft_guarded`,
//! the dead-owner-but-open refusal, and the A12 check order when the shadow
//! store is unavailable.
use super::super::draft_fixture::{doc, store_of, win};
use super::super::draft_test_home::{ago, bundle_json, ctx, ctx_unavailable, who, TempHome};
use super::super::{save_draft, save_draft_as};
use super::*;
use crate::models::ShadowStore;
use serde_json::json;

const S: &str = "sess-current";
const P: &str = "previous-run";

fn empty() -> ShadowStore {
    ShadowStore::default()
}

#[test]
fn g14_guarded_discard_over_its_partitions() {
    let home = TempHome::new("guarded_g14");
    let ab = ctx(S, &["A", "B"], &empty());

    save_draft_as(Some(who(S, "A")), "i", "x", None, "t").unwrap();
    let before = home.read_raw("i");
    let r = discard_draft_guarded("i", &ab);
    assert!(matches!(r, Err(DraftError::OwnedByLiveWindow)), "(i) {r:?}");
    assert_eq!(home.read_raw("i"), before);

    save_draft("ii", "x", Some("/tmp/ii.md".into()), "t").unwrap();
    let before = home.read_raw("ii");
    let open = store_of(vec![win(
        "A",
        vec![doc("q", Some("/tmp/ii.md"), true)],
        true,
        1,
    )]);
    let r = discard_draft_guarded("ii", &ctx(S, &["A", "B"], &open));
    assert!(matches!(r, Err(DraftError::OpenInWindow)), "(ii) {r:?}");
    assert_eq!(home.read_raw("ii"), before);

    save_draft_as(Some(who(P, "main")), "iii", "x", None, "t").unwrap();
    assert!(
        matches!(discard_draft_guarded("iii", &ab), Ok(true)),
        "(iii)"
    );
    assert!(!home.exists("iii"));
    assert!(
        matches!(discard_draft_guarded("iii", &ab), Ok(false)),
        "(iv)"
    );
    assert!(
        matches!(discard_draft_guarded("never", &ab), Ok(false)),
        "(v)"
    );
}

#[test]
fn g15_a_corrupt_bundle_stays_discardable_but_its_id_open_check_applies() {
    let home = TempHome::new("guarded_g15");
    home.write_raw("c", "{not json");
    let open = store_of(vec![win("A", vec![doc("c", None, true)], true, 1)]);
    let r = discard_draft_guarded("c", &ctx(S, &["A"], &open));
    assert!(matches!(r, Err(DraftError::OpenInWindow)), "(ii) {r:?}");
    assert!(home.exists("c"));

    let r = discard_draft_guarded("c", &ctx(S, &["A"], &empty()));
    assert!(matches!(r, Ok(true)), "(i) {r:?}");
    assert!(!home.exists("c"));
}

#[test]
fn g16_guarded_discard_of_legacy_two_file_drafts() {
    let home = TempHome::new("guarded_g16");
    home.write_legacy("L", "legacy", Some("/tmp/L.md"), &ago(1), false);
    let open = store_of(vec![win(
        "A",
        vec![doc("x", Some("/tmp/L.md"), true)],
        true,
        1,
    )]);
    let r = discard_draft_guarded("L", &ctx(S, &["A"], &open));
    assert!(matches!(r, Err(DraftError::OpenInWindow)), "(i) {r:?}");
    assert!(home.legacy_md("L").exists() && home.legacy_meta("L").exists());

    let r = discard_draft_guarded("L", &ctx(S, &["A"], &empty()));
    assert!(matches!(r, Ok(true)), "(ii) {r:?}");
    assert!(!home.legacy_md("L").exists() && !home.legacy_meta("L").exists());
}

#[test]
fn g5b_g14vi_dead_owner_but_open_in_a_live_window_is_refused_by_both() {
    let home = TempHome::new("guarded_g5b");
    let p = home.path().join("d.md");
    std::fs::write(&p, "x").unwrap();
    let p_str = p.to_str().expect("utf-8 path");
    let store = store_of(vec![win("A", vec![doc("x", Some(p_str), false)], true, 1)]);
    let c = ctx(S, &["A", "B"], &store);

    for (variant, owner) in [(1, (P, "main")), (2, (S, "Z"))] {
        home.write_raw(
            "d",
            &bundle_json(
                "D",
                Some(p_str),
                "2020-01-01T00:00:00+00:00",
                false,
                Some(owner),
            ),
        );
        let before = home.read_raw("d");

        let r = recover_draft_guarded("d", &who(S, "B"), &c);
        assert!(
            matches!(r, Err(DraftError::OpenInWindow)),
            "v{variant} recover {r:?}"
        );
        assert_eq!(
            home.read_raw("d"),
            before,
            "v{variant} recover changed bytes"
        );

        let r = discard_draft_guarded("d", &c);
        assert!(
            matches!(r, Err(DraftError::OpenInWindow)),
            "v{variant} discard {r:?}"
        );
        assert_eq!(
            home.read_raw("d"),
            before,
            "v{variant} discard changed bytes"
        );

        let v = home.value("d");
        assert_eq!(v["recovered"], json!(false));
        assert_eq!(
            v["owner"],
            json!({"sessionId": owner.0, "windowLabel": owner.1})
        );
    }
}

fn assert_unavailable(r: &str, got: Result<impl std::fmt::Debug, DraftError>) {
    match got {
        Err(DraftError::IoError { message }) => assert!(
            message.contains("shadow store unavailable"),
            "{r}: message {message:?}"
        ),
        other => panic!("{r}: expected IoError(shadow store unavailable), got {other:?}"),
    }
}

#[test]
fn g26_recover_and_discard_fail_closed_when_the_shadow_store_is_unavailable() {
    let home = TempHome::new("guarded_g26");
    let c = ctx_unavailable(S, &["A", "B"]);
    home.write_raw(
        "u",
        &bundle_json("U", Some("/tmp/u.md"), &ago(1), false, None),
    );
    home.write_raw(
        "p",
        &bundle_json("P", None, &ago(1), false, Some((P, "main"))),
    );
    for id in ["u", "p"] {
        let before = home.read_raw(id);
        assert_unavailable(id, recover_draft_guarded(id, &who(S, "B"), &c));
        assert_eq!(home.read_raw(id), before, "{id}: recover changed bytes");
        assert_unavailable(id, discard_draft_guarded(id, &c));
        assert_eq!(home.read_raw(id), before, "{id}: discard changed bytes");
        assert_eq!(home.value(id)["recovered"], json!(false));
    }
}

/// A12: missing is decided before the store is consulted, and so is a live
/// owner. Discard of a missing id keeps the plan's `Ok(false)` (WI-2
/// "`Ok(false)` if absent", g14(v)); what it must not be is the IoError.
#[test]
fn g26b_a12_precedence_under_an_unavailable_store() {
    let home = TempHome::new("guarded_g26b");
    std::fs::create_dir_all(home.drafts_dir()).unwrap();
    let c = ctx_unavailable(S, &["A", "B"]);

    let r = recover_draft_guarded("gone", &who(S, "B"), &c);
    assert!(
        matches!(r, Err(DraftError::NotFound { .. })),
        "recover missing {r:?}"
    );
    let r = discard_draft_guarded("gone", &c);
    assert!(matches!(r, Ok(false)), "discard missing {r:?}");

    save_draft_as(Some(who(S, "A")), "o", "x", None, "t").unwrap();
    let before = home.read_raw("o");
    let r = recover_draft_guarded("o", &who(S, "B"), &c);
    assert!(
        matches!(r, Err(DraftError::OwnedByLiveWindow)),
        "recover owned {r:?}"
    );
    let r = discard_draft_guarded("o", &c);
    assert!(
        matches!(r, Err(DraftError::OwnedByLiveWindow)),
        "discard owned {r:?}"
    );
    assert_eq!(home.read_raw("o"), before);
}
