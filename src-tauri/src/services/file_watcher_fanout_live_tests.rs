//! D185-WI-2, real FSEvents: with a document open at the alias spelling and
//! another at the real path, an external append reaches BOTH as
//! `file:changed`, through the production callback (`handle_event` in
//! `FileWatcher::for_tests_delivering`) and its fan-out. The backend half of
//! the row's "both tabs pending" (plan §4, Live).
//!
//! Mounted from file_watcher_fanout_tests.rs (itself `#[cfg(all(test,
//! target_os = "macos"))]`). Not ignored, like
//! file_watcher_holders_live_tests.rs: the case waits at most a few seconds
//! for the callback. `Dir` isolates
//! `$HOME`, where the callback logs; the watcher is declared after it, so it
//! stops before `$HOME` is restored.
use super::super::super::baseline::fixture::append;
use super::super::super::FileWatcher;
use crate::commands::file_save_fixture::{canon, Dir};
use std::path::Path;
use std::time::{Duration, Instant};

const W1: &str = "mdpro-w1";
const W2: &str = "mdpro-w2";
/// Time for a restarted FSEvents stream to settle before the write.
const SETTLE: Duration = Duration::from_millis(300);
/// How long the case waits for the copies it expects.
const DELIVER: Duration = Duration::from_secs(5);
/// Poll step while waiting.
const POLL: Duration = Duration::from_millis(50);

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn acquire(fw: &FileWatcher, label: &str, p: &Path) {
    let r = fw.reserve_hold(label, p).expect("may acquire");
    fw.watch(p);
    assert!(fw.confirm_hold(&r), "{label}: the hold on {p:?} is current");
}

#[test]
fn d185_wi2_live_a_external_append_reaches_alias_and_real_spellings() {
    let d = Dir::new("d185_live_a");
    let real = d.path().join("real");
    std::fs::create_dir(&real).expect("create real dir");
    std::os::unix::fs::symlink(&real, d.path().join("alias")).expect("symlink alias -> real");
    std::fs::write(real.join("a.md"), b"one\n").expect("write");
    let canonical = canon(&real.join("a.md"));
    let aliased = d.path().join("alias").join("a.md");
    assert_ne!(s(&canonical), s(&aliased), "precondition: two spellings");

    let (fw, rec) = FileWatcher::for_tests_delivering();
    acquire(&fw, W1, &aliased);
    acquire(&fw, W2, &canonical);
    std::thread::sleep(SETTLE);
    let before = rec.sent_plain().len();

    append(&canonical, b" two\n");
    let deadline = Instant::now() + DELIVER;
    let has = |copies: &[super::super::super::FileChangedEvent], p: &Path| {
        copies
            .iter()
            .any(|e| e.path == s(p) && e.change_type == "modified")
    };
    let mut copies = Vec::new();
    while Instant::now() < deadline {
        copies = rec.sent_plain().split_off(before);
        if has(&copies, &canonical) && has(&copies, &aliased) {
            break;
        }
        std::thread::sleep(POLL);
    }
    assert!(
        has(&copies, &canonical),
        "non-vacuity: the real path is delivered as today: {copies:?}"
    );
    assert!(
        has(&copies, &aliased),
        "the alias document's spelling gets its own file:changed: {copies:?}"
    );
    let stamp = |p: &Path| {
        copies
            .iter()
            .find(|e| e.path == s(p) && e.change_type == "modified")
            .map(|e| e.timestamp)
    };
    assert_eq!(
        stamp(&canonical),
        stamp(&aliased),
        "both copies of one event share its timestamp: {copies:?}"
    );
    drop(fw);
}
