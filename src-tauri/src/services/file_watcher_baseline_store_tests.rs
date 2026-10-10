// D32 WI-3: `BaselineStore` drop law, purity and state model (matrix B10–B13).
use super::fixture::{
    chmod, chmod_000_unreadable, rewrite_keep_stat, shift_mtime, sparse, TempDir,
};
use super::{snapshot, BaselineStore, Entry, HASH_CAP_BYTES};
use std::fs;
use std::path::{Path, PathBuf};

const HELLO: &[u8] = b"hello world";
const ROWS: [&str; 14] = [
    "a", "b", "c", "d", "e", "f", "g", "h1", "h2", "i", "j", "k", "l", "m",
];

/// Build one B10 row on a fresh file and store, asserting its preconditions.
fn build_row(row: &str, d: &TempDir, store: &BaselineStore) -> PathBuf {
    let p = d.path().join(format!("row_{row}.md"));
    let stored_stat = || store.get(&p).expect("registered").stat;
    match row {
        "g" => {
            fs::write(&p, HELLO).unwrap();
        }
        "h1" => {
            store.register(&p);
            let none = Entry {
                stat: None,
                hash: None,
            };
            assert_eq!(store.get(&p), Some(none), "h1 precondition");
        }
        "h2" | "i" => {
            fs::write(&p, HELLO).unwrap();
            chmod_000_unreadable(&p);
            store.register(&p);
            assert_eq!(store.get(&p).unwrap().hash, None, "{row}: stored hash None");
            if row == "i" {
                chmod(&p, 0o644);
            }
            assert_eq!(snapshot(&p).stat, stored_stat(), "{row}: stat unchanged");
            assert!(stored_stat().is_some(), "{row}: stored stat present");
        }
        "l" => {
            sparse(&p, HASH_CAP_BYTES + 1);
            store.register(&p);
            assert_eq!(snapshot(&p).stat, stored_stat(), "l: stat unchanged");
        }
        _ => {
            fs::write(&p, HELLO).unwrap();
            store.register(&p);
            let before = stored_stat();
            assert!(store.get(&p).unwrap().hash.is_some(), "{row}: stored hash");
            match row {
                "a" => {}
                "b" => shift_mtime(&p, 1),
                "c" => rewrite_keep_stat(&p, b"hello WORLD"),
                "d" | "f" => {
                    let bytes: &[u8] = if row == "d" {
                        b"hello WORLD"
                    } else {
                        b"hello world!"
                    };
                    fs::write(&p, bytes).unwrap();
                    super::fixture::set_mtime(&p, before.unwrap().0);
                    shift_mtime(&p, 2);
                }
                "e" => {
                    fs::write(&p, b"hello world!").unwrap();
                    super::fixture::set_mtime(&p, before.unwrap().0);
                }
                "j" => fs::remove_file(&p).unwrap(),
                "k" => {
                    chmod_000_unreadable(&p);
                    assert_eq!(snapshot(&p).stat, before, "k: stat unchanged");
                }
                "m" => {
                    fs::remove_file(&p).unwrap();
                    fs::create_dir(&p).unwrap();
                }
                other => panic!("unknown row {other}"),
            }
            if matches!(row, "b" | "d" | "e" | "f" | "j" | "m") {
                assert_ne!(snapshot(&p).stat, before, "{row}: stat differs");
            }
        }
    }
    if matches!(row, "h2" | "k") {
        assert!(
            fs::read(&p).is_err(),
            "{row}: still unreadable at the query"
        );
    }
    p
}

/// B10 + B11: `is_unchanged` is true only on the all-preconditions row, and
/// querying never changes the store or the answer.
#[cfg(unix)]
#[test]
fn b10_b11_is_unchanged_true_only_when_every_precondition_holds_and_is_pure() {
    let d = TempDir::new("b10");
    let mut got = Vec::new();
    for row in ROWS {
        let store = BaselineStore::default();
        let p = build_row(row, &d, &store);
        let (before, len) = (store.get(&p), store.len());
        let r1 = store.is_unchanged(&p);
        let r2 = store.is_unchanged(&p);
        assert_eq!(store.get(&p), before, "B11 {row}: entry unchanged");
        assert_eq!(store.len(), len, "B11 {row}: len unchanged");
        assert_eq!(r2, r1, "B11 {row}: repeated query agrees");
        if p.is_file() {
            chmod(&p, 0o644);
        }
        got.push((row, r1));
    }
    let expected: Vec<_> = ROWS.iter().map(|&r| (r, r == "a")).collect();
    assert_eq!(got, expected);
}

#[derive(Clone, Copy, Debug)]
enum Op {
    Register,
    Remove,
    Refresh,
    Mutate,
}

