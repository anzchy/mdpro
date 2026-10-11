//! D69: a Save As through `save_as_watched_with` registers the chosen path
//! with the real `FileWatcher`, seeded from the bytes the save wrote, and
//! only when the save succeeded. Real files, the real save path and a real
//! notify watcher (`FileWatcher::for_tests()`); nothing is mocked. The
//! external write between the save and the register lands through the
//! module's test-only `hook`. macOS only, like the other save suites.
use super::hook;
use super::save_as_watched_with;
use crate::commands::file::{FileError, SaveResult};
use crate::commands::file_save_fixture::{canon, chmod, ev, Dir, CONTENT};
use crate::services::file_watcher::seed::kit;
use crate::services::file_watcher::{FileWatcher, WatchOutcome};
use std::fs;
use std::path::Path;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Save As `content` to `p` with the default (UTF-8, LF) options.
async fn save_as(p: &Path, content: &str, fw: &FileWatcher) -> Result<SaveResult, FileError> {
    save_as_watched_with(
        "d1".into(),
        content.into(),
        s(p),
        None,
        None,
        None,
        fw,
    )
    .await
}

/// a: a successful Save As to a new path registers that exact path string,
/// with a baseline entry.
#[tokio::test]
async fn d69_a_save_as_to_a_new_path_is_watched_with_a_baseline() {
    let d = Dir::new("d69a");
    let p = d.path().join("new.md");
    assert!(!p.exists(), "precondition: a new path");
    assert_ne!(s(&canon(d.path())), s(d.path()), "precondition: non-canonical");
    let fw = FileWatcher::for_tests();

    let r = save_as(&p, "hello\n", &fw).await.expect("save as");

    assert_eq!(r.path, s(&p), "SaveResult.path is the dialog string");
    assert_eq!(fw.watched(), vec![r.path.clone()], "registered by r.path");
    assert!(fw.baseline_of(&p).is_some(), "a baseline entry");
    fw.unwatch(Path::new(&r.path));
    assert_eq!(fw.watched(), Vec::<String>::new(), "close_document's unwatch");
    assert_eq!(fw.baseline_of(&p), None, "and its baseline goes with it");
}

/// b: the baseline is the written bytes (CRLF + UTF-16LE, so not the editor
/// text): the untouched file is unchanged, an external write is not.
#[tokio::test]
async fn d69_b_the_baseline_is_the_written_bytes() {
    let d = Dir::new("d69b");
    let p = d.path().join("doc.md");
    let fw = FileWatcher::for_tests();

    save_as_watched_with(
        "d1".into(),
        "a\nb\n".into(),
        s(&p),
        Some("UTF-16LE".into()),
        Some("crlf".into()),
        None,
        &fw,
    )
    .await
    .expect("save as");

    let disk = fs::read(&p).expect("read back");
    let entry = fw.baseline_of(&p).expect("a baseline entry");
    assert_eq!(entry.hash, kit::h(&disk), "hash of the written bytes");
    assert_ne!(entry.hash, kit::h(b"a\nb\n"), "not the editor text");
    assert_eq!(entry.stat.map(|s| s.1), Some(disk.len() as u64));
    assert!(fw.baselines().is_unchanged(&p), "untouched file is unchanged");
    let (emitted, outcome) = fw.route_for_tests(&ev(CONTENT, &canon(&p)));
    assert!(emitted.is_none(), "{emitted:?}");
    assert_eq!(outcome, WatchOutcome::IgnoredUnchanged);

    fs::write(&p, b"external, other bytes").expect("external write");
    assert!(!fw.baselines().is_unchanged(&p), "an external write is a change");
    let (emitted, outcome) = fw.route_for_tests(&ev(CONTENT, &canon(&p)));
    assert!(emitted.is_some());
    assert_eq!(outcome, WatchOutcome::EmittedModified);
}

