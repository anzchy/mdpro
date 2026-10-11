//! D43 WI-3: `sanitize_recent_op` (SV-04, SV-05, SV-06 pure half) of
//! `.claude/tdd-guardian/tests-20261007-143049.md`. Pure function, nothing mocked.
//!
//! **Law**: each Seed list is exactly `input.filter(non-empty && <= MAX bytes)
//! .take(MAX_ENTRIES)`; a Record is returned byte-identical when within the
//! limit and rejected with a "too long" error otherwise; Refresh is unchanged;
//! sanitize is idempotent and total.

use super::{
    apply_recent_op, sanitize_recent_op, RecentOp, MAX_RECENT_FILES, MAX_RECENT_OP_ENTRIES,
    MAX_RECENT_PATH_BYTES,
};

/// `L(n)`: `["/l0.md", …, "/l{n-1}.md"]`.
fn l(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("/l{i}.md")).collect()
}

fn seed(stored: Option<Vec<String>>, pending: Vec<String>) -> RecentOp {
    RecentOp::Seed {
        stored,
        pending_newest_first: pending,
    }
}

#[test]
fn sv04_list_count_boundary_trims_to_the_first_max_after_filtering() {
    // (a) MAX+1 → the first MAX, in order
    let over = l(MAX_RECENT_OP_ENTRIES + 1);
    assert_eq!(
        sanitize_recent_op(seed(Some(over.clone()), over)),
        Ok(seed(
            Some(l(MAX_RECENT_OP_ENTRIES)),
            l(MAX_RECENT_OP_ENTRIES)
        ))
    );
    // (b) exactly MAX → unchanged
    let at = l(MAX_RECENT_OP_ENTRIES);
    assert_eq!(
        sanitize_recent_op(seed(Some(at.clone()), at.clone())),
        Ok(seed(Some(at.clone()), at))
    );
    // (c) filter first, then trim: a leading "" must not cost a valid entry
    let mut with_empty = vec![String::new()];
    with_empty.extend(l(MAX_RECENT_OP_ENTRIES));
    assert_eq!(
        sanitize_recent_op(seed(Some(with_empty), Vec::new())),
        Ok(seed(Some(l(MAX_RECENT_OP_ENTRIES)), Vec::new()))
    );
}

#[test]
fn sv06_non_ascii_seed_is_returned_unchanged() {
    let op = seed(
        Some(vec!["/文档/笔记.md".to_string()]),
        vec!["/é.md".to_string()],
    );
    assert_eq!(sanitize_recent_op(op.clone()), Ok(op));
}

fn rng(seed: u64) -> impl FnMut() -> u64 {
    let mut x = seed;
    move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    }
}

/// Empty with p=1/6; otherwise ASCII / `é` (2 bytes) / `文` (3 bytes), and
/// with p=1/3 a byte length within MAX±2.
fn gen_path(next: &mut impl FnMut() -> u64) -> String {
    if next().is_multiple_of(6) {
        return String::new();
    }
    let target = if next().is_multiple_of(3) {
        MAX_RECENT_PATH_BYTES - 2 + (next() % 5) as usize
    } else {
        1 + (next() % 24) as usize
    };
    let mut path = String::from("/");
    while path.len() < target {
        let room = target - path.len();
        match next() % 3 {
            1 if room >= 2 => path.push('é'),
            2 if room >= 3 => path.push('文'),
            _ => path.push('a'),
        }
    }
    path
}

fn gen_list(next: &mut impl FnMut() -> u64) -> Vec<String> {
    let len = (next() % (MAX_RECENT_OP_ENTRIES as u64 + 4)) as usize;
    (0..len).map(|_| gen_path(next)).collect()
}

fn expected_list(input: &[String]) -> Vec<String> {
    input
        .iter()
        .filter(|p| !p.is_empty() && p.len() <= MAX_RECENT_PATH_BYTES)
        .take(MAX_RECENT_OP_ENTRIES)
        .cloned()
        .collect()
}

#[test]
fn sv05_property_exact_filter_then_trim_bounded_idempotent_total() {
    const SEED: u64 = 0xD43_0205;
    let mut next = rng(SEED);
    for case in 0..1000 {
        let x = match next() % 3 {
            0 => {
                let stored = if next().is_multiple_of(4) {
                    None
                } else {
                    Some(gen_list(&mut next))
                };
                seed(stored, gen_list(&mut next))
            }
            1 => RecentOp::Record {
                path: gen_path(&mut next),
            },
            _ => RecentOp::Refresh,
        };
        let tag = format!("seed={SEED:#x} case={case} input={x:?}");
        let s = sanitize_recent_op(x.clone());
        match (&x, &s) {
            (
                RecentOp::Seed {
                    stored,
                    pending_newest_first,
                },
                Ok(RecentOp::Seed {
                    stored: s_stored,
                    pending_newest_first: s_pending,
                }),
            ) => {
                assert_eq!(s_stored, &stored.as_deref().map(expected_list), "{tag}");
                assert_eq!(s_pending, &expected_list(pending_newest_first), "{tag}");
            }
            (RecentOp::Record { path }, _) if path.len() <= MAX_RECENT_PATH_BYTES => {
                assert_eq!(s, Ok(RecentOp::Record { path: path.clone() }), "{tag}");
            }
            (RecentOp::Record { .. }, Err(e)) => assert!(e.contains("too long"), "{tag} e={e}"),
            (RecentOp::Refresh, Ok(RecentOp::Refresh)) => {}
            _ => panic!("{tag} unexpected result {s:?}"),
        }
        if let Ok(clean) = &s {
            assert_eq!(sanitize_recent_op(clean.clone()), s, "{tag} not idempotent");
            assert!(
                apply_recent_op(&[], clean).len() <= MAX_RECENT_FILES,
                "{tag}"
            );
        }
    }
}
