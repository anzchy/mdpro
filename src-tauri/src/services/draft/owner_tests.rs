//! D27 WI-1: `owner_is_live`, `in_use`, `OpenSet::from_store`, `session_id`
//! (o5-o16). Session ids are injected through `LiveContext`; only o16 calls
//! the production `session_id()`.
use super::super::draft_test_home::ctx;
use super::owner_fixture::{doc, store_of, win, Fixture};
use super::*;
use crate::models::{DocumentState, ShadowStore, SyncDocumentsPayload};
use crate::services::shadow_store::{create_shadow_store, sync_documents};

const S: &str = "sess-current";
const P: &str = "previous-run";

fn owner(session: &str, label: &str) -> DraftOwner {
    DraftOwner {
        session_id: session.to_string(),
        window_label: label.to_string(),
    }
}

fn empty() -> ShadowStore {
    ShadowStore::default()
}

#[test]
fn o5_only_same_session_and_live_label_is_live() {
    let owners = [None, Some(owner(S, "A")), Some(owner(P, "A"))];
    let label_sets: [&[&str]; 2] = [&["A", "B"], &["B"]];
    for o in &owners {
        for live in label_sets {
            let expected = *o == Some(owner(S, "A")) && live.contains(&"A");
            let got = owner_is_live(o.as_ref(), &ctx(S, live, &empty()));
            assert_eq!(got, expected, "row owner={o:?} live={live:?}");
        }
    }
}

#[test]
fn o6_previous_runs_main_is_not_live_while_main_is_open_now() {
    let o = owner(P, "main");
    assert!(
        !owner_is_live(Some(&o), &ctx(S, &["main"], &empty())),
        "ADR-0038: labels recur across runs; a crashed run's `main` is dead"
    );
}

#[test]
fn o7_open_by_id_in_a_live_window() {
    let store = store_of(vec![win("A", vec![doc("doc-7", None, true)], true, 1)]);
    let got = in_use("doc-7", None, None, &ctx(S, &["A"], &store));
    assert_eq!(got, Some(InUseReason::OpenInWindow));
}

#[test]
fn o8_path_aliases_of_an_open_file_are_in_use() {
    let fx = Fixture::new();
    let store = store_of(vec![win(
        "A",
        vec![doc("x", Some(&fx.canon_a), false)],
        true,
        1,
    )]);
    let c = ctx(S, &["A"], &store);
    #[allow(unused_mut)]
    let mut rows = vec![
        (fx.a.clone(), Some(InUseReason::OpenInWindow)),
        (fx.alias.clone(), Some(InUseReason::OpenInWindow)),
        (fx.dotted_a.clone(), Some(InUseReason::OpenInWindow)),
        (fx.canon_a.clone(), Some(InUseReason::OpenInWindow)),
        (fx.b.clone(), None),
    ];
    #[cfg(target_os = "macos")]
    rows.push((fx.private_a.clone(), Some(InUseReason::OpenInWindow)));
    for (path, expected) in rows {
        assert_eq!(in_use("d", Some(&path), None, &c), expected, "path {path}");
    }
}

#[test]
fn o9_uncanonicalizable_paths_fall_back_to_raw_comparison() {
    let fx = Fixture::new();
    let m = fx.missing("gone.md");
    let store = store_of(vec![win("A", vec![doc("x", Some(&m), false)], true, 1)]);
    let c = ctx(S, &["A"], &store);
    let rows = [
        (m.clone(), Some(InUseReason::OpenInWindow)),
        (fx.missing("other.md"), None),
        (format!("{}/./gone.md", fx.dir_str()), None),
    ];
    for (path, expected) in rows {
        assert_eq!(in_use("d", Some(&path), None, &c), expected, "path {path}");
    }
}

#[test]
fn o10_only_live_windows_count_and_routability_does_not_filter() {
    let d = || vec![doc("d", Some("/tmp/d.md"), false)];
    let dead = store_of(vec![win("Z", d(), true, 1)]);
    let unroutable = store_of(vec![win("A", d(), false, 1)]);
    let dead_plus_empty_live = store_of(vec![win("Z", d(), true, 1), win("A", vec![], true, 2)]);
    let path = Some("/tmp/d.md");
    assert_eq!(in_use("d", path, None, &ctx(S, &["A"], &dead)), None, "(i)");
    assert_eq!(
        in_use("d", path, None, &ctx(S, &["A"], &unroutable)),
        Some(InUseReason::OpenInWindow),
        "(ii)"
    );
    assert_eq!(
        in_use("d", path, None, &ctx(S, &["A"], &dead_plus_empty_live)),
        None,
        "(iii)"
    );
}

#[test]
fn o11_untitled_draft_never_matches_untitled_open_docs() {
    let store = store_of(vec![win(
        "A",
        vec![doc("u2", None, true), doc("f", Some("/tmp/f.md"), false)],
        true,
        1,
    )]);
    assert_eq!(in_use("u1", None, None, &ctx(S, &["A"], &store)), None);
}

#[test]
fn o12_live_owner_takes_precedence_over_open() {
    let store = store_of(vec![win("A", vec![doc("d", None, false)], true, 1)]);
    let o = owner(S, "A");
    let got = in_use("d", None, Some(&o), &ctx(S, &["A"], &store));
    assert_eq!(got, Some(InUseReason::OwnedByLiveWindow));
}

