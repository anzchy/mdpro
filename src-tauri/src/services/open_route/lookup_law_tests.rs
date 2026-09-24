//! Law tests for `open_route::lookup` (D29 WI-2): order independence (a),
//! monotonicity (b) and alias invariance (c), each checked exhaustively over
//! a fixed 4-window domain. Real files and a real symlink; no mocks.
use super::lookup;
use super::lookup_fixture::{doc, live, store_of, win, Fixture};
use crate::models::mcp::WindowState;
use crate::services::open_route::{RouteLookup, RouteTarget};
use std::collections::HashSet;

const NAMES: [&str; 4] = ["dn", "do", "cn", "co"];

/// Literal expectation for every non-empty subset: (members, winner).
/// Dirty beats clean, then newer focus beats older.
const TABLE: [(&[&str], &str); 15] = [
    (&["dn"], "dn"),
    (&["do"], "do"),
    (&["cn"], "cn"),
    (&["co"], "co"),
    (&["dn", "do"], "dn"),
    (&["dn", "cn"], "dn"),
    (&["dn", "co"], "dn"),
    (&["do", "cn"], "do"),
    (&["do", "co"], "do"),
    (&["cn", "co"], "cn"),
    (&["dn", "do", "cn"], "dn"),
    (&["dn", "do", "co"], "dn"),
    (&["dn", "cn", "co"], "dn"),
    (&["do", "cn", "co"], "do"),
    (&["dn", "do", "cn", "co"], "dn"),
];

/// (label, document id, stored path, dirty, focus) for a domain member.
fn member(f: &Fixture, name: &str) -> (String, String, String, bool, i64) {
    let (path, dirty, focus) = match name {
        "dn" => (f.a.clone(), true, 300),
        "do" => (f.alias.clone(), true, 100),
        "cn" => (f.canon_a.clone(), false, 300),
        "co" => (f.a.clone(), false, 100),
        other => panic!("unknown domain member {other}"),
    };
    (
        format!("mdpro-{name}"),
        format!("d-{name}"),
        path,
        dirty,
        focus,
    )
}

fn window_of(f: &Fixture, name: &str) -> WindowState {
    let (label, id, path, dirty, focus) = member(f, name);
    win(&label, vec![doc(&id, Some(&path), dirty)], true, focus)
}

fn expected(f: &Fixture, winner: &str, count: usize) -> RouteLookup {
    let (label, id, path, _, _) = member(f, winner);
    RouteLookup {
        target: Some(RouteTarget {
            window_label: label,
            document_id: id,
            path,
        }),
        match_count: count,
    }
}

fn domain_live() -> HashSet<String> {
    live(&["mdpro-dn", "mdpro-do", "mdpro-cn", "mdpro-co"])
}

fn permutations(items: &[&'static str]) -> Vec<Vec<&'static str>> {
    if items.len() <= 1 {
        return vec![items.to_vec()];
    }
    let mut out = Vec::new();
    for i in 0..items.len() {
        let mut rest = items.to_vec();
        let head = rest.remove(i);
        for mut tail in permutations(&rest) {
            tail.insert(0, head);
            out.push(tail);
        }
    }
    out
}

#[test]
fn table_covers_every_non_empty_subset() {
    let mut seen: HashSet<Vec<&str>> = HashSet::new();
    for (members, _) in TABLE {
        assert!(members.iter().all(|m| NAMES.contains(m)));
        assert!(seen.insert(members.to_vec()), "duplicate row {members:?}");
    }
    assert_eq!(seen.len(), 15);
}

#[test]
fn choice_is_order_independent_exhaustive() {
    let f = Fixture::new();
    let labels = domain_live();
    let mut orderings = 0;
    for (members, winner) in TABLE {
        let want = expected(&f, winner, members.len());
        for order in permutations(members) {
            orderings += 1;
            let store = store_of(order.iter().map(|n| window_of(&f, n)).collect());
            assert_eq!(
                lookup(&store, &f.a, &labels),
                want,
                "subset={members:?} order={order:?}"
            );
        }
    }
    assert_eq!(orderings, 64);

    // Tie on dirtiness and focus: the smallest label wins, in either order.
    let tie_b = || win("mdpro-b", vec![doc("t-b", Some(&f.a), true)], true, 200);
    let tie_a = || win("mdpro-a", vec![doc("t-a", Some(&f.alias), true)], true, 200);
    let tie_want = RouteLookup {
        target: Some(RouteTarget {
            window_label: "mdpro-a".to_string(),
            document_id: "t-a".to_string(),
            path: f.alias.clone(),
        }),
        match_count: 2,
    };
    let tie_labels = live(&["mdpro-a", "mdpro-b"]);
    for store in [
        store_of(vec![tie_b(), tie_a()]),
        store_of(vec![tie_a(), tie_b()]),
    ] {
        assert_eq!(lookup(&store, &f.a, &tie_labels), tie_want);
    }
}

#[test]
fn adding_ineligible_or_unrelated_window_never_changes_result() {
    let f = Fixture::new();
    for (members, _) in TABLE {
        let base: Vec<WindowState> = members.iter().map(|n| window_of(&f, n)).collect();
        let mut base_live = domain_live();
        let before = lookup(&store_of(base.clone()), &f.a, &base_live);

        let extras = [
            // (i) not routable, but live.
            (
                "i",
                win("mdpro-0i", vec![doc("z-i", Some(&f.a), true)], false, 999),
                true,
            ),
            // (ii) routable, but its label is not live.
            (
                "ii",
                win("mdpro-0ii", vec![doc("z-ii", Some(&f.a), true)], true, 999),
                false,
            ),
            // (iii) routable and live, but holds a different file.
            (
                "iii",
                win(
                    "mdpro-0iii",
                    vec![doc("z-iii", Some(&f.b), true)],
                    true,
                    999,
                ),
                true,
            ),
        ];
        for (row, extra, is_live) in extras {
            let mut labels = base_live.clone();
            if is_live {
                labels.insert(extra.label.clone());
            }
            let mut windows = base.clone();
            windows.push(extra);
            assert_eq!(
                lookup(&store_of(windows), &f.a, &labels),
                before,
                "row ({row}) subset={members:?}"
            );
        }

        // (iv) an older window holding a.md clean and b.md dirty: a real
        // clean match, which must never be ranked as dirty.
        let x = win(
            "mdpro-x",
            vec![doc("x-a", Some(&f.a), false), doc("x-b", Some(&f.b), true)],
            true,
            50,
        );
        base_live.insert("mdpro-x".to_string());
        let mut windows = base.clone();
        windows.push(x);
        let after = lookup(&store_of(windows), &f.a, &base_live);
        assert_eq!(after.target, before.target, "row (iv) subset={members:?}");
        assert_eq!(
            after.match_count,
            before.match_count + 1,
            "row (iv) subset={members:?}"
        );
    }
}

#[test]
fn result_is_alias_invariant() {
    let f = Fixture::new();
    let labels = domain_live();
    for (members, winner) in TABLE {
        let store = store_of(members.iter().map(|n| window_of(&f, n)).collect());
        let raw = lookup(&store, &f.a, &labels);
        assert_eq!(
            raw,
            expected(&f, winner, members.len()),
            "subset={members:?}"
        );
        for incoming in [&f.alias, &f.canon_a] {
            assert_eq!(
                lookup(&store, incoming, &labels),
                raw,
                "subset={members:?} incoming={incoming}"
            );
        }
    }
}
