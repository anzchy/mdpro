//! Unit tests for `menu_recent_merge::apply_recent_op` (D43, WI-2, MR-01..MR-13).
//! Generated cases use an inline seeded xorshift64 and tag every failure with
//! `seed=… case=… input=…` so it can be replayed.

use super::*;

#[path = "menu_recent_merge_contract_tests.rs"]
mod contract;

pub(super) const ALPHABET: &[&str] = &[
    "/a.md", "/b.md", "/c.md", "/d.md", "/e.md", "/f.md", "/g.md",
];

pub(super) fn rng(seed: u64) -> impl FnMut() -> u64 {
    let mut s = seed.max(1);
    move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    }
}

pub(super) fn below(r: &mut impl FnMut() -> u64, n: usize) -> usize {
    (r() % n as u64) as usize
}

pub(super) fn gen_list(r: &mut impl FnMut() -> u64, max_len: usize) -> Vec<String> {
    let len = below(r, max_len + 1);
    (0..len)
        .map(|_| ALPHABET[below(r, ALPHABET.len())].to_string())
        .collect()
}

pub(super) fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// `L(n) = ["/s/0.md", …, "/s/{n-1}.md"]`.
fn l(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("/s/{i}.md")).collect()
}

fn record(p: &str) -> RecentOp {
    RecentOp::Record {
        path: p.to_string(),
    }
}

fn seed(stored: Option<Vec<String>>, pending: Vec<String>) -> RecentOp {
    RecentOp::Seed {
        stored,
        pending_newest_first: pending,
    }
}

fn with_head(head: &str, tail: Vec<String>) -> Vec<String> {
    std::iter::once(head.to_string()).chain(tail).collect()
}

#[test]
fn mr_01_d43_failed_hydration_window_keeps_the_session_list() {
    let d43 = v(&[
        "/d.md", "/c.md", "/b.md", "/g1.md", "/f.md", "/e.md", "/a.md",
    ]);
    let s1 = apply_recent_op(&[], &seed(Some(d43.clone()), vec![]));
    assert_eq!(s1, d43);
    let second = apply_recent_op(&s1, &seed(None, v(&["/a.md"])));
    assert_eq!(
        second,
        v(&["/a.md", "/d.md", "/c.md", "/b.md", "/g1.md", "/f.md", "/e.md"])
    );
}

#[test]
fn mr_02_record_moves_the_path_to_the_front() {
    assert_eq!(
        apply_recent_op(&v(&["/b.md", "/c.md"]), &record("/a.md")),
        v(&["/a.md", "/b.md", "/c.md"])
    );
    assert_eq!(
        apply_recent_op(&v(&["/a.md", "/b.md", "/c.md"]), &record("/c.md")),
        v(&["/c.md", "/a.md", "/b.md"])
    );
}

#[test]
fn mr_03_record_cap_boundaries_9_10_11() {
    for n in [9, 10, 11] {
        let r = apply_recent_op(&l(n), &record("/n.md"));
        assert_eq!(r, with_head("/n.md", l(9)), "n={n}");
        assert_eq!(r.len(), 10, "n={n}");
    }
    let r = apply_recent_op(&l(10), &record("/s/9.md"));
    assert_eq!(r, with_head("/s/9.md", l(9)));
    assert_eq!(r.len(), 10);
}

#[test]
fn mr_04_record_empty_path_is_a_verbatim_noop_even_over_the_cap() {
    assert_eq!(apply_recent_op(&l(11), &record("")), l(11));
    assert_eq!(apply_recent_op(&[], &record("")), Vec::<String>::new());
}

#[test]
fn mr_05_record_removes_only_its_own_duplicates() {
    let current = v(&["/x.md", "/y.md", "/x.md"]);
    assert_eq!(
        apply_recent_op(&current, &record("/z.md")),
        v(&["/z.md", "/x.md", "/y.md", "/x.md"])
    );
    assert_eq!(
        apply_recent_op(&current, &record("/x.md")),
        v(&["/x.md", "/y.md"])
    );
}

#[test]
fn mr_06_property_record_head_bound_and_order_conservation() {
    let seed_v = 0xD43_0006;
    let mut r = rng(seed_v);
    for case in 0..1000 {
        let list = gen_list(&mut r, 13);
        let p = ALPHABET[below(&mut r, ALPHABET.len())];
        let tag = format!("seed={seed_v:#x} case={case} input=({list:?}, {p})");
        let out = apply_recent_op(&list, &record(p));
        assert_eq!(out.first().map(String::as_str), Some(p), "{tag}");
        assert!(out.len() <= MAX_RECENT_FILES, "{tag}");
        let rest: Vec<String> = list
            .iter()
            .filter(|x| x.as_str() != p)
            .take(9)
            .cloned()
            .collect();
        assert_eq!(out[1..].to_vec(), rest, "{tag}");
    }
}

#[test]
fn mr_07_property_record_is_idempotent() {
    let seed_v = 0xD43_0007;
    let mut r = rng(seed_v);
    for case in 0..1000 {
        let list = gen_list(&mut r, 13);
        let p = ALPHABET[below(&mut r, ALPHABET.len())];
        let once = apply_recent_op(&list, &record(p));
        let twice = apply_recent_op(&once, &record(p));
        assert_eq!(
            twice, once,
            "seed={seed_v:#x} case={case} input=({list:?}, {p})"
        );
    }
}