const OPS: [Op; 4] = [Op::Register, Op::Remove, Op::Refresh, Op::Mutate];

/// Every op sequence of length 0..=3.
fn sequences() -> Vec<Vec<Op>> {
    let mut all = vec![vec![]];
    let mut frontier = vec![vec![]];
    for _ in 0..3 {
        let next: Vec<Vec<Op>> = frontier
            .iter()
            .flat_map(|s: &Vec<Op>| OPS.iter().map(move |&op| [s.clone(), vec![op]].concat()))
            .collect();
        all.extend(next.iter().cloned());
        frontier = next;
    }
    all
}

/// Run `ops` on a fresh file and store; return (store entry, model entry, len).
fn run(d: &TempDir, n: usize, ops: &[Op]) -> (Option<Entry>, Option<Entry>, usize) {
    let p = d.file(&format!("seq{n}.md"), b"v0");
    let store = BaselineStore::default();
    let (mut present, mut value, mut mutations) = (false, None, 0);
    for op in ops {
        match op {
            Op::Register => {
                store.register(&p);
                present = true;
                value = Some(snapshot(&p));
            }
            Op::Remove => {
                store.remove(&p);
                present = false;
            }
            Op::Refresh => {
                store.refresh_if_present(&p);
                if present {
                    value = Some(snapshot(&p));
                }
            }
            Op::Mutate => {
                mutations += 1;
                fs::write(&p, "v".repeat(mutations + 2)).unwrap();
            }
        }
    }
    (store.get(&p), value.filter(|_| present), store.len())
}

/// B12: presence follows the last register/remove, refresh never inserts, and
/// the value is the snapshot at the last register or present refresh.
#[test]
fn b12_store_operations_match_the_presence_and_value_model() {
    let d = TempDir::new("b12");
    let seqs = sequences();
    assert_eq!(seqs.len(), 85);
    for (n, ops) in seqs.iter().enumerate() {
        let (got, model, len) = run(&d, n, ops);
        assert_eq!(got, model, "sequence {ops:?}");
        assert_eq!(len, usize::from(model.is_some()), "len after {ops:?}");
    }
    // Hand-written anchors, so the model is not the only oracle.
    use Op::*;
    let anchor = |n: usize, ops: &[Op]| run_named(&d.path().join(format!("anchor{n}.md")), ops);
    assert_eq!(anchor(0, &[Refresh]).0, None, "refresh never inserts");
    assert_eq!(
        anchor(1, &[Register, Remove, Refresh]).0,
        None,
        "no resurrection"
    );
    let (entry, initial, now) = anchor(2, &[Register, Mutate, Register]);
    assert_ne!(
        initial, now,
        "precondition: the mutation changed the snapshot"
    );
    assert_eq!(entry, Some(now), "re-register overwrites");
    let (entry, initial, now) = anchor(3, &[Register, Mutate]);
    assert_ne!(
        initial, now,
        "precondition: the mutation changed the snapshot"
    );
    assert_eq!(entry, Some(initial), "no auto-advance");
}

/// Run `ops` on `p` (created as `v0`); return (entry, snapshot at creation,
/// snapshot now).
fn run_named(p: &Path, ops: &[Op]) -> (Option<Entry>, Entry, Entry) {
    fs::write(p, b"v0").unwrap();
    let initial = snapshot(p);
    let store = BaselineStore::default();
    for op in ops {
        match op {
            Op::Register => store.register(p),
            Op::Remove => store.remove(p),
            Op::Refresh => store.refresh_if_present(p),
            Op::Mutate => fs::write(p, b"mutated").unwrap(),
        }
    }
    (store.get(p), initial, snapshot(p))
}

/// B13: register, refresh and remove through two aliases hit one entry.
#[cfg(unix)]
#[test]
fn b13_store_ops_resolve_aliases_to_one_entry() {
    let (_d, real, alias) = super::fixture::alias_pair("b13");
    let (r, a) = (real.join("x.md"), alias.join("x.md"));
    fs::write(&r, "A").unwrap();
    let store = BaselineStore::default();
    store.register(&a);
    let snap_a = snapshot(&r);
    assert!(snap_a.hash.is_some(), "precondition: A hashes");
    assert_eq!(store.get(&r), Some(snap_a));
    fs::write(&r, "BB").unwrap();
    store.refresh_if_present(&r);
    let snap_b = snapshot(&r);
    assert_ne!(snap_a, snap_b, "precondition: B differs from A");
    assert_eq!(store.get(&a), Some(snap_b));
    assert_eq!(store.len(), 1);
    store.remove(&a);
    assert_eq!(store.get(&r), None);
    assert_eq!(store.len(), 0);
}
