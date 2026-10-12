//! D173-WI-1, real FSEvents (plan r2 §1, §7 live tests). These observe the
//! notify callback itself (`for_tests_recording`), because the list and the
//! baseline can survive while delivery is lost (Codex finding 5, 10).
//!
//! Direction (delegator ruling, 2026-10-12): frontend delivery is pinned
//! only for the canonical spelling surviving an alias release. When the
//! alias survives, `live_c` pins the backend half only (the group and the
//! notify watch stay, the callback still fires); delivery to the alias
//! document is a recorded limit and belongs to D185.
//!
//! Wired `#[cfg(all(test, target_os = "macos"))]` from
//! file_watcher_holders.rs. Not ignored: each case waits at most a few
//! seconds for the callback.
use super::super::baseline::fixture::{alias_pair, append, TempDir};
use super::super::{FileWatcher, WatchOutcome};
use super::ReleaseOutcome::{BackendReleased, UnclaimedRaw};
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use notify::Event;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft/draft_test_home.rs"]
mod draft_test_home;
use draft_test_home::TempHome;

const W1: &str = "mdpro-w1";
const W2: &str = "mdpro-w2";
/// Time for a restarted FSEvents stream to settle before the write.
const SETTLE: Duration = Duration::from_millis(300);
/// How long a case waits for an event it expects.
const DELIVER: Duration = Duration::from_secs(5);
/// How long a case waits to be sure an event does not come.
const SILENCE: Duration = Duration::from_secs(3);

/// The committed payload the frontend alias test feeds to its store.
const PAYLOAD_FIXTURE: &str = include_str!("../../../tests/fixtures/d173-alias-payload.json");

fn home(label: &str) -> TempHome {
    TempHome::new(&format!("d173_live_{label}_{}", std::process::id()))
}

fn acquire(fw: &FileWatcher, label: &str, p: &Path) -> u64 {
    let r = fw.reserve_hold(label, p).expect("may acquire");
    fw.watch(p);
    fw.confirm_hold(&r);
    r.gen
}

/// `(dir, canonical, alias)` for one file reached through a directory
/// symlink, with the file written.
fn alias_file(label: &str) -> (TempDir, PathBuf, PathBuf) {
    let (d, real, alias) = alias_pair(label);
    let canonical = std::fs::canonicalize(&real).expect("real dir").join("a.md");
    std::fs::write(&canonical, b"one").expect("write");
    let aliased = alias.join("a.md");
    assert_ne!(canonical, aliased, "precondition: two spellings");
    (d, canonical, aliased)
}

/// Drain whatever the stream has already delivered (the registers' own
/// events), then wait out the stream restart.
fn settle(rx: &Receiver<Event>) {
    std::thread::sleep(SETTLE);
    while rx.try_recv().is_ok() {}
}

/// Every event delivered within `wait` that names `target` (by canonical
/// path), stopping early at the first one when `first_only`.
fn events_for(rx: &Receiver<Event>, target: &Path, wait: Duration, first_only: bool) -> Vec<Event> {
    let deadline = Instant::now() + wait;
    let mut out = Vec::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        let Ok(event) = rx.recv_timeout(left) else { break };
        let hits = event
            .paths
            .iter()
            .any(|p| std::fs::canonicalize(p).ok().as_deref() == Some(target) || p == target);
        if hits {
            out.push(event);
            if first_only {
                break;
            }
        }
    }
    out
}

/// Non-vacuity: with both spellings registered, a write IS delivered, so a
/// later silence means the watch went, not that the stream never reports.
fn assert_delivers(rx: &Receiver<Event>, target: &Path, tag: &str) {
    settle(rx);
    append(target, b" control");
    let heard = events_for(rx, target, DELIVER, true);
    assert!(!heard.is_empty(), "{tag}: control write was not delivered");
    std::thread::sleep(SETTLE);
    while rx.try_recv().is_ok() {}
}

