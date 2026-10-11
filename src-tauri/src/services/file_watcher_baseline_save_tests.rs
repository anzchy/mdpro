//! D32 WI-6b: the save refresh binds the baseline to the bytes the save wrote
//! (ADR-0068 decision 4). An external write landing between our rename and
//! the refresh must not become the baseline, or its event would be dropped
//! as unchanged while the editor holds different bytes. Since D112 the
//! refresh stores the hash of the written bytes without reading the disk;
//! `is_unchanged` then finds the disk differs, so the event still emits.
//! Real store, real temp files, synthetic events through `process_event`.
use super::super::super::WatchOutcome::{EmittedModified, IgnoredUnchanged};
use super::super::fixture::{fresh, h, modified, route, TempDir, EXTENDED, FILTERED};
use super::super::{hash_bytes, snapshot, Entry};
use super::BaselineStore;
use std::fs;

/// R1: the race. Disk holds external bytes; the save wrote ours. The entry
/// is the hash of our bytes (D112; before it: no hash) and no stat, because
/// the disk's size is not the written length (D129; before it: the fresh
/// stat), so the check fails open and the external write's event emits.
#[test]
fn r1_disk_differs_from_written_bytes_stores_our_hash_and_emits() {
    let d = TempDir::new("r1");
    let p = d.file("a.md", b"before the save");
    let store = BaselineStore::default();
    store.register(&p);
    fs::write(&p, b"external writer's bytes").expect("external write");

    store.refresh_after_save(&p, b"our saved bytes");

    let fresh_stat = snapshot(&p).stat;
    assert!(fresh_stat.is_some(), "precondition: file exists");
    assert_eq!(
        store.get(&p),
        Some(Entry {
            stat: None,
            hash: Some(hash_bytes(b"our saved bytes"))
        })
    );
    assert!(!store.is_unchanged(&p), "the drop fails open");
    for kind in FILTERED {
        // An emitted `modified` advances the baseline (refresh_if_present),
        // so each kind starts again from the post-save state.
        store.refresh_after_save(&p, b"our saved bytes");
        assert_eq!(
            route(kind, &[&p], &fresh(), &store),
            (modified(&p), EmittedModified),
            "{kind:?}"
        );
    }
}

/// R1b: same-length external bytes (equal size) still differ: the stored
/// hash is ours (D112), the disk's is not, so the event emits.
#[test]
fn r1b_same_length_external_bytes_still_emit() {
    let d = TempDir::new("r1b");
    let p = d.file("a.md", b"xxxx");
    let store = BaselineStore::default();
    store.register(&p);
    fs::write(&p, b"THEM").expect("external write");

    store.refresh_after_save(&p, b"ours");

    assert_eq!(
        store.get(&p).map(|e| e.hash),
        Some(Some(hash_bytes(b"ours")))
    );
    assert!(!store.is_unchanged(&p));
    assert_eq!(
        route(EXTENDED, &[&p], &fresh(), &store),
        (modified(&p), EmittedModified)
    );
}

/// R2: no race. Disk equals what we wrote: the entry is the snapshot, and a
/// burst of residual filtered events is dropped.
#[test]
fn r2_disk_equals_written_bytes_stores_the_snapshot_and_drops_a_burst() {
    let d = TempDir::new("r2");
    let p = d.file("a.md", b"before the save");
    let store = BaselineStore::default();
    store.register(&p);
    fs::write(&p, b"our saved bytes").expect("our write");

    store.refresh_after_save(&p, b"our saved bytes");

    assert_eq!(store.get(&p), Some(snapshot(&p)));
    assert_eq!(store.get(&p).and_then(|e| e.hash), h(b"our saved bytes"));
    for kind in FILTERED {
        for _ in 0..3 {
            let (_, outcome) = route(kind, &[&p], &fresh(), &store);
            assert_eq!(outcome, IgnoredUnchanged, "{kind:?}");
        }
    }
}