#[test]
fn mr_08_seed_onto_an_empty_session_caps_stored() {
    for (n, want) in [(0, 0), (1, 1), (10, 10), (11, 10)] {
        assert_eq!(
            apply_recent_op(&[], &seed(Some(l(n)), vec![])),
            l(want),
            "n={n}"
        );
    }
}

#[test]
fn mr_09_property_stored_none_equals_stored_empty() {
    let seed_v = 0xD43_0009;
    let mut r = rng(seed_v);
    for case in 0..500 {
        let current = gen_list(&mut r, 12);
        let pending = gen_list(&mut r, 4);
        let a = apply_recent_op(&current, &seed(None, pending.clone()));
        let b = apply_recent_op(&current, &seed(Some(vec![]), pending.clone()));
        assert_eq!(
            a, b,
            "seed={seed_v:#x} case={case} input=({current:?}, {pending:?})"
        );
    }
}

/// A wider alphabet than `ALPHABET`, so `current` can reach 10 distinct paths.
const WIDE: &[&str] = &[
    "/a.md", "/b.md", "/c.md", "/d.md", "/e.md", "/f.md", "/g.md", "/h.md", "/i.md", "/j.md",
    "/k.md", "/l.md",
];

#[test]
fn mr_10_property_seed_never_displaces_the_session_list() {
    let seed_v = 0xD43_0010;
    let mut r = rng(seed_v);
    for case in 0..1000 {
        let mut pool: Vec<&str> = WIDE.to_vec();
        let c_len = below(&mut r, 11);
        let current: Vec<String> = (0..c_len)
            .map(|_| pool.remove(below(&mut r, pool.len())).to_string())
            .collect();
        let s_len = below(&mut r, 13);
        let stored: Vec<String> = (0..s_len)
            .map(|_| WIDE[below(&mut r, WIDE.len())].to_string())
            .collect();
        let tag = format!("seed={seed_v:#x} case={case} input=({current:?}, {stored:?})");
        let out = apply_recent_op(&current, &seed(Some(stored.clone()), vec![]));
        let want: Vec<String> = current
            .iter()
            .cloned()
            .chain(stored.iter().filter(|x| !current.contains(x)).cloned())
            .take(MAX_RECENT_FILES)
            .collect();
        assert_eq!(out, want, "(a) {tag}");
        let k = current.len().min(MAX_RECENT_FILES);
        assert_eq!(out[..k].to_vec(), current[..k].to_vec(), "(b) {tag}");
        if stored.iter().all(|x| current.contains(x)) {
            assert_eq!(out, current, "(c) {tag}");
        }
    }
}

#[test]
fn mr_11_metamorphic_seed_with_pending_equals_records_replayed_oldest_first() {
    let seed_v = 0xD43_0011;
    let mut r = rng(seed_v);
    for case in 0..1000 {
        let current = gen_list(&mut r, 12);
        let stored = if below(&mut r, 2) == 0 {
            None
        } else {
            Some(gen_list(&mut r, 12))
        };
        let p_len = below(&mut r, 7);
        let pending: Vec<String> = (0..p_len)
            .map(|_| {
                if below(&mut r, 8) == 0 {
                    String::new()
                } else {
                    ALPHABET[below(&mut r, ALPHABET.len())].to_string()
                }
            })
            .collect();
        let tag =
            format!("seed={seed_v:#x} case={case} input=({current:?}, {stored:?}, {pending:?})");
        let direct = apply_recent_op(&current, &seed(stored.clone(), pending.clone()));
        let base = apply_recent_op(&current, &seed(stored.clone(), vec![]));
        let folded = pending.iter().rev().fold(base, |acc, x| {
            apply_recent_op(&acc, &RecentOp::Record { path: x.clone() })
        });
        assert_eq!(direct, folded, "{tag}");
    }
}

#[test]
fn mr_12_property_refresh_and_empty_seed_are_identities() {
    let seed_v = 0xD43_0012;
    let mut r = rng(seed_v);
    for case in 0..500 {
        let current = gen_list(&mut r, 13);
        let tag = format!("seed={seed_v:#x} case={case} input={current:?}");
        assert_eq!(
            apply_recent_op(&current, &RecentOp::Refresh),
            current,
            "refresh {tag}"
        );
        let seeded = apply_recent_op(&current, &seed(None, vec![]));
        if current.len() <= MAX_RECENT_FILES {
            assert_eq!(seeded, current, "seed {tag}");
        } else {
            assert_eq!(
                seeded,
                current[..MAX_RECENT_FILES].to_vec(),
                "seed over cap {tag}"
            );
        }
    }
    // Refresh never caps, even well over 10 entries.
    assert_eq!(apply_recent_op(&l(13), &RecentOp::Refresh), l(13));
}

#[test]
fn mr_13_seed_conserves_stored_duplicates_absent_from_current() {
    let out = apply_recent_op(
        &v(&["/a.md"]),
        &seed(Some(v(&["/b.md", "/b.md", "/a.md"])), vec![]),
    );
    assert_eq!(out, v(&["/a.md", "/b.md", "/b.md"]));
}
