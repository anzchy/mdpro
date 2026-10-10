//! D86 WI-2 (matrix g6, g8): `FileWatcher::watch` / `unwatch` draw their
//! ticket inside the block that holds the watcher locks, so ticket order is
//! watch-list order, and an unwatch landing inside a watch's read leaves
//! neither a list entry nor a baseline (L6's "watched <=> has entry", by
//! construction).
#[cfg(target_os = "macos")]
use std::path::Path;

const SRC: &str = include_str!("file_watcher.rs");

/// Non-comment lines of the fn whose header contains `anchor`, up to the
/// closing brace at the header's indentation.
fn body(anchor: &str) -> Vec<&'static str> {
    let lines: Vec<&'static str> = SRC
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect();
    let start = lines
        .iter()
        .position(|l| l.contains(anchor))
        .unwrap_or_else(|| panic!("`{anchor}` not found"));
    let indent = lines[start].len() - lines[start].trim_start().len();
    let close = format!("{}}}", " ".repeat(indent));
    let end = lines[start..]
        .iter()
        .position(|l| *l == close)
        .expect("fn closes");
    lines[start..=start + end].to_vec()
}

fn position(lines: &[&str], from: usize, what: &str, pred: impl Fn(&str) -> bool) -> usize {
    lines[from..]
        .iter()
        .position(|l| pred(l))
        .map(|i| from + i)
        .unwrap_or_else(|| panic!("{what} not found in {lines:#?}"))
}

/// g8: exactly one `next_ticket(` per body, between the `watched_paths`
/// lock and the end of the `let … = { … };` block; the store call comes
/// after that block.
#[test]
fn g8_ticket_is_taken_inside_the_watcher_lock_block() {
    for (anchor, store_call) in [
        ("pub fn watch(", "register_at("),
        ("pub fn unwatch(", "remove_at("),
    ] {
        let b = body(anchor);
        let tickets = b.iter().filter(|l| l.contains("next_ticket(")).count();
        assert_eq!(tickets, 1, "{anchor}: one ticket: {b:#?}");
        let lock = position(&b, 0, "the list lock", |l| {
            l.contains("self.watched_paths.lock()")
        });
        let close = position(&b, lock, "the block end", |l| l.trim() == "};");
        let ticket = position(&b, 0, "next_ticket(", |l| l.contains("next_ticket("));
        assert!(
            lock <= ticket && ticket < close,
            "{anchor}: ticket under the locks: {b:#?}"
        );
        let call = position(&b, 0, store_call, |l| l.contains(store_call));
        assert!(
            call > close,
            "{anchor}: store call after the locks drop: {b:#?}"
        );
    }
}

#[cfg(target_os = "macos")]
use super::super::super::FileWatcher;
#[cfg(target_os = "macos")]
use super::super::fixture::TempDir;
#[cfg(target_os = "macos")]
use super::super::seam::with_read_hook;
#[cfg(target_os = "macos")]
use super::super::snapshot;
#[cfg(target_os = "macos")]
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
#[cfg(target_os = "macos")]
use std::sync::Arc;

#[cfg(target_os = "macos")]
#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft/draft_test_home.rs"]
mod draft_test_home;

#[cfg(target_os = "macos")]
fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// g6: an unwatch inside the watch's baseline read wins (its ticket is
/// newer), so the path is neither listed nor baselined. Control: watch,
/// unwatch, watch with no interleaving leaves both.
#[cfg(target_os = "macos")]
#[test]
fn g6_unwatch_inside_watchs_read_leaves_neither_list_nor_entry() {
    let _home = draft_test_home::TempHome::new(&format!("d86_wi2_g6_{}", std::process::id()));
    let d = TempDir::new("g6");
    let p = d.file("a.md", b"abc");
    let fw = Arc::new(FileWatcher::for_tests());
    let (fw2, p2) = (Arc::clone(&fw), p.clone());
    with_read_hook(move || fw2.unwatch(&p2), || fw.watch(&p));
    assert_eq!(
        fw.watched(),
        Vec::<String>::new(),
        "the unwatch stands in the list"
    );
    assert_eq!(fw.baseline_of(&p), None, "and in the store");

    let q = d.file("b.md", b"def");
    fw.watch(&q);
    fw.unwatch(&q);
    fw.watch(&q);
    assert_eq!(fw.watched(), vec![s(&q)]);
    assert_eq!(fw.baseline_of(&q), Some(snapshot(&q)));
}