/// live_a (characterisation of notify 6.1.1, plan §1): with the LEGACY
/// raw-spelling API, unwatching the alias removes the canonical
/// `recursive_info` entry, and the canonical spelling hears nothing more.
/// This pins why the holders own the backend watch per group; it passes
/// before and after D173 by design.
#[test]
fn d173_wi1_live_a_notify_canonical_removal_characterisation() {
    let _home = home("a");
    let (_d, canonical, aliased) = alias_file("d173la");
    let (fw, rx) = FileWatcher::for_tests_recording();
    fw.watch(&aliased);
    fw.watch(&canonical);
    assert_delivers(&rx, &canonical, "live_a");
    fw.unwatch(&aliased);
    settle(&rx);
    append(&canonical, b" two");
    let heard = events_for(&rx, &canonical, SILENCE, true);
    assert!(
        heard.is_empty(),
        "notify changed: unwatching the alias no longer silences the canonical spelling: {heard:?}"
    );
}

/// live_b: windows hold the alias and the canonical spelling; the alias's
/// window releases. The callback still delivers the canonical (real) path,
/// and routing it gives `EmittedModified`, shaped as the committed fixture
/// the frontend test uses.
#[test]
fn d173_wi1_live_b_alias_release_keeps_delivery() {
    let _home = home("b");
    let (_d, canonical, aliased) = alias_file("d173lb");
    let (fw, rx) = FileWatcher::for_tests_recording();
    let ga = acquire(&fw, W1, &aliased);
    acquire(&fw, W2, &canonical);
    assert_eq!(fw.release_hold(W1, &aliased, ga), UnclaimedRaw);
    settle(&rx);
    append(&canonical, b" two");
    let heard = events_for(&rx, &canonical, DELIVER, false);
    assert!(!heard.is_empty(), "the callback delivered nothing after the alias release");
    assert!(
        heard.iter().flat_map(|e| e.paths.iter()).any(|p| p == &canonical),
        "notify reports the real path: {heard:?}"
    );
    let routed: Vec<_> = heard.iter().map(|e| fw.route_for_tests(e)).collect();
    let emitted = routed
        .iter()
        .find(|(_, o)| *o == WatchOutcome::EmittedModified)
        .and_then(|(e, _)| e.clone())
        .unwrap_or_else(|| panic!("no EmittedModified among {routed:?}"));
    assert_eq!(emitted.path, canonical.to_string_lossy());
    let got = serde_json::to_value(&emitted).expect("json");
    let want: serde_json::Value = serde_json::from_str(PAYLOAD_FIXTURE).expect("fixture json");
    let keys = |v: &serde_json::Value| {
        let mut k: Vec<String> = v.as_object().expect("object").keys().cloned().collect();
        k.sort();
        k
    };
    assert_eq!(keys(&got), keys(&want), "the fixture has the payload's shape");
    assert_eq!(got["changeType"], want["changeType"]);
}

/// live_c (BLOCK 5's core, backend half only): windows hold the alias and
/// the canonical spelling; the CANONICAL spelling's window releases. The
/// group keeps a consumer, so there is no backend release: the group and
/// the notify watch stay, and an external write still reaches the notify
/// callback. Delivery to the alias document is D185 and is not asserted.
#[test]
fn d173_wi1_live_c_canonical_release_keeps_backend_watch() {
    let _home = home("c");
    let (_d, canonical, aliased) = alias_file("d173lc");
    let (fw, rx) = FileWatcher::for_tests_recording();
    acquire(&fw, W1, &aliased);
    let gb = acquire(&fw, W2, &canonical);
    assert_eq!(fw.release_hold(W2, &canonical, gb), UnclaimedRaw, "no backend release");
    {
        let map = fw.holders.map.lock().unwrap_or_else(|e| e.into_inner());
        let group = map
            .groups
            .values()
            .find(|g| g.consumers.contains_key(&aliased))
            .expect("the group still exists");
        assert_eq!(group.consumers.len(), 1, "the alias is its one consumer");
        assert!(
            group.notify_spellings.contains(&aliased),
            "the alias's notify spelling is kept"
        );
    }
    assert_eq!(fw.watched(), vec![aliased.to_string_lossy().into_owned()]);
    settle(&rx);
    append(&canonical, b" two");
    let heard = events_for(&rx, &canonical, DELIVER, true);
    assert!(!heard.is_empty(), "the callback lost the file after the canonical release");
    assert!(
        heard.iter().any(|e| fw.route_for_tests(e).1 != WatchOutcome::IgnoredNoPath),
        "the route sees the event: {heard:?}"
    );
}

