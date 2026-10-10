// D32 WI-3/4/4b: every case that reads a 10 MiB file (matrix B4, B5, B16,
// B16(c), the routing twins R16/R22 and B16(c)'s `process_event` twin, and
// K2's over-cap row).
use super::fixture::{mtime, poke_keep_stat, sparse, sparse_last_byte, varied, TempDir};
use super::{snapshot, BaselineStore, HASH_CAP_BYTES};
use std::fs;

const CAP: u64 = HASH_CAP_BYTES;
const THREE_MIB: usize = 3 * 1024 * 1024;

/// B4: hashed at 0, 1 and exactly the cap; no hash one byte over it. The
/// stat is present and exact in all four.
#[test]
fn b4_snapshot_hashes_at_cap_and_omits_hash_over_cap() {
    let d = TempDir::new("b4");
    let mut got = Vec::new();
    for len in [0, 1, CAP, CAP + 1] {
        let p = d.path().join(format!("s{len}.md"));
        sparse(&p, len);
        let s = snapshot(&p);
        assert_eq!(s.stat, Some((mtime(&p), len)), "stat for len {len}");
        got.push((len, s.hash.is_some()));
    }
    assert_eq!(
        got,
        vec![(0, true), (1, true), (CAP, true), (CAP + 1, false)]
    );
}

/// B5: every byte up to the cap feeds the hash (metamorphic: flipping any one
/// byte changes it, and different flips differ from each other).
#[test]
fn b5_snapshot_hash_covers_every_byte_up_to_the_cap() {
    let d = TempDir::new("b5");
    let base = vec![0x61u8; THREE_MIB];
    let base_hash = snapshot(&d.file("base.md", &base)).hash;
    assert!(base_hash.is_some(), "precondition: base hashes");
    let len = base.len();
    let mut hashes = Vec::new();
    for pos in [0, 8191, 8192, 65536, len / 2, len - 1] {
        let mut bytes = base.clone();
        bytes[pos] = 0x62;
        let hash = snapshot(&d.file(&format!("flip{pos}.md"), &bytes)).hash;
        assert!(hash.is_some(), "flip at {pos}: hashed");
        assert_ne!(hash, base_hash, "flip at {pos} changes the hash");
        hashes.push(hash);
    }
    for i in 0..hashes.len() {
        for j in i + 1..hashes.len() {
            assert_ne!(hashes[i], hashes[j], "flips {i} and {j} differ");
        }
    }

    let zero = d.path().join("cap0.md");
    let one = d.path().join("cap1.md");
    sparse(&zero, CAP);
    sparse_last_byte(&one, CAP, 1);
    let (hz, ho) = (snapshot(&zero).hash, snapshot(&one).hash);
    assert!(
        hz.is_some() && ho.is_some(),
        "precondition: both at-cap files hash"
    );
    assert_ne!(hz, ho, "the byte at CAP-1 feeds the hash");
}

/// Register `p`, then assert the stored hash is present and the stat is current.
fn register_with_hash(store: &BaselineStore, p: &std::path::Path) {
    store.register(p);
    let stored = store.get(p).expect("precondition: registered");
    assert!(stored.hash.is_some(), "precondition: stored hash present");
    assert_eq!(snapshot(p).stat, stored.stat, "precondition: stat equal");
}

/// B16 (a, b): the drop law's true region reaches large and exactly-at-cap files.
#[test]
fn b16_is_unchanged_true_on_large_and_at_cap_files() {
    let d = TempDir::new("b16");
    let store = BaselineStore::default();
    let large = d.file("large.md", &varied(THREE_MIB));
    let at_cap = d.path().join("cap.md");
    sparse_last_byte(&at_cap, CAP, 1);
    register_with_hash(&store, &large);
    register_with_hash(&store, &at_cap);
    assert!(store.is_unchanged(&large), "(a) 3 MiB unchanged file");
    assert!(
        store.is_unchanged(&at_cap),
        "(b) exactly-CAP unchanged file"
    );
}