/// R3: an unregistered path gets no entry, including one removed earlier.
#[test]
fn r3_unregistered_path_creates_no_entry() {
    let d = TempDir::new("r3");
    let p = d.file("a.md", b"bytes");
    let store = BaselineStore::default();
    store.refresh_after_save(&p, b"bytes");
    assert_eq!(store.get(&p), None);
    assert_eq!(store.len(), 0);

    store.register(&p);
    store.remove(&p);
    store.refresh_after_save(&p, b"bytes");
    assert_eq!(store.get(&p), None);
    assert_eq!(store.len(), 0);
}

/// R4: the stat fails (file gone after the write): no stat, so it fails
/// open (D112: the hash of the written bytes is still stored; before it, no
/// hash). The path is canonical, as `save_file_with` passes it, so the key
/// still resolves once the file is gone.
#[test]
fn r4_failed_stat_stores_no_stat_and_fails_open() {
    let d = TempDir::new("r4");
    let p = fs::canonicalize(d.file("a.md", b"bytes")).expect("canonical");
    let store = BaselineStore::default();
    store.register(&p);
    fs::remove_file(&p).expect("remove");

    store.refresh_after_save(&p, b"bytes");

    assert!(store.get(&p).is_some(), "the entry stays registered");
    assert_eq!(store.get(&p).and_then(|e| e.stat), None);
    assert_eq!(
        store.get(&p).and_then(|e| e.hash),
        Some(hash_bytes(b"bytes"))
    );
    assert!(!store.is_unchanged(&p));
}

/// R5 (S4 law): over a table of (disk, written) pairs, the stored entry is
/// the hash of the written bytes (D112; before it, a hash only when the disk
/// equalled them) and the fresh stat when its size is the written length,
/// else no stat (D129), and the file reads as unchanged exactly when the
/// disk bytes equal the written bytes.
#[test]
fn r5_unchanged_iff_disk_equals_written() {
    let pairs: &[(&[u8], &[u8])] = &[
        (b"", b""),
        (b"", b"x"),
        (b"x", b""),
        (b"same", b"same"),
        (b"same", b"Same"),
        (b"prefix", b"prefix+"),
        (b"a\r\nb\r\n", b"a\r\nb\r\n"),
        (b"a\r\nb\r\n", b"a\nb\n"),
        (b"\xEF\xBB\xBFbom", b"bom"),
    ];
    let d = TempDir::new("r5");
    for (i, (disk, written)) in pairs.iter().enumerate() {
        let p = d.file(&format!("p{i}.md"), b"registered");
        let store = BaselineStore::default();
        store.register(&p);
        fs::write(&p, disk).expect("disk bytes");

        store.refresh_after_save(&p, written);

        let got = store.get(&p).expect("still registered");
        let ours = |&(_, size): &(_, u64)| size == written.len() as u64;
        let want = snapshot(&p).stat.filter(ours);
        assert_eq!(got.stat, want, "pair {i}: fresh stat if the size is ours");
        assert_eq!(got.hash, Some(hash_bytes(written)), "pair {i}");
        let unchanged = store.is_unchanged(&p);
        assert_eq!(
            unchanged,
            disk == written,
            "pair {i}: {disk:?} vs {written:?}"
        );
    }
}

/// B18′ extension: the save module never takes the lock itself; it goes
/// through the parent's I/O-free map helpers.
#[test]
fn r6_save_module_uses_only_the_map_helpers_for_the_lock() {
    const SRC: &str = include_str!("file_watcher_baseline_save.rs");
    let production = SRC.split("\n#[cfg(test)]").next().unwrap_or(SRC);
    let code: Vec<&str> = production
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect();
    assert!(code.len() > 5, "non-vacuity");
    for line in &code {
        assert!(
            !line.contains(".lock(") && !line.contains("locked("),
            "save module takes the lock: {line}"
        );
    }
    let joined = code.join("\n");
    assert!(joined.contains("copy_out("), "checks presence via copy_out");
    assert!(
        joined.contains("put_if_present("),
        "stores via put_if_present"
    );
}
