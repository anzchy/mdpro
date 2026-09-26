//! D27 WI-2 g23-g25: `cleanup_old_drafts_for` — skips drafts in use,
//! conserves files, is idempotent, and deletes nothing when the shadow store
//! is unavailable.
use super::super::draft_fixture::{doc, store_of, win};
use super::super::draft_test_home::{ago, bundle_json, ctx, ctx_unavailable, TempHome};
use super::*;
use crate::models::ShadowStore;
use std::collections::BTreeSet;

const S: &str = "sess-current";
const P: &str = "previous-run";
const G23_IDS: [&str; 6] = ["s_dead", "s_live", "s_open", "f_dead", "f_live", "s_unrec"];
const G23_OPEN: &str = "/tmp/mdpro-g23/s_open.md";

fn populate_g23(home: &TempHome) -> ShadowStore {
    let (old, fresh) = (ago(8), ago(1));
    home.write_raw(
        "s_dead",
        &bundle_json("x", None, &old, true, Some((P, "main"))),
    );
    home.write_raw(
        "s_live",
        &bundle_json("x", None, &old, true, Some((S, "A"))),
    );
    home.write_raw(
        "s_open",
        &bundle_json("x", Some(G23_OPEN), &old, true, None),
    );
    home.write_raw(
        "f_dead",
        &bundle_json("x", None, &fresh, true, Some((P, "main"))),
    );
    home.write_raw(
        "f_live",
        &bundle_json("x", None, &fresh, true, Some((S, "A"))),
    );
    home.write_raw("s_unrec", &bundle_json("x", None, &old, false, None));
    store_of(vec![win(
        "A",
        vec![doc("o", Some(G23_OPEN), true)],
        true,
        1,
    )])
}

#[test]
fn g23_cleanup_scenario_from_the_acceptance_criteria() {
    let home = TempHome::new("cleanup_g23");
    let store = populate_g23(&home);
    let before: Vec<_> = G23_IDS.iter().map(|id| home.read_raw(id)).collect();

    let got = cleanup_old_drafts_for(&ctx(S, &["A"], &store)).expect("cleanup");

    assert_eq!(
        got,
        CleanupCounts {
            deleted: 1,
            skipped_live: 2
        }
    );
    assert!(!home.exists("s_dead"));
    for (id, bytes) in G23_IDS.iter().zip(before).skip(1) {
        assert_eq!(&home.read_raw(id), &bytes, "{id} changed");
    }
}

#[test]
fn g24_cleanup_conservation_and_idempotence() {
    let home = TempHome::new("cleanup_g24");
    let owners = [None, Some((P, "A")), Some((S, "A"))];
    let mut open_docs = vec![];
    let mut oracle = BTreeSet::new();
    let mut n = 0;
    for days in [8, 1] {
        let t = ago(days);
        for recovered in [false, true] {
            for owner in owners {
                for open in [false, true] {
                    let id = format!("c{n:02}");
                    n += 1;
                    let path = format!("/tmp/mdpro-g24/{id}.md");
                    home.write_raw(&id, &bundle_json("x", Some(&path), &t, recovered, owner));
                    if open {
                        open_docs.push(doc(&format!("o{id}"), Some(&path), true));
                    }
                    if days == 8 && recovered && owner != Some((S, "A")) && !open {
                        oracle.insert(id);
                    }
                }
            }
        }
    }
    home.write_raw("k0", "{not json");
    home.write_raw("k1", "{not json");
    home.write_legacy("L0", "legacy", None, &ago(8), true);
    home.write_legacy("L1", "legacy", None, &ago(8), true);
    let store = store_of(vec![win("A", open_docs, true, 1)]);
    let c = ctx(S, &["A"], &store);
    let before = home.snapshot();
    let bundles = |snap: &std::collections::BTreeMap<String, Vec<u8>>| {
        snap.keys().filter(|k| k.ends_with(".draft.json")).count()
    };

    let got = cleanup_old_drafts_for(&c).expect("cleanup");
    let after = home.snapshot();

    let gone: BTreeSet<String> = before
        .keys()
        .filter(|k| !after.contains_key(*k))
        .map(|k| k.trim_end_matches(".draft.json").to_string())
        .collect();
    assert_eq!(gone, oracle, "(1)");
    assert_eq!(bundles(&before) - bundles(&after), got.deleted, "(2)");
    assert_eq!(got.deleted + got.skipped_live, 6, "(3)");
    for (name, bytes) in &after {
        assert_eq!(Some(bytes), before.get(name), "(4) {name} changed");
    }
    let again = cleanup_old_drafts_for(&c).expect("cleanup again");
    assert_eq!(
        again,
        CleanupCounts {
            deleted: 0,
            skipped_live: got.skipped_live
        },
        "(5)"
    );
    assert_eq!(home.snapshot(), after, "(5) second run changed files");
}

#[test]
fn g25_cleanup_deletes_nothing_when_the_shadow_store_is_unavailable() {
    let home = TempHome::new("cleanup_g25");
    let _ = populate_g23(&home);
    let before: Vec<_> = G23_IDS.iter().map(|id| home.read_raw(id)).collect();

    let got = cleanup_old_drafts_for(&ctx_unavailable(S, &["A"])).expect("cleanup Ok");

    assert_eq!(
        got,
        CleanupCounts {
            deleted: 0,
            skipped_live: 3
        }
    );
    for (id, bytes) in G23_IDS.iter().zip(before) {
        assert!(home.exists(id), "{id} deleted");
        assert_eq!(home.read_raw(id), bytes, "{id} changed");
    }
}
