//! D112: the save refresh binds the baseline to the bytes the save wrote
//! without re-reading the file, so mdpro's own ⌘S never becomes a false
//! "External change detected" prompt: not for a document over the 10 MiB
//! hash cap (S1), not when the post-save read would have been unstable
//! (S3). The disk check stays in `is_unchanged`, which re-reads coherently
//! and catches any other writer (S2, S4). Only the save path can store a
//! hash for more than `HASH_CAP_BYTES` (S5); every other entry keeps the
//! 10 MiB read cap (S6). These cases run at the watcher layer: the frontend's
//! 3 s post-save window (D86 WI-4 removes it) does not exist here, so a
//! false prompt shows up as `EmittedModified`.
use super::super::super::WatchOutcome::{EmittedModified, IgnoredUnchanged};
use super::super::fixture::{append, chmod, fresh, modified, poke_keep_stat, route, TempDir};
use super::super::fixture::{EXTENDED, FILTERED};
use super::super::seam::{read_once_calls, with_read_hook};
use super::super::seed::read_for_open;
use super::super::{hash_bytes, snapshot, BaselineStore, HASH_CAP_BYTES};
use notify::event::{ModifyKind, RenameMode};
use notify::EventKind;
use serde_json::Value;
use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;

const CAP: u64 = HASH_CAP_BYTES;
/// The single-path rename FSEvents reports for the save's temp + rename.
const RENAMED: EventKind = EventKind::Modify(ModifyKind::Name(RenameMode::Any));
/// A save just past the cap: 10 MiB + 4 KiB.
const OVER: u64 = CAP + 4096;
/// One 16-byte line; `OVER` is a whole number of them.
const LINE: &str = "0123456789abcde\n";

/// `OVER` bytes of text, as the editor would hand them to the save.
fn big_text() -> String {
    LINE.repeat((OVER / LINE.len() as u64) as usize)
}

/// Write `written` to a sibling temp file and rename it over `p`, as
/// `atomic_write` does.
fn replace_with(p: &Path, written: &[u8]) {
    let tmp = p.with_extension("d112.tmp");
    fs::write(&tmp, written).expect("write temp");
    fs::rename(&tmp, p).expect("rename temp over the file");
}

/// A registered file holding `before`, canonical like the paths
/// `save_file_with` and FSEvents use.
fn registered(d: &TempDir, before: &[u8]) -> (BaselineStore, PathBuf) {
    let p = fs::canonicalize(d.file("doc.md", before)).expect("canonical");
    let store = BaselineStore::default();
    store.register(&p);
    (store, p)
}

/// S1 (acceptance): own ⌘S through the real `save_file_with` of a document
/// past the cap, then the save's own rename event after the save mark has
/// cleared: dropped as unchanged, never a prompt. RED before D112: the
/// written bytes were over the cap, so the refresh stored no hash and the
/// event emitted.
#[cfg(target_os = "macos")]
#[tokio::test]
async fn s1_own_save_over_the_cap_then_its_rename_event_is_ignored_unchanged() {
    use crate::commands::file_save_fixture::{canon, save, Dir};
    let d = Dir::new("d112s1");
    let p = d.file("doc.md", b"small before the paste\n");
    let store = BaselineStore::default();
    store.register(&p);
    let text = big_text();

    save(&p, &text, &store).await.expect("save over the cap");

    let c = canon(&p);
    assert_eq!(fs::metadata(&c).expect("stat").len(), OVER, "precondition");
    for kind in [RENAMED, EXTENDED] {
        let map = fresh();
        assert_eq!(
            route(kind, &[&c], &map, &store),
            (Value::Null, IgnoredUnchanged),
            "{kind:?}"
        );
        assert!(map.lock().unwrap().is_empty(), "{kind:?}: debounce entry");
    }
}

