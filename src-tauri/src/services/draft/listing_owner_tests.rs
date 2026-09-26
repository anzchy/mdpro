//! D27 WI-2 g20-g22, g27: `list_drafts_for` — scenarios, conservation against
//! an oracle written from ADR-0038 §3, read-only, monotone in live labels, and
//! the unavailable-store branch (lists as if nothing were open).
use super::super::draft_fixture::{doc, store_of, win};
use super::super::draft_test_home::{ago, bundle_json, ctx, ctx_unavailable, TempHome};
use super::*;
use crate::models::{DocumentState, ShadowStore};
use std::collections::{BTreeSet, HashMap};

const S: &str = "sess-current";
const P: &str = "previous-run";

fn ids(listing: &DraftListing) -> BTreeSet<String> {
    listing.entries.iter().map(|e| e.id.clone()).collect()
}

#[test]
fn g20_listing_scenarios_plus_legacy() {
    let home = TempHome::new("listing_g20");
    let t = ago(1);
    home.write_raw("i", &bundle_json("i", None, &t, false, Some((P, "main"))));
    home.write_raw("ii", &bundle_json("ii", None, &t, true, Some((P, "main"))));
    home.write_raw("iii", &bundle_json("iii", None, &t, true, None));
    home.write_raw("iv", &bundle_json("iv", None, &t, false, Some((S, "A"))));
    home.write_raw("v", "{not json");
    home.write_raw("vi", &bundle_json("vi", None, &t, false, None));
    home.write_legacy("Lr", "lr", None, &t, true);
    home.write_legacy("Ln", "ln", None, &t, false);
    let before = home.snapshot();
    let store = store_of(vec![win("A", vec![doc("vi", None, true)], true, 1)]);

    let got = list_drafts_for(&ctx(S, &["A"], &store)).expect("list");

    let want: BTreeSet<String> = ["i", "ii", "v", "Ln"].map(String::from).into();
    assert_eq!(ids(&got), want);
    let v = got.entries.iter().find(|e| e.id == "v").unwrap();
    assert_eq!(v.title, "(corrupted)");
    assert_eq!(
        got.counts,
        DraftListCounts {
            listed: 4,
            hidden_in_use: 2,
            hidden_recovered: 2,
            relisted: 1
        }
    );
    assert_eq!(home.snapshot(), before);
}

/// Oracle for one id: (listed, relisted), straight from ADR-0038 §3.
type Oracle = HashMap<String, (bool, bool)>;

/// The g21 population; returns the store and the oracle for live = {A}.
fn populate(home: &TempHome) -> (ShadowStore, Oracle) {
    let t = ago(1);
    let owners = [None, Some((P, "A")), Some((S, "A")), Some((S, "Z"))];
    let (mut in_a, mut in_z): (Vec<DocumentState>, Vec<DocumentState>) = (vec![], vec![]);
    let mut oracle = Oracle::new();
    let mut n = 0;
    for recovered in [false, true] {
        for owner in owners {
            for open in 0..4 {
                let id = format!("b{n:02}");
                n += 1;
                let path = format!("/tmp/mdpro-g21/{id}.md");
                home.write_raw(&id, &bundle_json(&id, Some(&path), &t, recovered, owner));
                match open {
                    1 => in_a.push(doc(&id, None, true)),
                    2 => in_a.push(doc(&format!("o{id}"), Some(&path), true)),
                    3 => in_z.push(doc(&id, None, true)),
                    _ => {}
                }
                let owner_live = owner == Some((S, "A"));
                let open_live = open == 1 || open == 2;
                let listed = !owner_live && !open_live && (!recovered || owner.is_some());
                oracle.insert(id, (listed, listed && recovered));
            }
        }
    }
    for k in 0..2 {
        home.write_raw(&format!("c{k}"), "{not json");
        oracle.insert(format!("c{k}"), (true, false));
    }
    for (k, (recovered, open)) in [(false, false), (false, true), (true, false), (true, true)]
        .into_iter()
        .enumerate()
    {
        let id = format!("L{k}");
        let path = format!("/tmp/mdpro-g21/{id}.md");
        home.write_legacy(&id, "legacy", Some(&path), &t, recovered);
        if open {
            in_a.push(doc(&format!("o{id}"), Some(&path), true));
        }
        oracle.insert(id, (!open && !recovered, false));
    }
    home.write_legacy("b00", "legacy twin", None, &t, false);
    let dir = home.drafts_dir();
    std::fs::write(dir.join("notes.txt"), "stray").unwrap();
    std::fs::write(dir.join("x.123.tmp"), "stray").unwrap();
    let store = store_of(vec![win("A", in_a, true, 1), win("Z", in_z, true, 2)]);
    (store, oracle)
}

#[test]
fn g21_listing_conservation_oracle_and_read_only() {
    let home = TempHome::new("listing_g21");
    let (store, oracle) = populate(&home);
    let before = home.snapshot();
    let c = ctx(S, &["A"], &store);

    let got = list_drafts_for(&c).expect("list");

    let want: BTreeSet<String> = oracle
        .iter()
        .filter(|(_, (listed, _))| *listed)
        .map(|(id, _)| id.clone())
        .collect();
    assert_eq!(ids(&got), want, "(1)");
    assert_eq!(got.entries.len(), want.len(), "each id listed once");
    let k = got.counts;
    assert_eq!(k.listed + k.hidden_in_use + k.hidden_recovered, 38, "(2)");
    assert_eq!(k.listed, want.len());
    let relisted = oracle.values().filter(|(_, r)| *r).count();
    assert_eq!(k.relisted, relisted, "(3)");
    assert_eq!(home.snapshot(), before, "(4) listing changed the disk");
    assert_eq!(list_drafts_for(&c).expect("list again"), got, "(5)");
}

#[test]
fn g22_listing_is_monotone_in_live_labels() {
    let home = TempHome::new("listing_g22");
    let (store, _) = populate(&home);
    let none = list_drafts_for(&ctx(S, &[], &store)).unwrap();
    let a = list_drafts_for(&ctx(S, &["A"], &store)).unwrap();
    let az = list_drafts_for(&ctx(S, &["A", "Z"], &store)).unwrap();
    assert!(ids(&none).is_superset(&ids(&a)));
    assert!(ids(&a).is_superset(&ids(&az)));
    assert!(none.counts.hidden_in_use <= a.counts.hidden_in_use);
    assert!(a.counts.hidden_in_use <= az.counts.hidden_in_use);
}

#[test]
fn g27_unavailable_store_lists_as_if_nothing_were_open() {
    let home = TempHome::new("listing_g27");
    let (store, _) = populate(&home);
    let before = home.snapshot();

    let a = list_drafts_for(&ctx_unavailable(S, &["A"])).expect("unavailable lists Ok");
    let b = list_drafts_for(&ctx(S, &["A"], &ShadowStore::default())).expect("list");
    assert_eq!(a.entries, b.entries);
    assert_eq!(a.counts, b.counts);
    assert!(a.counts.listed > 0);
    assert!(a.counts.hidden_in_use > 0, "live owners are still hidden");
    let with_store = list_drafts_for(&ctx(S, &["A"], &store)).unwrap();
    assert!(
        !ids(&a).is_subset(&ids(&with_store)),
        "the Err branch must really drop the open set"
    );
    assert_eq!(home.snapshot(), before);
}
