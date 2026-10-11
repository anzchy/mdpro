//! D129: the save refresh stores a stat only when its size is the length of
//! the bytes the save wrote. Another writer can replace the file between our
//! rename and the refresh's stat; its size must not become the baseline's,
//! because `is_unchanged_why` reads up to the stored size, so a foreign size
//! we never wrote would lift the 10 MiB read budget for every later event.
//! The rule is the one `seed_for_written` (the Save As seed, D69) applies,
//! so both paths share it (z5). The over-cap save with no interference
//! (the D112 acceptance) is S1 in file_watcher_baseline_save_cap_tests.rs.
use super::super::fixture::{sparse, TempDir};
use super::super::seam::{read_once_calls, with_read_hook};
use super::super::seed::seed_for_written;
use super::super::{hash_bytes, snapshot, BaselineStore, UnchangedCheck, HASH_CAP_BYTES};
use std::fs;
use std::path::{Path, PathBuf};

/// The foreign file's size: well past the read cap.
const FOREIGN: u64 = HASH_CAP_BYTES + 1024 * 1024;

/// A registered file holding `before`, canonical like the paths
/// `save_file_with` and FSEvents use.
fn registered(d: &TempDir, before: &[u8]) -> (BaselineStore, PathBuf) {
    let p = fs::canonicalize(d.file("doc.md", before)).expect("canonical");
    let store = BaselineStore::default();
    store.register(&p);
    (store, p)
}

/// Write `bytes` to a sibling temp file and rename it over `p`, as
/// `atomic_write` does.
fn replace_with(p: &Path, bytes: &[u8]) {
    let tmp = p.with_extension("d129.tmp");
    fs::write(&tmp, bytes).expect("write temp");
    fs::rename(&tmp, p).expect("rename temp over the file");
}

/// Another writer renames a sparse `len`-byte file over `p`.
fn foreign_sparse_replace(p: &Path, len: u64) {
    let tmp = p.with_extension("d129.foreign");
    sparse(&tmp, len);
    fs::rename(&tmp, p).expect("rename the foreign file over ours");
}

/// Our save renames `written` over the file, then runs the refresh with
/// `foreign` landing between its copy-out and its stat (the seam).
fn save_with_foreign(store: &BaselineStore, p: &Path, written: &[u8], foreign: fn(&Path)) {
    replace_with(p, written);
    let q = p.to_path_buf();
    with_read_hook(move || foreign(&q), || store.refresh_after_save(p, written));
}

/// The check's answer and how many `read_once` calls it made.
fn check_counting_reads(store: &BaselineStore, p: &Path) -> (UnchangedCheck, u64) {
    let before = read_once_calls();
    let why = store.is_unchanged_why(p);
    (why, read_once_calls() - before)
}

/// z1 (D129 acceptance): we save 4 bytes, another writer drops a file past
/// the cap in before the refresh's stat. No stat is stored (its size is
/// not ours), so the check answers `no_baseline` without reading at all.
/// RED before D129: the stat carried the foreign size, and the check read
/// the whole foreign file and answered `hash_differs`.
#[test]
fn z1_foreign_over_cap_replace_before_the_stat_stores_no_stat_and_never_reads() {
    let d = TempDir::new("d129z1");
    let written: &[u8] = b"ours";
    let (store, p) = registered(&d, b"before");

    save_with_foreign(&store, &p, written, |q| foreign_sparse_replace(q, FOREIGN));

    let len = fs::metadata(&p).expect("stat").len();
    assert_eq!(len, FOREIGN, "precondition: the foreign writer ran");
    let e = store.get(&p).expect("still registered");
    assert_eq!(e.hash, Some(hash_bytes(written)), "the hash is ours");
    let stored_size = e.stat.map(|(_, size)| size);
    let (why, reads) = check_counting_reads(&store, &p);
    assert_eq!(
        (stored_size, why, reads),
        (None, UnchangedCheck::NoBaseline, 0),
        "(stored size, check, read_once calls)"
    );
}

/// z2: a foreign replace of the same size is still caught. Its stat is
/// stored (the size is the written length), the hash is ours, and the check
/// sees the bytes differ.
#[test]
fn z2_same_size_foreign_replace_is_never_unchanged() {
    let d = TempDir::new("d129z2");
    let written: &[u8] = b"ours";
    let (store, p) = registered(&d, b"before");

    save_with_foreign(&store, &p, written, |q| replace_with(q, b"THEM"));

    assert_eq!(fs::read(&p).expect("read"), b"THEM", "precondition");
    let e = store.get(&p).expect("still registered");
    assert_eq!(e.stat.map(|(_, size)| size), Some(written.len() as u64));
    assert_eq!(e.hash, Some(hash_bytes(written)), "the hash is ours");
    let why = store.is_unchanged_why(&p);
    assert!(
        matches!(
            why,
            UnchangedCheck::StatDiffers | UnchangedCheck::HashDiffers
        ),
        "same-size foreign bytes answered {why:?}"
    );
}

/// z3: no interference. The stat is stored with the written length and the
/// check drops our own event (D112 kept).
#[test]
fn z3_plain_save_stores_the_stat_and_is_unchanged() {
    let d = TempDir::new("d129z3");
    let written: &[u8] = b"beta beta\n";
    let (store, p) = registered(&d, b"alpha\n");
    replace_with(&p, written);

    store.refresh_after_save(&p, written);

    let e = store.get(&p).expect("still registered");
    assert_eq!(e.stat, snapshot(&p).stat, "the path's stat");
    assert_eq!(e.stat.map(|(_, size)| size), Some(written.len() as u64));
    assert_eq!(e.hash, Some(hash_bytes(written)));
    assert_eq!(store.is_unchanged_why(&p), UnchangedCheck::Unchanged);
}

/// z4: an empty save that a foreign writer fills is no stat too: zero is
/// a size like any other.
#[test]
fn z4_empty_save_then_foreign_bytes_stores_no_stat() {
    let d = TempDir::new("d129z4");
    let (store, p) = registered(&d, b"before");

    save_with_foreign(&store, &p, b"", |q| replace_with(q, b"theirs"));

    let e = store.get(&p).expect("still registered");
    assert_eq!(e.stat, None, "a size we never wrote is not stored");
    assert_eq!(store.is_unchanged_why(&p), UnchangedCheck::NoBaseline);
}

/// z5: one rule for both writers of a written-bytes entry. Over a table of
/// (disk, written) pairs, the save refresh stores exactly what the Save As
/// seed builds, and a stored stat's size is always the written length.
#[test]
fn z5_save_refresh_and_save_as_seed_agree() {
    let pairs: &[(&[u8], &[u8])] = &[
        (b"same", b"same"),
        (b"THEM", b"ours"),
        (b"longer than ours", b"ours"),
        (b"", b"x"),
        (b"x", b""),
    ];
    let d = TempDir::new("d129z5");
    for (i, (disk, written)) in pairs.iter().enumerate() {
        let p = fs::canonicalize(d.file(&format!("p{i}.md"), b"registered")).expect("canon");
        let store = BaselineStore::default();
        store.register(&p);
        fs::write(&p, disk).expect("disk bytes");

        store.refresh_after_save(&p, written);

        let got = store.get(&p).expect("still registered");
        assert_eq!(got, seed_for_written(&p, written), "pair {i}");
        let want = (disk.len() == written.len()).then_some(written.len() as u64);
        assert_eq!(got.stat.map(|(_, size)| size), want, "pair {i}");
    }
}