/// B16(c): a same-stat content change on a large or at-cap file is not unchanged.
#[test]
fn b16c_is_unchanged_false_on_large_same_stat_content_change() {
    let d = TempDir::new("b16c");
    let store = BaselineStore::default();
    let bytes = varied(THREE_MIB);
    let large = d.file("large.md", &bytes);
    register_with_hash(&store, &large);
    poke_keep_stat(&large, (THREE_MIB - 1) as u64, !bytes[THREE_MIB - 1]);
    assert_eq!(snapshot(&large).stat, store.get(&large).unwrap().stat);
    assert!(!store.is_unchanged(&large), "(a) last byte flipped");

    let at_cap = d.path().join("cap.md");
    sparse_last_byte(&at_cap, CAP, 1);
    register_with_hash(&store, &at_cap);
    poke_keep_stat(&at_cap, CAP - 1, 2);
    assert_eq!(snapshot(&at_cap).stat, store.get(&at_cap).unwrap().stat);
    assert_eq!(fs::metadata(&at_cap).unwrap().len(), CAP);
    assert!(!store.is_unchanged(&at_cap), "(b) byte CAP-1 set to 2");
}

// ---- D32 WI-4 routing twins: `process_event` reads through the store ----

/// R16: a registered file one byte over the cap has no hash, so it emits.
#[test]
fn r16_fail_open_over_10_mib_emits() {
    use super::fixture::{fresh, modified, route, EXTENDED};
    let d = TempDir::new("r16");
    let store = BaselineStore::default();
    let p = d.path().join("over.md");
    sparse(&p, CAP + 1);
    store.register(&p);
    assert_eq!(store.get(&p).unwrap().hash, None, "precondition: no hash");
    assert_eq!(
        route(EXTENDED, &[&p], &fresh(), &store),
        (modified(&p), super::super::WatchOutcome::EmittedModified)
    );
}

/// R22: an unchanged file of exactly the cap is dropped, with no debounce entry.
#[test]
fn r22_extended_on_unchanged_at_cap_file_is_ignored() {
    use super::fixture::{fresh, route, EXTENDED};
    let d = TempDir::new("r22");
    let store = BaselineStore::default();
    let p = d.path().join("cap.md");
    sparse_last_byte(&p, CAP, 1);
    register_with_hash(&store, &p);
    let map = fresh();
    assert_eq!(
        route(EXTENDED, &[&p], &map, &store),
        (
            serde_json::Value::Null,
            super::super::WatchOutcome::IgnoredUnchanged
        )
    );
    assert!(
        map.lock().unwrap().is_empty(),
        "drop recorded a debounce entry"
    );
}

/// B16(c) routing twin: an at-cap same-stat content change emits, for each
/// of the three filtered kinds (WI-4b).
#[test]
fn b16c_route_at_cap_same_stat_content_change_emits() {
    use super::fixture::{fresh, modified, route, FILTERED};
    let d = TempDir::new("b16cr");
    let store = BaselineStore::default();
    for (i, kind) in FILTERED.into_iter().enumerate() {
        let p = d.path().join(format!("cap{i}.md"));
        sparse_last_byte(&p, CAP, 1);
        register_with_hash(&store, &p);
        poke_keep_stat(&p, CAP - 1, 2);
        assert_eq!(snapshot(&p).stat, store.get(&p).unwrap().stat);
        assert_eq!(
            route(kind, &[&p], &fresh(), &store),
            (modified(&p), super::super::WatchOutcome::EmittedModified),
            "{kind:?}"
        );
    }
}

/// K2 (over-cap row): a registered file one byte over the cap has no stored
/// hash, so each of the three filtered kinds emits. Once per kind.
#[test]
fn k2_over_cap_registered_without_hash_emits_for_every_filtered_kind() {
    use super::fixture::{fresh, modified, route, FILTERED};
    let d = TempDir::new("k2cap");
    let store = BaselineStore::default();
    for (i, kind) in FILTERED.into_iter().enumerate() {
        let p = d.path().join(format!("over{i}.md"));
        sparse(&p, CAP + 1);
        store.register(&p);
        let stored = store.get(&p).expect("precondition: registered");
        assert_eq!(stored.hash, None, "precondition: no hash over the cap");
        assert_eq!(snapshot(&p).stat, stored.stat, "precondition: stat equal");
        assert_eq!(
            route(kind, &[&p], &fresh(), &store),
            (modified(&p), super::super::WatchOutcome::EmittedModified),
            "{kind:?}"
        );
    }
}
