//! WI-1 (D24 follow-up) — `find_stored_geometry`, the alias-tolerant lookup
//! of a file's stored window geometry.
//!
//! Cases r1-r9 of `.claude/tdd-guardian/tests-20260926-062337.md`.
//!
//! **Law (alias invariance):** for every spelling `p'` naming the same existing
//! file as `p`, `find(states, p') == find(states, p)`.
//! **Law (closure):** the result is `None` or a value present in `states`,
//! stored under a key that names the same file as the query.
//! Among several alias keys the choice is a total order — largest
//! `last_accessed`, then smallest key — so it never depends on `HashMap` order.
//!
//! Nothing is mocked: real files, real symlinks and real `canonicalize`, via
//! the `open_route/lookup_fixture.rs` fixture re-included as `restore_fixture`.
//! Every entry carries a distinct `x`, which tags the key that won.

use super::restore_fixture::Fixture;
use super::*;
use std::collections::HashMap;

fn geo(x: i32, la: i64) -> WindowGeometry {
    WindowGeometry {
        x,
        y: 0,
        width: 1000,
        height: 700,
        last_accessed: la,
    }
}

fn map(entries: &[(&str, WindowGeometry)]) -> HashMap<String, WindowGeometry> {
    let mut m = HashMap::new();
    for (k, g) in entries {
        m.insert(k.to_string(), g.clone());
    }
    m
}

/// Every spelling of `a.md` the fixture offers.
fn spellings_of_a(fx: &Fixture) -> Vec<String> {
    #[allow(unused_mut)]
    let mut s = vec![
        fx.a.clone(),
        fx.alias.clone(),
        fx.canon_a.clone(),
        fx.dotted_a.clone(),
    ];
    #[cfg(target_os = "macos")]
    s.push(fx.private_a.clone());
    s
}

/// The test's own "same file" oracle, written independently of the unit:
/// canonical comparison, raw `==` when either side fails to canonicalize.
fn oracle_same_file(a: &str, b: &str) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

// r1 — exact raw key returns that entry.
#[test]
fn r1_exact_raw_key_returns_that_entry() {
    let fx = Fixture::new();
    let states = map(&[(&fx.b, geo(11, 5)), (&fx.canon_a, geo(22, 5))]);
    assert_eq!(
        find_stored_geometry(&states, &fx.b),
        Some(states[&fx.b].clone())
    );
}

// r2 — every spelling finds the entry saved under every other spelling.
#[test]
fn r2_every_spelling_finds_the_entry_saved_under_every_other() {
    let fx = Fixture::new();
    let spellings = spellings_of_a(&fx);
    for k in &spellings {
        let states = map(&[(k, geo(77, 9)), (&fx.b, geo(11, 9))]);
        let via_canon = find_stored_geometry(&states, &fx.canon_a);
        for q in &spellings {
            let got = find_stored_geometry(&states, q);
            assert_eq!(got.as_ref().map(|g| g.x), Some(77), "saved={k} opened={q}");
            assert_eq!(
                got, via_canon,
                "saved={k} opened={q}: find(alias) != find(canonical)"
            );
        }
        assert_eq!(
            find_stored_geometry(&states, &fx.b).map(|g| g.x),
            Some(11),
            "saved={k}: b.md must not be confused with a.md"
        );
    }
}

// r3 — an exact key loses to a newer alias key of the same file.
#[test]
fn r3_exact_key_loses_to_a_newer_alias_key() {
    let fx = Fixture::new();
    let states = map(&[(&fx.a, geo(1, 100)), (&fx.canon_a, geo(2, 200))]);
    assert_eq!(find_stored_geometry(&states, &fx.a).map(|g| g.x), Some(2));
}

// r4 — among three aliases the newest wins; it is neither lexicographic end.
#[test]
fn r4_newest_alias_wins_even_in_the_middle_of_key_order() {
    let fx = Fixture::new();
    let mut keys = [fx.a.clone(), fx.canon_a.clone(), fx.dotted_a.clone()];
    keys.sort();
    let states = map(&[
        (&keys[0], geo(0, 100)),
        (&keys[1], geo(1, 300)),
        (&keys[2], geo(2, 200)),
    ]);
    let result = find_stored_geometry(&states, &fx.alias).expect("an alias key must match");
    assert_eq!(result.x, 1);
    assert_eq!(result.last_accessed, 300);
}