/// S2: after a save past the cap, an external replace still prompts: same
/// size and mtime with one byte past the cap changed (only a read of the
/// whole file sees it), and a size change.
#[test]
fn s2_external_change_after_an_over_cap_save_still_emits() {
    let d = TempDir::new("d112s2");
    let written = big_text().into_bytes();
    let (store, p) = registered(&d, b"before");
    replace_with(&p, &written);
    store.refresh_after_save(&p, &written);

    poke_keep_stat(&p, OVER - 1, b'#');
    assert_eq!(
        route(RENAMED, &[&p], &fresh(), &store),
        (modified(&p), EmittedModified),
        "same stat, byte past the cap changed"
    );

    replace_with(&p, &written);
    store.refresh_after_save(&p, &written);
    append(&p, b"x");
    assert_eq!(
        route(RENAMED, &[&p], &fresh(), &store),
        (modified(&p), EmittedModified),
        "size changed"
    );
}

/// Run the save refresh with `perturb` landing where the pre-D112 refresh
/// read the file (between its read and its restat). The refresh no longer
/// reads, so the hook never fires; the change is then applied right after
/// the refresh instead. Either way it has happened before the event.
fn refresh_with_metadata_change(
    store: &BaselineStore,
    p: &Path,
    written: &[u8],
    perturb: fn(&Path),
) {
    let ran = Rc::new(Cell::new(false));
    let (flag, q) = (Rc::clone(&ran), p.to_path_buf());
    with_read_hook(
        move || {
            perturb(&q);
            flag.set(true);
        },
        || store.refresh_after_save(p, written),
    );
    if !ran.get() {
        perturb(p);
    }
}

fn chmod_600(p: &Path) {
    chmod(p, 0o600);
}

/// S3: a metadata-only change (chmod moves ctime) landing during or right
/// after the save refresh no longer matters: mtime, size and bytes are
/// ours, so the save's rename event and every filtered kind are dropped.
/// RED before D112: the refresh's own read was unstable, so it stored no
/// hash and the event emitted.
#[test]
fn s3_metadata_change_during_the_save_refresh_still_drops_the_own_event() {
    let d = TempDir::new("d112s3");
    let written: &[u8] = b"beta beta\n";
    let (store, p) = registered(&d, b"alpha\n");
    replace_with(&p, written);

    refresh_with_metadata_change(&store, &p, written, chmod_600);

    for kind in std::iter::once(RENAMED).chain(FILTERED) {
        assert_eq!(
            route(kind, &[&p], &fresh(), &store),
            (Value::Null, IgnoredUnchanged),
            "{kind:?}"
        );
    }
}

#[cfg(target_os = "macos")]
fn set_xattr(p: &Path) {
    super::super::race_fixture::set_xattr(p, "com.mdpro.d112", b"x");
}

/// S3b: the same with an xattr write, the LaunchServices kind D32 drops.
#[cfg(target_os = "macos")]
#[test]
fn s3b_xattr_during_the_save_refresh_still_drops_the_own_event() {
    let d = TempDir::new("d112s3b");
    let written: &[u8] = b"beta beta\n";
    let (store, p) = registered(&d, b"alpha\n");
    replace_with(&p, written);

    refresh_with_metadata_change(&store, &p, written, set_xattr);

    assert_eq!(
        route(RENAMED, &[&p], &fresh(), &store),
        (Value::Null, IgnoredUnchanged)
    );
}

/// S3c: the refresh does not read the file at all (D112): the save already
/// knows the bytes. RED before D112: one `read_once`.
#[test]
fn s3c_save_refresh_does_no_read() {
    let d = TempDir::new("d112s3c");
    let written: &[u8] = b"beta beta\n";
    let (store, p) = registered(&d, b"alpha\n");
    replace_with(&p, written);

    let before = read_once_calls();
    store.refresh_after_save(&p, written);
    assert_eq!(read_once_calls() - before, 0, "the refresh read the file");
    assert_eq!(
        store.get(&p).and_then(|e| e.hash),
        Some(hash_bytes(written))
    );
    assert_eq!(store.get(&p).and_then(|e| e.stat), snapshot(&p).stat);
}