/// c: an external write landing after the save and before the register is
/// not baselined. Leg 1 keeps the stat (same length and mtime), so only the
/// hash can tell; a re-snapshot (`watch`) would store the external bytes and
/// call the file unchanged. Leg 2 changes the length (D129): the seed stores
/// no stat, so the check fails open.
#[tokio::test]
async fn d69_c_a_write_between_save_and_register_is_not_baselined() {
    let d = Dir::new("d69c");
    let p = d.path().join("same.md");
    let fw = FileWatcher::for_tests();
    let q = p.clone();
    let guard = hook::install(move || kit::rewrite_keep_stat(&q, b"BBBB"));
    save_as(&p, "AAAA", &fw).await.expect("save as");
    drop(guard);

    assert_eq!(fs::read(&p).unwrap(), b"BBBB", "precondition: hook ran");
    assert_eq!(fw.watched(), vec![s(&p)], "leg 1: watched");
    let entry = fw.baseline_of(&p).expect("leg 1: a baseline entry");
    assert_eq!(entry.hash, kit::h(b"AAAA"), "leg 1: our bytes, not theirs");
    assert!(!fw.baselines().is_unchanged(&p), "leg 1: a change");
    let (emitted, outcome) = fw.route_for_tests(&ev(CONTENT, &canon(&p)));
    assert!(emitted.is_some(), "leg 1");
    assert_eq!(outcome, WatchOutcome::EmittedModified, "leg 1");

    let p2 = d.path().join("longer.md");
    let fw = FileWatcher::for_tests();
    let q = p2.clone();
    let guard = hook::install(move || fs::write(&q, b"a much longer external body").unwrap());
    save_as(&p2, "AAAA", &fw).await.expect("save as");
    drop(guard);

    assert_eq!(fw.watched(), vec![s(&p2)], "leg 2: watched");
    let entry = fw.baseline_of(&p2).expect("leg 2: a baseline entry");
    assert_eq!(entry.stat, None, "leg 2: a size we never wrote is not stored");
    assert_eq!(entry.hash, kit::h(b"AAAA"), "leg 2: our bytes");
    assert!(!fw.baselines().is_unchanged(&p2), "leg 2: fails open");
}

/// d: a failed save registers nothing, stores no baseline, leaves other
/// registrations alone and returns the error unchanged.
#[tokio::test]
async fn d69_d_a_failed_save_as_leaves_the_watcher_untouched() {
    let d = Dir::new("d69d");
    let other = d.file("other.md", b"o");
    let ro = d.path().join("ro");
    fs::create_dir(&ro).unwrap();
    chmod(&ro, 0o500);
    let rows = [
        ("missing dir", d.path().join("nope").join("x.md")),
        ("read-only dir", ro.join("x.md")),
        ("bad extension", d.path().join("x.png")),
    ];
    for (label, target) in rows {
        let fw = FileWatcher::for_tests();
        fw.watch(&other);
        let before = fw.watched();

        let got = save_as(&target, "body", &fw).await;

        assert!(got.is_err(), "{label}: {got:?}");
        assert!(!target.exists(), "{label}: nothing written");
        assert_eq!(fw.watched(), before, "{label}: list untouched");
        assert_eq!(fw.baseline_of(&target), None, "{label}: no baseline");
        assert!(fw.baseline_of(&other).is_some(), "{label}: other kept");
    }
    let fw = FileWatcher::for_tests();
    let got = save_as(&d.path().join("x.png"), "body", &fw).await;
    assert!(
        matches!(got, Err(FileError::InvalidPath { .. })),
        "the save's own error: {got:?}"
    );
    chmod(&ro, 0o700);
}

/// e: a Save As past `HASH_CAP_BYTES` is baselined in full and reads back
/// as unchanged (D112's uncapped rule, kept for the seed).
#[tokio::test]
async fn d69_e_a_save_as_over_the_hash_cap_reads_back_unchanged() {
    const LINE: &str = "0123456789abcde\n";
    let over = kit::HASH_CAP_BYTES + 4096;
    let text = LINE.repeat((over / LINE.len() as u64) as usize);
    let d = Dir::new("d69e");
    let p = d.path().join("big.md");
    let fw = FileWatcher::for_tests();

    save_as(&p, &text, &fw).await.expect("save as");

    assert_eq!(fs::metadata(&p).unwrap().len(), over, "precondition");
    let entry = fw.baseline_of(&p).expect("a baseline entry");
    assert!(entry.hash.is_some(), "hashed past the cap");
    assert_eq!(entry.stat.map(|s| s.1), Some(over));
    assert!(fw.baselines().is_unchanged(&p), "own Save As is unchanged");
}
