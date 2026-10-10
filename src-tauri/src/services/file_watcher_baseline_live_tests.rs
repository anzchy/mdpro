//! D32 WI-5 (matrix L1-L5): `FileWatcher::watch` / `unwatch` keep the
//! watcher's own baseline store in step with the watch list (ADR-0068
//! decisions 4 and 5). Real notify watcher (`for_tests`), real temp files;
//! routing uses hand-built events through the real `process_event` with the
//! fixture's store (FS1 / FS2 are the real-FSEvents pair).
//!
//! Every case runs under `TempHome`: `watch` / `unwatch` log through the real
//! logger, which writes to `$HOME/.mdpro/mdpro.log`.
use super::super::{FileWatcher, WatchOutcome};
use super::fixture::{ev, TempDir, CONTENT, EXTENDED};
use super::{snapshot, Entry};
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use std::fs;
use std::path::{Path, PathBuf};

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft/draft_test_home.rs"]
mod draft_test_home;
use draft_test_home::TempHome;

use WatchOutcome::{EmittedModified, IgnoredUnchanged};

fn home(label: &str) -> TempHome {
    TempHome::new(&format!("d32_wi5_{label}_{}", std::process::id()))
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn outcome(fw: &FileWatcher, kind: notify::EventKind, p: &Path) -> WatchOutcome {
    fw.route_for_tests(&ev(kind, &[p])).1
}

/// L1: re-`watch` overwrites with a fresh snapshot, and is idempotent on an
/// unchanged file; the watch list keeps f1's ordered-set model.
#[test]
fn l1_re_register_overwrites_with_a_fresh_snapshot() {
    let _home = home("l1");
    let d = TempDir::new("l1");
    let p = d.file("a.md", b"a");
    let snapshot_a = snapshot(&p);
    let fw = FileWatcher::for_tests();

    fw.watch(&p);
    let e1 = fw.baseline_of(&p);
    assert_eq!(e1, Some(snapshot_a), "watch registers the snapshot");
    fw.watch(&p);
    let e2 = fw.baseline_of(&p);
    assert_eq!(
        e2, e1,
        "re-watch of an unchanged file leaves the same entry"
    );

    fs::write(&p, b"bb").expect("rewrite");
    fw.watch(&p);
    let e3 = fw.baseline_of(&p);
    assert_eq!(
        e3,
        Some(snapshot(&p)),
        "re-watch overwrites with a fresh snapshot"
    );
    assert_ne!(e3, e1, "the overwrite is visible");
    assert_eq!(fw.watched(), vec![s(&p)]);
    assert_eq!(fw.baselines().len(), 1);
}

/// L2: `unwatch` removes the entry; a late event then fails open and does not
/// resurrect it.
#[test]
fn l2_unwatch_removes_the_entry_and_a_late_event_fails_open() {
    let _home = home("l2");
    let d = TempDir::new("l2");
    let p = d.file("a.md", b"abc");
    let canonical = fs::canonicalize(&p).expect("canonicalize");
    let fw = FileWatcher::for_tests();

    fw.watch(&p);
    assert!(
        fw.baseline_of(&p).is_some(),
        "precondition: watch registered"
    );
    assert_eq!(
        outcome(&fw, EXTENDED, &canonical),
        IgnoredUnchanged,
        "precondition: the registered entry drops an unchanged Extended"
    );
    fw.unwatch(&p);
    assert_eq!(fw.baseline_of(&p), None, "unwatch removes the entry");

    assert_eq!(outcome(&fw, EXTENDED, &canonical), EmittedModified);
    let _ = outcome(&fw, CONTENT, &p);
    assert_eq!(fw.baseline_of(&p), None, "no resurrection by a late event");
    assert_eq!(fw.baselines().len(), 0);
}

/// Removes the literal `/tmp` file on drop.
struct Cleanup(PathBuf);

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// L3: a watch on literal `/tmp/…` and events on `/private/tmp/…` share one
/// baseline (the device-observed form); the watch list keeps the raw string.
#[test]
fn l3_tmp_and_private_tmp_aliases_share_one_baseline() {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let _home = home("l3");
    let n = N.fetch_add(1, Ordering::Relaxed);
    let raw = PathBuf::from(format!("/tmp/mdpro_d32_{}_{n}.md", std::process::id()));
    fs::write(&raw, b"abc").expect("write /tmp file");
    let _cleanup = Cleanup(raw.clone());
    let private = Path::new("/private").join(raw.strip_prefix("/").unwrap());
    assert_eq!(
        fs::canonicalize(&raw).expect("canonicalize"),
        private,
        "precondition: /tmp resolves to /private/tmp"
    );
    let fw = FileWatcher::for_tests();

    fw.watch(&raw);
    assert_eq!(outcome(&fw, EXTENDED, &private), IgnoredUnchanged);
    let first = fw.baseline_of(&private);
    assert!(first.is_some(), "an entry is visible through /private/tmp");
    assert_eq!(first, fw.baseline_of(&raw), "one entry for both spellings");

    fs::write(&raw, b"abcd").expect("real write");
    assert_eq!(outcome(&fw, CONTENT, &private), EmittedModified);
    assert_eq!(
        fw.baseline_of(&raw),
        Some(snapshot(&raw)),
        "the canonical refresh hit the raw registration"
    );
    assert_ne!(fw.baseline_of(&raw), first);
    assert_eq!(outcome(&fw, EXTENDED, &raw), IgnoredUnchanged);
    assert!(fw.watched().contains(&s(&raw)), "raw key in the watch list");
    assert_eq!(fw.baselines().len(), 1);
}

/// L4: watching a missing file still registers (presence means registered),
/// with no stat, and an event once it exists fails open.
#[test]
fn l4_watch_of_missing_file_registers_without_stat_and_fails_open() {
    let _home = home("l4");
    let d = TempDir::new("l4");
    let m = d.path().join("missing.md");
    let fw = FileWatcher::for_tests();

    fw.watch(&m);
    assert_eq!(
        fw.baseline_of(&m),
        Some(Entry {
            stat: None,
            hash: None
        })
    );
    fs::write(&m, b"abc").expect("create");
    assert_eq!(outcome(&fw, EXTENDED, &m), EmittedModified);
}

/// L5: `unwatch` clears the entry `watch` made even when the file appeared
/// or vanished in between (the `/var` -> `/private/var` key change is real
/// under `temp_dir()`); a re-watch replaces, never duplicates.
#[test]
fn l5_unwatch_removes_the_entry_even_when_the_file_appeared_or_vanished_since_watch() {
    let _home = home("l5");
    let d = TempDir::new("l5");
    let fw = FileWatcher::for_tests();

    // (a) missing at watch (raw key), present at unwatch.
    let m = d.path().join("appears.md");
    fw.watch(&m);
    assert_eq!(fw.baselines().len(), 1, "precondition (a): registered");
    fs::write(&m, b"abc").expect("create");
    fw.unwatch(&m);
    assert_eq!(fw.baselines().len(), 0, "(a)");

    // (b) present at watch (canonical key), missing at unwatch.
    let p = d.file("vanishes.md", b"abc");
    fw.watch(&p);
    assert_eq!(fw.baselines().len(), 1, "precondition (b): registered");
    fs::remove_file(&p).expect("delete");
    fw.unwatch(&p);
    assert_eq!(fw.baselines().len(), 0, "(b)");

    // (c) missing at watch, present at the re-watch.
    let c = d.path().join("rewatched.md");
    fw.watch(&c);
    fs::write(&c, b"abc").expect("create");
    fw.watch(&c);
    assert_eq!(fw.baselines().len(), 1, "(c) re-watch replaces the old key");
    assert_eq!(fw.baseline_of(&c), Some(snapshot(&c)));
    fw.unwatch(&c);
    assert_eq!(fw.baselines().len(), 0, "(c)");
}