/// live_d: after the last holder releases, a write is no longer delivered.
#[test]
fn d173_wi1_live_d_last_release_stops_delivery() {
    let _home = home("d");
    let (_d, canonical, aliased) = alias_file("d173ld");
    let (fw, rx) = FileWatcher::for_tests_recording();
    let ga = acquire(&fw, W1, &aliased);
    let gb = acquire(&fw, W2, &canonical);
    assert_delivers(&rx, &canonical, "live_d");
    assert_eq!(fw.release_hold(W1, &aliased, ga), UnclaimedRaw);
    assert_eq!(fw.release_hold(W2, &canonical, gb), BackendReleased);
    assert_eq!(fw.watched(), Vec::<String>::new());
    settle(&rx);
    append(&canonical, b" two");
    let heard = events_for(&rx, &canonical, SILENCE, true);
    assert!(heard.is_empty(), "delivered after the last release: {heard:?}");
}

/// live_e (STOP gate, plan §7): on the default volume, two case variants of
/// one file canonicalise to one path, and notify treats them as one stream
/// entry (unwatching one silences the other). If this is red, the group
/// key needs case folding and the plan goes back to the delegator.
#[test]
fn d173_wi1_live_e_case_variant_canonicalises_to_one_group() {
    let _home = home("e");
    let d = TempDir::new("d173le");
    let lower = d.file("note.md", b"one");
    let upper = d.path().join("NOTE.md");
    let lc = std::fs::canonicalize(&lower).expect("lower");
    let uc = std::fs::canonicalize(&upper).expect("the default volume is case-insensitive");
    assert_eq!(lc, uc, "case variants canonicalise to one path");

    let (fw, rx) = FileWatcher::for_tests_recording();
    fw.watch(&upper);
    fw.watch(&lower);
    assert_delivers(&rx, &lc, "live_e");
    fw.unwatch(&upper);
    settle(&rx);
    append(&lower, b" two");
    let heard = events_for(&rx, &lc, SILENCE, true);
    assert!(
        heard.is_empty(),
        "notify keeps case variants apart; a per-group key would be wrong: {heard:?}"
    );
}

/// live_f: through the holders, the case variants form one group, and
/// releasing one keeps delivery for the other.
#[test]
fn d173_wi1_live_f_case_variants_hold_one_group() {
    let _home = home("f");
    let d = TempDir::new("d173lf");
    let lower = d.file("note.md", b"one");
    let upper = d.path().join("NOTE.md");
    let (fw, rx) = FileWatcher::for_tests_recording();
    let gu = acquire(&fw, W1, &upper);
    acquire(&fw, W2, &lower);
    let groups = fw.holders.map.lock().unwrap_or_else(|e| e.into_inner()).groups.len();
    assert_eq!(groups, 1, "one group for both case variants");
    assert_eq!(fw.release_hold(W1, &upper, gu), UnclaimedRaw);
    settle(&rx);
    append(&lower, b" two");
    let target = std::fs::canonicalize(&lower).expect("canonical");
    let heard = events_for(&rx, &target, DELIVER, true);
    assert!(!heard.is_empty(), "the remaining case variant lost delivery");
}
