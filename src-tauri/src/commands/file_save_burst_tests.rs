//! D32 WI-6 (matrix S10, scope amendment 2026-10-10) and the D68 bearing:
//! after `save_file_with`, the residual FSEvents burst on the unchanged file
//! (Metadata(Any), Extended, Content) is dropped against the refreshed
//! baseline with no emit and no debounce entry; a failed save leaves the
//! baseline as it was; and the refresh reads the final path after the
//! temp-file rename, not the temp file (ADR-0068 decision 4). macOS only,
//! for `FileWatcher::for_tests()`.
use super::file_save_fixture::{canon, chmod, ev, hash_of, save, Dir, CONTENT, EXTENDED, META_ANY};
use crate::services::file_watcher::{snapshot, FileWatcher, WatchOutcome};
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

fn burst(p: &Path) -> Vec<notify::Event> {
    [META_ANY, EXTENDED, CONTENT]
        .into_iter()
        .map(|kind| ev(kind, p))
        .collect()
}

/// S10: save, then the residual burst: every event `IgnoredUnchanged`, zero
/// emits, zero debounce entries, and the baseline does not move.
#[tokio::test]
async fn s10_save_then_residual_burst_is_dropped_with_no_emit_and_no_debounce() {
    let d = Dir::new("s10");
    let p = d.file("doc.md", b"alpha\n");
    let fw = FileWatcher::for_tests();
    fw.watch(&p);

    save(&p, "beta beta\n", fw.baselines()).await.expect("save");
    let after_save = fw.baseline_of(&p);
    assert_eq!(after_save, Some(snapshot(&p)), "refreshed to the disk");

    let (routed, debounce_left) = fw.route_burst_for_tests(&burst(&canon(&p)));

    let outcomes: Vec<WatchOutcome> = routed.iter().map(|(_, o)| *o).collect();
    assert_eq!(outcomes, vec![WatchOutcome::IgnoredUnchanged; 3]);
    assert!(routed.iter().all(|(e, _)| e.is_none()), "zero emits");
    assert_eq!(
        debounce_left, 0,
        "a dropped event records no debounce entry"
    );
    assert_eq!(fw.baseline_of(&p), after_save, "the burst advances nothing");
}

/// S10 (failure side): a failed save leaves the baseline exactly as `watch`
/// recorded it, so the same burst on the untouched file still drops.
#[tokio::test]
async fn s10_failed_save_leaves_baseline_untouched_and_burst_still_drops() {
    let d = Dir::new("s10f");
    let p = d.file("doc.md", b"alpha\n");
    let fw = FileWatcher::for_tests();
    fw.watch(&p);
    let registered = fw.baseline_of(&p).expect("registered");

    chmod(d.path(), 0o500);
    let res = save(&p, "beta beta\n", fw.baselines()).await;
    chmod(d.path(), 0o700);
    assert!(res.is_err(), "precondition: the save failed: {res:?}");

    assert_eq!(fw.baseline_of(&p), Some(registered), "baseline untouched");
    assert_eq!(fs::read(&p).unwrap(), b"alpha\n");
    let (routed, debounce_left) = fw.route_burst_for_tests(&burst(&canon(&p)));
    assert!(routed
        .iter()
        .all(|(e, o)| e.is_none() && *o == WatchOutcome::IgnoredUnchanged));
    assert_eq!(debounce_left, 0);
}

/// D68 bearing: `atomic_write` renames a fresh temp inode onto the final
/// path. The refresh runs after the rename, on the final path, so the entry
/// carries the new inode's mtime, size and bytes, and no temp file remains.
#[tokio::test]
async fn s1_d68_refresh_reads_the_renamed_final_file_not_the_temp() {
    let d = Dir::new("d68");
    let p = d.file("doc.md", b"alpha\n");
    let fw = FileWatcher::for_tests();
    fw.watch(&p);
    let inode_before = fs::metadata(&p).unwrap().ino();

    save(&p, "beta beta beta\n", fw.baselines())
        .await
        .expect("save");

    let meta = fs::metadata(&p).unwrap();
    assert_ne!(
        meta.ino(),
        inode_before,
        "precondition: the save renamed a new inode in"
    );
    let entry = fw.baseline_of(&p).expect("still registered");
    assert_eq!(entry.stat, Some((meta.modified().unwrap(), meta.len())));
    assert_eq!(entry.hash, hash_of(b"beta beta beta\n"));
    let leftovers: Vec<_> = fs::read_dir(d.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .filter(|n| n.to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "no temp file survives: {leftovers:?}");
}
