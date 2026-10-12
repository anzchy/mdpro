//! D86 WI-3 (matrix: seed_write_between_read_and_register_emits,
//! reregister_overwrites_with_the_seed): a write landing after the open's
//! read surfaces once the open's seed is registered, and a register always
//! overwrites, seed or snapshot. macOS only (`FileWatcher::for_tests()`).
use super::file::{open_file_from_path, open_file_from_path_seeded};
use super::file_save_fixture::{canon, ev, Dir, CONTENT};
use crate::services::file_watcher::seed::kit;
use crate::services::file_watcher::{FileWatcher, WatchOutcome};
use std::fs;
use std::path::Path;

fn s(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// Finding ②. The contrast leg is today's open path (`open_file_from_path`
/// then a fresh-snapshot `watch`), which drops the write.
#[test]
fn seed_write_between_read_and_register_emits() {
    let d = Dir::new("between");
    let p = d.file("a.md", b"AAAA");
    let got = open_file_from_path_seeded(&s(&p), None);
    assert!(got.is_ok(), "{:?}", got.as_ref().err());
    let (r, seed) = got.expect("checked");
    kit::rewrite_keep_stat(&p, b"BBBB");
    let fw = FileWatcher::for_tests();
    fw.watch_seeded(&p, seed);
    let (emitted, outcome) = fw.route_for_tests(&ev(CONTENT, &canon(&p)));
    assert_eq!(r.document.content, "AAAA");
    let payload = serde_json::to_value(&emitted).expect("payload");
    assert_eq!(payload, kit::modified(&canon(&p)));
    assert_eq!(outcome, WatchOutcome::EmittedModified);

    let q = d.file("b.md", b"AAAA");
    let old = open_file_from_path(&s(&q), None).expect("open b");
    kit::rewrite_keep_stat(&q, b"BBBB");
    fw.watch(&q);
    let (emitted, outcome) = fw.route_for_tests(&ev(CONTENT, &canon(&q)));
    assert_eq!(old.document.content, "AAAA", "contrast");
    assert!(emitted.is_none(), "contrast: {emitted:?}");
    assert_eq!(outcome, WatchOutcome::IgnoredUnchanged, "contrast");
}

#[test]
fn reregister_overwrites_with_the_seed() {
    // Leg A: snapshot of "aaaa", then the seed of "bbbb".
    let d = Dir::new("rereg_a");
    let p = d.file("a.md", b"aaaa");
    let fw = FileWatcher::for_tests();
    fw.watch(&p);
    fs::write(&p, b"bbbb").expect("rewrite bbbb");
    let got = open_file_from_path_seeded(&s(&p), None);
    assert!(got.is_ok(), "A: {:?}", got.as_ref().err());
    let seed = got.expect("checked").1;
    fw.watch_seeded(&p, seed);
    assert_eq!(fw.baseline_of(&p), Some(seed), "A: the seed overwrote");
    assert_eq!(seed.hash, kit::h(b"bbbb"), "A");
    assert_eq!(fw.watched(), vec![s(&p)], "A: listed once");
    drop(d);

    // Leg B: the seed of "aaaa", then a snapshot of "bbbb".
    let d = Dir::new("rereg_b");
    let p = d.file("a.md", b"aaaa");
    let fw = FileWatcher::for_tests();
    let got = open_file_from_path_seeded(&s(&p), None);
    assert!(got.is_ok(), "B: {:?}", got.as_ref().err());
    let seed = got.expect("checked").1;
    assert_eq!(seed.hash, kit::h(b"aaaa"), "B: precondition");
    fw.watch_seeded(&p, seed);
    fs::write(&p, b"bbbb").expect("rewrite bbbb");
    fw.watch(&p);
    assert_eq!(fw.baseline_of(&p), Some(kit::snapshot(&p)), "B");
    assert_eq!(
        fw.baseline_of(&p).and_then(|e| e.hash),
        kit::h(b"bbbb"),
        "B"
    );
    assert_eq!(fw.watched(), vec![s(&p)], "B: listed once");
}
