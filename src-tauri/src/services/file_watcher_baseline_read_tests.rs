//! D86 WI-1: the read primitive (matrix k13, k14, k15) and the structural
//! guards (i1: the store holds no ctime, ino or dev; r7: the read module
//! never locks; r7b: `is_unchanged` and `snapshot` decide from one read).
use super::fixture::{chmod_000_unreadable, shift_mtime, sparse, sparse_last_byte, TempDir};
use super::race_fixture::stat_pair;
use super::read::{coherent_read, read_once};
use super::seam::with_read_hook;
use super::{snapshot, BaselineStore, Entry, Inner, HASH_CAP_BYTES};
use super::Slot;
use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::time::SystemTime;

const CAP: usize = HASH_CAP_BYTES as usize;

/// k13: an unstable read keeps the bytes it read and the pre-read fstat.
#[test]
fn k13_unstable_read_keeps_the_bytes_and_s1() {
    let d = TempDir::new("k13");
    let p = d.file("a.md", b"hello world");
    let pre = stat_pair(&p).expect("stat");
    let target = p.clone();
    let r = with_read_hook(
        move || {
            fs::write(&target, b"HELLO WORLD!!").expect("rewrite");
            shift_mtime(&target, 5);
        },
        || read_once(&p),
    )
    .expect("the read itself succeeded");
    assert_ne!(stat_pair(&p), Some(pre), "precondition: the stat moved");
    assert_eq!(
        (r.s1, r.bytes.as_slice(), r.stable, r.over_cap),
        (pre, &b"hello world"[..], false, false)
    );
}

/// k14: `read_once` keeps the io error kind; a directory still snapshots
/// with a stat and no hash (B10).
#[test]
fn k14_read_once_keeps_the_io_error_kind() {
    let d = TempDir::new("k14");
    let missing = d.path().join("missing.md");
    assert_eq!(read_once(&missing).err().map(|e| e.kind()), Some(ErrorKind::NotFound));
    let locked = d.file("locked.md", b"secret");
    chmod_000_unreadable(&locked);
    assert_eq!(
        read_once(&locked).err().map(|e| e.kind()),
        Some(ErrorKind::PermissionDenied)
    );
    let dir = d.path().join("dir.md");
    fs::create_dir(&dir).expect("mkdir");
    assert!(read_once(&dir).is_err(), "a directory is not readable");
    assert!(
        matches!(snapshot(&dir), Entry { stat: Some(_), hash: None }),
        "{:?}",
        snapshot(&dir)
    );
}

/// k15: at the cap the read is complete; one byte over is flagged, never
/// truncated and never more than `CAP + 1` bytes.
#[test]
fn k15_over_cap_read_is_flagged_not_truncated() {
    let d = TempDir::new("k15");
    let p = d.path().join("cap.md");
    sparse(&p, HASH_CAP_BYTES);
    let q = d.path().join("over.md");
    sparse_last_byte(&q, HASH_CAP_BYTES + 1, b'z');
    let at = read_once(&p).expect("read at cap");
    assert_eq!((at.over_cap, at.bytes.len(), at.stable), (false, CAP, true));
    let over = read_once(&q).expect("read over cap");
    assert_eq!((over.over_cap, over.bytes.len()), (true, CAP + 1));
    assert_eq!(coherent_read(&q), None, "over cap is never coherent");
    assert_eq!(coherent_read(&p).map(|(_, b)| b.len()), Some(CAP));
}

/// i1: every struct the store owns is destructured without `..`, so a ctime,
/// ino or dev field added anywhere is a compile error (D32). WI-2 extends
/// this with its slot wrapper and `Inner::latest`.
#[test]
fn i1_entry_and_inner_hold_no_ctime_ino_or_dev() {
    let d = TempDir::new("i1");
    let p = d.file("a.md", b"x");
    let Entry { stat: _, hash: _ } = snapshot(&p);
    let store = BaselineStore::default();
    store.register(&p);
    let inner = store.locked();
    let Inner { entries: _, keys: _, latest: _ } = &*inner;
    let _: &HashMap<PathBuf, Slot> = &inner.entries;
    let _: &HashMap<PathBuf, PathBuf> = &inner.keys;
    // D86 WI-2: the slot wrapper and the ticket map are pinned too.
    let _: &HashMap<PathBuf, u64> = &inner.latest;
    let slot = inner.entries.values().next().copied().expect("registered");
    let Slot { entry: _, gen: _ } = slot;
    assert_eq!(slot.entry, snapshot(&p), "the slot wraps the entry unchanged");
    assert_eq!(
        std::mem::size_of::<Entry>(),
        std::mem::size_of::<(Option<(SystemTime, u64)>, Option<u64>)>()
    );
}

const READ_SRC: &str = include_str!("file_watcher_baseline_read.rs");
const BASELINE_SRC: &str = include_str!("file_watcher_baseline.rs");

/// Non-comment lines of the production part (before the first test item).
fn production(src: &str) -> Vec<&str> {
    let code = src.split("\n#[cfg(test)]").next().unwrap_or(src);
    code.lines().filter(|l| !l.trim_start().starts_with("//")).collect()
}

/// The lines of the fn whose header contains `anchor`, up to the closing
/// brace at the header's indentation.
fn body<'a>(lines: &[&'a str], anchor: &str) -> Vec<&'a str> {
    let start = lines
        .iter()
        .position(|l| l.contains(anchor))
        .unwrap_or_else(|| panic!("`{anchor}` not found"));
    let indent = lines[start].len() - lines[start].trim_start().len();
    let close = format!("{}}}", " ".repeat(indent));
    let end = lines[start..].iter().position(|l| *l == close).expect("fn closes");
    lines[start..=start + end].to_vec()
}

fn count(lines: &[&str], token: &str) -> usize {
    lines.iter().map(|l| l.matches(token).count()).sum()
}

/// r7: the read module never takes the store lock (precedent R6).
#[test]
fn r7_read_module_never_takes_the_lock() {
    let code = production(READ_SRC);
    assert!(code.len() > 5, "non-vacuity: the scan sees code");
    let text = code.join("\n");
    assert!(text.contains("fn read_once") && text.contains("fn coherent_read"), "non-vacuity");
    for line in &code {
        assert!(!line.contains(".lock(") && !line.contains("locked("), "{line}");
    }
}

/// r7b: `is_unchanged` decides from one coherent read (`coherent_read_upto`
/// since D112), never a path stat or a second open; `snapshot` reads once,
/// and stats the path only on the no-hash fallback.
#[test]
fn r7b_is_unchanged_and_snapshot_decide_from_one_read() {
    let baseline = production(BASELINE_SRC);
    let is_unchanged = body(&baseline, "fn is_unchanged(");
    let reads = count(&is_unchanged, "coherent_read(")
        + count(&is_unchanged, "coherent_read_upto(");
    assert_eq!(reads, 1, "{is_unchanged:#?}");
    for token in ["stat_of(", "read_capped(", "File::open(", "metadata("] {
        assert_eq!(count(&is_unchanged, token), 0, "{token} in {is_unchanged:#?}");
    }
    let read = production(READ_SRC);
    let snapshot = body(&read, "fn snapshot(");
    let reads = count(&snapshot, "read_once(") + count(&snapshot, "coherent_read(");
    assert_eq!(reads, 1, "{snapshot:#?}");
    for line in snapshot.iter().filter(|l| l.contains("stat_of(")) {
        assert!(line.contains("hash: None"), "stat_of only on the fallback: {line}");
    }
}