/// S4: an external write landing between our rename and the refresh. The
/// refresh stores the hash of what we wrote, not of the disk, so the next
/// event (the external writer's) emits, small or past the cap.
#[test]
fn s4_external_write_between_rename_and_refresh_emits() {
    let small: &[u8] = b"our saved bytes";
    let big = big_text().into_bytes();
    for (i, written) in [small, &big[..]].into_iter().enumerate() {
        let d = TempDir::new("d112s4");
        let (store, p) = registered(&d, b"before");
        replace_with(&p, written);
        fs::write(&p, b"external writer's bytes").expect("external write");

        store.refresh_after_save(&p, written);

        let stored = store.get(&p).expect("still registered");
        assert_eq!(stored.hash, Some(hash_bytes(written)), "case {i}");
        for kind in [RENAMED, EXTENDED] {
            assert_eq!(
                route(kind, &[&p], &fresh(), &store),
                (modified(&p), EmittedModified),
                "case {i}: {kind:?}"
            );
            store.refresh_after_save(&p, written);
        }
    }
}

/// S5 (structural pin): every non-save way to store an entry (register,
/// `refresh_if_present`, the open path's seed, `snapshot`) stores no hash
/// for content past the cap, so only a save can record a size the 10 MiB
/// read would not reach. At the cap each of them does hash.
#[test]
fn s5_no_non_save_path_stores_a_hash_past_the_cap() {
    let d = TempDir::new("d112s5");
    for (len, hashed) in [(CAP, true), (CAP + 1, false), (OVER, false)] {
        let p = d.path().join(format!("f{len}.md"));
        super::super::fixture::sparse(&p, len);
        let store = BaselineStore::default();
        store.register(&p);
        let registered = store.get(&p).expect("registered");
        store.refresh_if_present(&p);
        let refreshed = store.get(&p).expect("still registered");
        let (_, seed) = read_for_open(&p).expect("read for open");
        for (path, e) in [
            ("register", registered),
            ("refresh_if_present", refreshed),
            ("seed", seed),
            ("snapshot", snapshot(&p)),
        ] {
            assert_eq!(e.hash.is_some(), hashed, "{path} at {len}");
            assert_eq!(e.stat.map(|(_, size)| size), Some(len), "{path}");
        }
    }
}

/// S6: an entry no save recorded keeps the 10 MiB read cap. A registered
/// file that grows past the cap is not unchanged, and neither is an
/// over-cap file registered without a hash.
#[test]
fn s6_non_save_entry_never_reads_past_the_cap() {
    let d = TempDir::new("d112s6");
    let p = d.path().join("grow.md");
    super::super::fixture::sparse(&p, CAP);
    let store = BaselineStore::default();
    store.register(&p);
    assert!(
        store.is_unchanged(&p),
        "precondition: at the cap, unchanged"
    );
    append(&p, &[0]);
    assert!(!store.is_unchanged(&p), "grown past the cap");
    store.register(&p);
    assert_eq!(store.get(&p).and_then(|e| e.hash), None, "precondition");
    assert!(!store.is_unchanged(&p), "registered past the cap");
    assert_eq!(
        route(EXTENDED, &[&p], &fresh(), &store),
        (modified(&p), EmittedModified)
    );
}

/// S6b: the read API under `is_unchanged`. `coherent_read` keeps the hash
/// cap; `coherent_read_upto` reads a file of exactly `cap` bytes whole and
/// refuses one byte more.
#[test]
fn s6b_coherent_read_upto_honours_its_cap() {
    use super::super::read::{coherent_read, coherent_read_upto};
    let d = TempDir::new("d112s6b");
    let p = d.path().join("over.md");
    super::super::fixture::sparse(&p, OVER);
    assert_eq!(coherent_read(&p), None, "the hash cap still applies");
    let whole = coherent_read_upto(&p, OVER).map(|(stat, b)| (stat.1, b.len() as u64));
    assert_eq!(whole, Some((OVER, OVER)), "read whole at cap = size");
    assert_eq!(coherent_read_upto(&p, OVER - 1), None, "one byte over");
}