// r5 — equal `last_accessed` breaks to the lexicographically smallest key.
#[test]
fn r5_equal_timestamps_break_to_the_smallest_key() {
    let fx = Fixture::new();
    let states = map(&[
        (&fx.a, geo(1, 500)),
        (&fx.canon_a, geo(2, 500)),
        (&fx.dotted_a, geo(3, 500)),
    ]);
    let expected_key = [fx.a.as_str(), fx.canon_a.as_str(), fx.dotted_a.as_str()]
        .into_iter()
        .min()
        .expect("three keys");
    assert_eq!(
        find_stored_geometry(&states, &fx.canon_a),
        Some(states[expected_key].clone())
    );
}

// r6 — missing file: the raw-equal key is found; a differently spelled key is not.
#[test]
fn r6_missing_file_matches_only_its_raw_spelling() {
    let fx = Fixture::new();
    let m = fx.missing("gone.md");
    let dotted_m = format!("{}/./gone.md", fx.dir_str());
    assert_ne!(m, dotted_m);

    let states = map(&[(&m, geo(1, 0))]);
    assert_eq!(find_stored_geometry(&states, &m).map(|g| g.x), Some(1));
    assert_eq!(find_stored_geometry(&states, &dotted_m), None);

    let states = map(&[(&dotted_m, geo(1, 0))]);
    assert_eq!(find_stored_geometry(&states, &m), None);
}

// r7 — no match → None: empty map, 100 unrelated keys, the other file, empty path.
#[test]
fn r7_no_match_is_none() {
    let fx = Fixture::new();
    assert_eq!(find_stored_geometry(&HashMap::new(), &fx.a), None);

    let mut unrelated = HashMap::new();
    for i in 0..100 {
        unrelated.insert(format!("/nonexistent-mdpro/seed-{i}.md"), geo(i, i as i64));
    }
    assert_eq!(find_stored_geometry(&unrelated, &fx.a), None);

    assert_eq!(
        find_stored_geometry(&map(&[(&fx.b, geo(4, 1))]), &fx.a),
        None
    );
    assert_eq!(find_stored_geometry(&map(&[(&fx.a, geo(1, 1))]), ""), None);
}

// r8 — result is independent of HashMap construction and insertion order.
#[test]
fn r8_result_is_independent_of_insertion_and_iteration_order() {
    let fx = Fixture::new();
    let entries: Vec<(String, WindowGeometry)> = vec![
        (fx.a.clone(), geo(1, 500)),
        (fx.canon_a.clone(), geo(2, 500)),
        (fx.dotted_a.clone(), geo(3, 400)),
        (fx.b.clone(), geo(4, 900)),
        ("/nonexistent-mdpro/z.md".to_string(), geo(5, 999)),
    ];
    let mut results = Vec::new();
    for rot in 0..entries.len() {
        let mut rotated = entries.clone();
        rotated.rotate_left(rot);
        for _ in 0..8 {
            let mut states = HashMap::new();
            for (k, g) in &rotated {
                states.insert(k.clone(), g.clone());
            }
            results.push(find_stored_geometry(&states, &fx.alias));
        }
    }
    assert_eq!(results.len(), 40);
    assert!(
        results.windows(2).all(|w| w[0] == w[1]),
        "results differ across orders: {results:?}"
    );
    let min_key = std::cmp::min(fx.a.clone(), fx.canon_a.clone());
    let expected = entries
        .iter()
        .find(|(k, _)| *k == min_key)
        .map(|(_, g)| g.clone());
    assert_eq!(results[0], expected);
}

// r9 — closure: the result is always one of the input values, under a same-file key.
#[test]
fn r9_result_is_an_input_value_under_a_same_file_key() {
    let fx = Fixture::new();
    let m = fx.missing("m.md");
    let pool = [
        fx.a.clone(),
        fx.canon_a.clone(),
        fx.dotted_a.clone(),
        fx.b.clone(),
        m.clone(),
    ];
    let queries = [
        fx.a.clone(),
        fx.alias.clone(),
        fx.canon_a.clone(),
        fx.b.clone(),
        m.clone(),
        fx.missing("never.md"),
    ];
    for mask in 1u32..(1 << pool.len()) {
        let mut states = HashMap::new();
        for (i, k) in pool.iter().enumerate() {
            if mask & (1 << i) != 0 {
                states.insert(k.clone(), geo(i as i32, i as i64 * 10));
            }
        }
        for q in &queries {
            let result = find_stored_geometry(&states, q);
            let any_match = states.keys().any(|k| oracle_same_file(k, q));
            assert_eq!(result.is_some(), any_match, "mask={mask:05b} q={q}");
            if let Some(r) = result {
                assert!(
                    states
                        .iter()
                        .any(|(k, g)| *g == r && oracle_same_file(k, q)),
                    "mask={mask:05b} q={q}: {r:?} is not an input value under a same-file key"
                );
            }
        }
    }
}
