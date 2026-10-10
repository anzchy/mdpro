// D32 WI-3: one entry per registration across key changes, and the frame
// invariant (matrix B17, coordinator addendum B19). Split from the store
// tests to keep each file under 300 lines.
use super::fixture::{h, TempDir};
use super::{snapshot, BaselineStore, Entry};
use std::fs;

const NONE: Entry = Entry {
    stat: None,
    hash: None,
};

/// B17 (a): missing then existing. The second register moves the entry from
/// the raw key to the canonical key, and `remove` clears it.
#[cfg(unix)]
#[test]
fn b17a_re_register_missing_then_existing_leaves_one_entry_and_remove_clears_it() {
    let (_d, real, alias) = super::fixture::alias_pair("b17a");
    let a = alias.join("x.md");
    let store = BaselineStore::default();
    store.register(&a);
    assert_eq!(
        store.get(&a),
        Some(NONE),
        "precondition: raw-keyed empty entry"
    );
    fs::write(real.join("x.md"), "made").unwrap();
    store.register(&a);
    assert_eq!(store.len(), 1, "exactly one entry after the key change");
    let got = store.get(&real.join("x.md"));
    assert_eq!(got, Some(snapshot(&real.join("x.md"))));
    assert!(got.unwrap().stat.is_some());
    assert_eq!(got.unwrap().hash, h(b"made"));
    store.remove(&a);
    assert_eq!(store.len(), 0, "remove clears the canonical entry");
}

/// B17 (b): existing then missing. The second register moves the entry from
/// the canonical key to the raw key, and `remove` clears it.
#[cfg(unix)]
#[test]
fn b17b_re_register_existing_then_missing_leaves_one_entry_and_remove_clears_it() {
    let (_d, real, alias) = super::fixture::alias_pair("b17b");
    let a = alias.join("x.md");
    fs::write(real.join("x.md"), "there").unwrap();
    let store = BaselineStore::default();
    store.register(&a);
    assert!(
        store.get(&a).and_then(|e| e.hash).is_some(),
        "precondition: canonical entry with a hash"
    );
    fs::remove_file(real.join("x.md")).unwrap();
    store.register(&a);
    assert_eq!(store.len(), 1, "exactly one entry after the key change");
    assert_eq!(store.get(&a), Some(NONE));
    store.remove(&a);
    assert_eq!(store.len(), 0, "remove clears the raw-keyed entry");
}

/// B19: operations on P, and on a never-registered R, never touch Q's entry,
/// even after Q changed on disk.
#[test]
fn b19_store_ops_on_one_key_leave_other_keys_untouched() {
    let d = TempDir::new("b19");
    let p = d.file("p.md", b"pee");
    let q = d.file("q.md", b"queue");
    let r_never = d.path().join("never.md");
    let store = BaselineStore::default();
    store.register(&p);
    store.register(&q);
    let e_q = store.get(&q).expect("Q registered");
    assert!(e_q.hash.is_some(), "precondition: Q hashed");
    fs::write(&q, b"queue, changed").unwrap();
    assert_ne!(snapshot(&q), e_q, "precondition: Q changed on disk");

    let ops: [(&str, &dyn Fn()); 5] = [
        ("refresh(P)", &|| store.refresh_if_present(&p)),
        ("remove(P)", &|| store.remove(&p)),
        ("remove(R)", &|| store.remove(&r_never)),
        ("refresh(R)", &|| store.refresh_if_present(&r_never)),
        ("register(P)", &|| store.register(&p)),
    ];
    let mut lens = Vec::new();
    for (name, op) in ops {
        op();
        assert_eq!(store.get(&q), Some(e_q), "Q untouched after {name}");
        lens.push(store.len());
    }
    assert_eq!(lens, vec![2, 1, 1, 1, 2]);
}
