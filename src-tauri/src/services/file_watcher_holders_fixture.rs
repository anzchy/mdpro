//! Test-only helpers for the D173-WI-1 holder tests
//! (`file_watcher_holders_tests.rs`, `file_watcher_holders_rows_tests.rs`).
//! An acquisition is what the commands do: `reserve_hold`, the legacy
//! register (`watch`), `confirm_hold`. Mounted `#[cfg(test)]` from
//! file_watcher_holders.rs.
use super::super::baseline::fixture::{ev, CONTENT};
use super::super::{FileWatcher, WatchOutcome};
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use std::path::{Path, PathBuf};

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft/draft_test_home.rs"]
mod draft_test_home;
use draft_test_home::TempHome;

pub(super) const W1: &str = "mdpro-w1";
pub(super) const W2: &str = "mdpro-w2";

/// A temp `$HOME` held for the case (opaque: `TempHome` stays private here).
pub(super) fn home(label: &str) -> impl Sized {
    TempHome::new(&format!("d173_wi1_{label}_{}", std::process::id()))
}

pub(super) fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// What the open commands do: reserve, the legacy register, confirm.
/// Returns the hold's generation.
pub(super) fn acquire(fw: &FileWatcher, label: &str, p: &Path) -> u64 {
    let r = fw
        .reserve_hold(label, p)
        .unwrap_or_else(|| panic!("{label} may acquire {p:?}"));
    fw.watch(p);
    fw.confirm_hold(&r);
    r.gen
}

impl FileWatcher {
    /// Every hold as `(label, raw, gen)`, sorted. Test-only reader, also
    /// used by the command-level D173 tests.
    pub(crate) fn holds_for_tests(&self) -> Vec<(String, PathBuf, u64)> {
        let map = self.holders.map.lock().unwrap_or_else(|e| e.into_inner());
        let mut out: Vec<_> = map
            .holds
            .iter()
            .map(|((label, raw), hold)| (label.clone(), raw.clone(), hold.gen))
            .collect();
        out.sort();
        out
    }
}

pub(super) fn holds(fw: &FileWatcher) -> Vec<(String, PathBuf, u64)> {
    fw.holds_for_tests()
}

/// The group `raw` consumes: `(consumers, notify_spellings)`.
#[allow(clippy::type_complexity)]
pub(super) fn group_of(fw: &FileWatcher, raw: &Path) -> Option<(Vec<(PathBuf, usize)>, Vec<PathBuf>)> {
    let map = fw.holders.map.lock().unwrap_or_else(|e| e.into_inner());
    map.groups
        .values()
        .find(|g| g.consumers.contains_key(raw))
        .map(|g| {
            let consumers = g.consumers.iter().map(|(k, v)| (k.clone(), *v)).collect();
            (consumers, g.notify_spellings.clone())
        })
}

pub(super) fn group_count(fw: &FileWatcher) -> usize {
    let map = fw.holders.map.lock().unwrap_or_else(|e| e.into_inner());
    map.groups.len()
}

pub(super) fn route(fw: &FileWatcher, p: &Path) -> WatchOutcome {
    fw.route_for_tests(&ev(CONTENT, &[p])).1
}

/// No hold, no group, no watch, no baseline: nothing leaks.
pub(super) fn assert_nothing_left(fw: &FileWatcher, p: &Path, tag: &str) {
    assert_eq!(holds(fw), vec![], "{tag}: no hold left");
    assert_eq!(group_count(fw), 0, "{tag}: no group left");
    assert_eq!(fw.watched(), Vec::<String>::new(), "{tag}: watch list empty");
    assert_eq!(fw.baseline_of(p), None, "{tag}: no baseline");
}