/// One row of the o13/o14 domain: (owner, id placement, path placement, draft path).
type Row = (
    Option<DraftOwner>,
    Option<&'static str>,
    Option<&'static str>,
    Option<&'static str>,
);

fn domain() -> Vec<Row> {
    let owners = [
        None,
        Some(owner(S, "A")),
        Some(owner(S, "Z")),
        Some(owner(P, "A")),
    ];
    let places = [None, Some("A"), Some("Z")];
    let mut rows = Vec::new();
    for o in &owners {
        for id_in in places {
            for path_in in places {
                for draft_path in [None, Some("/tmp/p.md")] {
                    rows.push((o.clone(), id_in, path_in, draft_path));
                }
            }
        }
    }
    rows
}

/// Windows A and Z always exist; the draft's id and/or path sit where the row says.
fn store_for(id_in: Option<&str>, path_in: Option<&str>) -> ShadowStore {
    let docs_for = |label: &str| {
        let mut docs = vec![doc("other", Some("/tmp/other.md"), false)];
        if id_in == Some(label) {
            docs.push(doc("dr", None, false));
        }
        if path_in == Some(label) {
            docs.push(doc("same-path", Some("/tmp/p.md"), false));
        }
        docs
    };
    store_of(vec![
        win("A", docs_for("A"), true, 1),
        win("Z", docs_for("Z"), true, 2),
    ])
}

#[test]
fn o13_in_use_matches_the_characterisation_oracle() {
    let rows = domain();
    assert_eq!(rows.len(), 72);
    for (o, id_in, path_in, draft_path) in rows {
        let c = ctx(S, &["A"], &store_for(id_in, path_in));
        let got = in_use("dr", draft_path, o.as_ref(), &c);
        let owned = o == Some(owner(S, "A"));
        let expected =
            owned || id_in == Some("A") || (draft_path.is_some() && path_in == Some("A"));
        let row = format!("owner={o:?} id_in={id_in:?} path_in={path_in:?} path={draft_path:?}");
        assert_eq!(got.is_some(), expected, "is_some, row {row}");
        assert_eq!(
            got == Some(InUseReason::OwnedByLiveWindow),
            owned,
            "reason, row {row}"
        );
    }
}

#[test]
fn o14_monotone_in_live_labels_and_nothing_in_use_with_no_live_window() {
    for (o, id_in, path_in, draft_path) in domain() {
        let store = store_for(id_in, path_in);
        let at = |live: &[&str]| in_use("dr", draft_path, o.as_ref(), &ctx(S, live, &store));
        let row = format!("owner={o:?} id_in={id_in:?} path_in={path_in:?} path={draft_path:?}");
        assert_eq!(at(&[]), None, "no live window, row {row}");
        if at(&["A"]).is_some() {
            assert!(
                at(&["A", "Z"]).is_some(),
                "growing live_labels lost in-use, row {row}"
            );
        }
    }
}

fn payload(label: &str, docs: Vec<DocumentState>) -> SyncDocumentsPayload {
    SyncDocumentsPayload {
        window_label: label.to_string(),
        active_document_id: None,
        documents: docs,
        routable: true,
    }
}

fn ctx_of(open: OpenSet) -> LiveContext {
    LiveContext {
        session_id: S.to_string(),
        live_labels: ["A".to_string()].into_iter().collect(),
        open: Ok(open),
    }
}

#[test]
fn o15_open_set_snapshots_the_shared_store_and_detaches() {
    let s = create_shadow_store();
    sync_documents(&s, payload("A", vec![doc("d1", Some("/tmp/d1.md"), false)])).unwrap();
    sync_documents(&s, payload("Z", vec![doc("d2", Some("/tmp/d2.md"), false)])).unwrap();
    let open1 = {
        let guard = s.lock().unwrap();
        OpenSet::from_store(&guard)
    };
    sync_documents(&s, payload("A", vec![])).unwrap();
    let open2 = OpenSet::from_store(&s.lock().unwrap());

    let c1 = ctx_of(open1);
    assert_eq!(
        in_use("d1", Some("/tmp/d1.md"), None, &c1),
        Some(InUseReason::OpenInWindow)
    );
    assert_eq!(
        in_use("d2", Some("/tmp/d2.md"), None, &c1),
        None,
        "Z is not live"
    );
    assert_eq!(in_use("d1", Some("/tmp/d1.md"), None, &ctx_of(open2)), None);
    assert_eq!(
        in_use("d1", Some("/tmp/d1.md"), None, &c1),
        Some(InUseReason::OpenInWindow),
        "the first snapshot is detached from later syncs"
    );
}

#[test]
fn o16_session_id_is_one_uuid_v4_per_process() {
    let a = session_id();
    let b = session_id();
    assert!(std::ptr::eq(a, b), "same &'static str on repeat calls");
    let threads: Vec<_> = (0..8).map(|_| std::thread::spawn(session_id)).collect();
    for t in threads {
        assert_eq!(t.join().unwrap(), a);
    }
    let parsed = uuid::Uuid::parse_str(a).unwrap_or_else(|e| panic!("{a:?} is not a uuid: {e}"));
    assert_eq!(parsed.get_version_num(), 4);
}
