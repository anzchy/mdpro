//! Example-based tests for `open_route::lookup` and `lookup_in_shared`
//! (D29 WI-2). Real files and a real symlink; no mocks.
use super::lookup_fixture::{doc, live, store_of, win, Fixture};
use super::{lookup, lookup_in_shared};
use crate::services::open_route::{RouteLookup, RouteTarget};
use std::sync::{Arc, Mutex};

fn hit(label: &str, id: &str, path: &str, count: usize) -> RouteLookup {
    RouteLookup {
        target: Some(RouteTarget {
            window_label: label.to_string(),
            document_id: id.to_string(),
            path: path.to_string(),
        }),
        match_count: count,
    }
}

fn miss() -> RouteLookup {
    RouteLookup {
        target: None,
        match_count: 0,
    }
}

#[test]
fn exact_match_returns_stored_triple_not_active_doc() {
    let f = Fixture::new();
    let store = store_of(vec![win(
        "mdpro-a",
        vec![doc("x", Some(&f.b), false), doc("id-a", Some(&f.a), false)],
        true,
        1,
    )]);
    let got = lookup(&store, &f.a, &live(&["mdpro-a"]));
    assert_eq!(got, hit("mdpro-a", "id-a", &f.a, 1));
}

#[test]
fn alias_paths_return_stored_path_both_directions() {
    let f = Fixture::new();
    #[allow(unused_mut)]
    let mut pairs = vec![
        (f.a.clone(), f.alias.clone()),
        (f.a.clone(), f.dotted_a.clone()),
        (f.canon_a.clone(), f.a.clone()),
        (f.alias.clone(), f.a.clone()),
    ];
    #[cfg(target_os = "macos")]
    pairs.push((f.a.clone(), f.private_a.clone()));
    for (stored, incoming) in pairs {
        assert_ne!(stored, incoming, "fixture pair must differ");
        let store = store_of(vec![win(
            "mdpro-a",
            vec![doc("id-a", Some(&stored), false)],
            true,
            1,
        )]);
        let got = lookup(&store, &incoming, &live(&["mdpro-a"]));
        assert_eq!(
            got,
            hit("mdpro-a", "id-a", &stored, 1),
            "stored={stored} incoming={incoming}"
        );
    }
}

#[test]
fn missing_file_falls_back_to_raw_string() {
    let f = Fixture::new();
    let gone = f.missing("gone.md");
    let one = |stored: &str, incoming: &str| {
        let store = store_of(vec![win(
            "mdpro-a",
            vec![doc("id-g", Some(stored), false)],
            true,
            1,
        )]);
        lookup(&store, incoming, &live(&["mdpro-a"]))
    };
    // (i) identical raw string matches.
    assert_eq!(one(&gone, &gone), hit("mdpro-a", "id-g", &gone, 1));
    // (ii) a different missing file does not.
    assert_eq!(one(&gone, &f.missing("gone2.md")), miss());
    // (iii) raw comparison does not normalize `/./`.
    let dotted = format!("{}/./gone.md", f.dir_str());
    assert_eq!(one(&gone, &dotted), miss());
    // (iv) only the incoming side fails to canonicalize.
    assert_eq!(one(&f.a, &gone), miss());
}

#[test]
fn ineligible_windows_excluded_from_target_and_count() {
    let f = Fixture::new();
    let store = store_of(vec![
        win("mdpro-a", vec![doc("id-a", Some(&f.a), false)], true, 1),
        win("mdpro-b", vec![doc("id-b", Some(&f.a), true)], true, 99),
        win("mdpro-c", vec![doc("id-c", Some(&f.a), true)], false, 99),
        win("mdpro-d", vec![doc("id-d", Some(&f.a), true)], false, 99),
    ]);
    let got = lookup(&store, &f.a, &live(&["mdpro-a", "mdpro-c"]));
    assert_eq!(got, hit("mdpro-a", "id-a", &f.a, 1));
}

#[test]
fn no_candidates_returns_none_zero() {
    let f = Fixture::new();
    let labels = live(&["mdpro-a"]);
    // (i) empty store.
    assert_eq!(lookup(&store_of(vec![]), &f.a, &labels), miss());
    // (ii) only untitled documents.
    let untitled = store_of(vec![win(
        "mdpro-a",
        vec![doc("u1", None, true), doc("u2", None, false)],
        true,
        1,
    )]);
    assert_eq!(lookup(&untitled, &f.a, &labels), miss());
    // (iii) an empty incoming path does not match `None`.
    assert_eq!(lookup(&untitled, "", &labels), miss());
}

#[test]
fn two_docs_same_file_in_one_window_counts_one_window_prefers_dirty() {
    let f = Fixture::new();
    let store = store_of(vec![win(
        "mdpro-a",
        vec![
            doc("c1", Some(&f.a), false),
            doc("d1", Some(&f.alias), true),
        ],
        true,
        1,
    )]);
    let got = lookup(&store, &f.a, &live(&["mdpro-a"]));
    assert_eq!(got, hit("mdpro-a", "d1", &f.alias, 1));
}

#[test]
fn dirtiness_is_the_matched_documents_not_the_windows() {
    let f = Fixture::new();
    let labels = live(&["mdpro-x", "mdpro-y"]);
    let build = |x_focus: i64, y_focus: i64| {
        store_of(vec![
            win(
                "mdpro-x",
                vec![doc("xa", Some(&f.a), false), doc("xb", Some(&f.b), true)],
                true,
                x_focus,
            ),
            win("mdpro-y", vec![doc("ya", Some(&f.a), false)], true, y_focus),
        ])
    };
    // Row 1: X is dirty elsewhere but older, so the newer Y wins.
    assert_eq!(
        lookup(&build(100, 300), &f.a, &labels),
        hit("mdpro-y", "ya", &f.a, 2)
    );
    // Row 2: X is newer and wins with its matched (clean) document.
    assert_eq!(
        lookup(&build(300, 100), &f.a, &labels),
        hit("mdpro-x", "xa", &f.a, 2)
    );
}

#[test]
fn lookup_in_shared_poisoned_lock_is_err_else_passthrough() {
    let f = Fixture::new();
    let labels = live(&["mdpro-a"]);
    let make = || {
        Arc::new(Mutex::new(store_of(vec![win(
            "mdpro-a",
            vec![doc("id-a", Some(&f.a), false)],
            true,
            1,
        )])))
    };

    // (i) poisoned by a thread that panics while holding the lock.
    let poisoned = make();
    let held = Arc::clone(&poisoned);
    let joined = std::thread::spawn(move || {
        let _guard = held.lock().unwrap();
        panic!("poison the shadow store lock");
    })
    .join();
    assert!(joined.is_err(), "the poisoning thread must have panicked");
    assert!(poisoned.is_poisoned());
    assert!(lookup_in_shared(&poisoned, &f.a, &labels).is_err());

    // (ii) unpoisoned: the same answer as the pure lookup.
    let healthy = make();
    let direct = lookup(&healthy.lock().unwrap(), &f.a, &labels);
    let shared = lookup_in_shared(&healthy, &f.a, &labels).expect("unpoisoned lock is Ok");
    assert_eq!(shared, direct);
    assert_eq!(shared, hit("mdpro-a", "id-a", &f.a, 1));
}
