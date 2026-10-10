//! D32 WI-6 (matrix S1–S4, S6, S7): `save_file_with` refreshes the D32
//! baseline of an already-registered path right after a successful
//! `atomic_write`, and never otherwise (ADR-0068 decision 4). macOS only:
//! every case builds a real `FileWatcher::for_tests()` (FSEvents), like the
//! other consumers of that fixture. The save-then-burst cases (S10) and the
//! D68 rename bearing are in `file_save_burst_tests.rs`.
use super::file_save_fixture::{canon, chmod, ev, hash_of, save, save_as, Dir, CONTENT, EXTENDED};
use crate::services::file_watcher::{snapshot, FileWatcher, WatchOutcome};
use std::fs;

/// S1: after a save, a late Extended event for our own write compares against
/// the saved bytes and is dropped. RED before the fix: `EmittedModified`.
#[tokio::test]
async fn s1_successful_atomic_save_refreshes_baseline_before_a_late_event() {
    let d = Dir::new("s1");
    let p = d.file("doc.md", b"alpha\n");
    let fw = FileWatcher::for_tests();
    fw.watch(&p);

    let res = save(&p, "beta beta\n", fw.baselines()).await.expect("save");

    assert!(res.success);
    assert_eq!(res.path, p.to_string_lossy());
    assert_eq!(
        fs::read(&p).unwrap(),
        b"beta beta\n",
        "precondition: saved bytes"
    );
    assert_eq!(
        fw.baseline_of(&p),
        Some(snapshot(&p)),
        "baseline is the disk"
    );
    assert_eq!(snapshot(&p).hash, hash_of(b"beta beta\n"));
    let (emitted, outcome) = fw.route_for_tests(&ev(EXTENDED, &canon(&p)));
    assert!(emitted.is_none(), "{emitted:?}");
    assert_eq!(outcome, WatchOutcome::IgnoredUnchanged);
}

/// S2 (S4 over the save-option domain): the refreshed baseline is the disk
/// bytes, never the editor text, for every encoding x line ending.
#[tokio::test]
async fn s2_baseline_after_save_is_the_disk_bytes_for_every_encoding_and_line_ending() {
    let content = "a\nb\n";
    let editor_hash = hash_of(content.as_bytes());
    for encoding in [None, Some("UTF-16LE")] {
        for line_ending in [None, Some("lf"), Some("crlf")] {
            let cell = format!("{encoding:?} x {line_ending:?}");
            let d = Dir::new("s2");
            let p = d.file("doc.md", b"zz");
            let fw = FileWatcher::for_tests();
            fw.watch(&p);

            save_as(&p, content, encoding, line_ending, fw.baselines())
                .await
                .unwrap_or_else(|e| panic!("{cell}: save failed: {e:?}"));

            let disk = snapshot(&p);
            assert_eq!(fw.baseline_of(&p), Some(disk), "{cell}");
            assert_eq!(disk.hash, hash_of(&fs::read(&p).unwrap()), "{cell}");
            if encoding.is_some() || line_ending == Some("crlf") {
                assert_ne!(
                    disk.hash, editor_hash,
                    "{cell}: precondition, disk != editor text"
                );
            }
        }
    }
}

/// S3: a failed save moves nothing, even when the disk moved since the
/// registration (without the external write this case would be vacuous).
#[tokio::test]
async fn s3_failed_save_does_not_refresh_even_when_disk_moved() {
    let d = Dir::new("s3");
    let p = d.file("doc.md", b"alpha");
    let fw = FileWatcher::for_tests();
    fw.watch(&p);
    let e_a = fw.baseline_of(&p).expect("registered");
    fs::write(&p, b"gamma-gamma").unwrap();
    let e_c = snapshot(&p);
    assert_ne!(e_c, e_a, "precondition: the disk moved");

    chmod(d.path(), 0o500);
    let res = save(&p, "beta", fw.baselines()).await;
    chmod(d.path(), 0o700);

    assert!(res.is_err(), "read-only dir must fail the save: {res:?}");
    assert_eq!(fw.baseline_of(&p), Some(e_a), "baseline untouched");
    assert_ne!(fw.baseline_of(&p), Some(e_c));
    assert_eq!(fs::read(&p).unwrap(), b"gamma-gamma", "file untouched");
}

/// S4: the failed save still clears the self-write mark, so the next real
/// content event emits instead of reading as our own write.
#[tokio::test]
async fn s4_failed_save_still_clears_the_self_write_mark() {
    let d = Dir::new("s4");
    let p = d.file("doc.md", b"alpha");
    let fw = FileWatcher::for_tests();
    fw.watch(&p);
    fs::write(&p, b"gamma-gamma").unwrap();

    chmod(d.path(), 0o500);
    let res = save(&p, "beta", fw.baselines()).await;
    chmod(d.path(), 0o700);
    assert!(res.is_err(), "precondition: the save failed: {res:?}");

    let (emitted, outcome) = fw.route_for_tests(&ev(CONTENT, &canon(&p)));
    assert_eq!(outcome, WatchOutcome::EmittedModified);
    assert!(emitted.is_some());
}

/// S6: a save to a path nobody watches creates no baseline.
#[tokio::test]
async fn s6_save_to_unregistered_path_creates_no_baseline() {
    let d = Dir::new("s6");
    let p = d.path().join("new.md");
    let fw = FileWatcher::for_tests();

    let res = save(&p, "fresh", fw.baselines()).await;

    assert!(res.is_ok(), "{res:?}");
    assert_eq!(fs::read(&p).unwrap(), b"fresh");
    assert_eq!(fw.baselines().len(), 0, "no entry for an unwatched path");
    assert_eq!(fw.baseline_of(&p), None);
}

/// S7: registering through one spelling and saving through the other
/// refreshes the single canonical entry, in both directions.
#[tokio::test]
async fn s7_save_via_alias_refreshes_the_single_canonical_entry() {
    for (row, watch_alias) in [("a: watch alias", true), ("b: watch real", false)] {
        let d = Dir::new("s7");
        let real = d.path().join("real");
        let alias = d.path().join("alias");
        fs::create_dir(&real).unwrap();
        std::os::unix::fs::symlink(&real, &alias).unwrap();
        let (real_p, alias_p) = (real.join("x.md"), alias.join("x.md"));
        fs::write(&real_p, b"old").unwrap();
        let (watched, saved) = if watch_alias {
            (&alias_p, &real_p)
        } else {
            (&real_p, &alias_p)
        };
        let fw = FileWatcher::for_tests();
        fw.watch(watched);

        save(saved, "new bytes", fw.baselines()).await.expect(row);

        assert_eq!(fw.baselines().len(), 1, "{row}");
        assert_eq!(snapshot(&real_p).hash, hash_of(b"new bytes"), "{row}");
        assert_eq!(fw.baseline_of(&real_p), Some(snapshot(&real_p)), "{row}");
        assert_eq!(fw.baseline_of(&alias_p), Some(snapshot(&real_p)), "{row}");
    }
}
