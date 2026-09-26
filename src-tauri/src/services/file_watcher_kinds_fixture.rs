//! Test-only fixtures for the file watcher tests (D32 step 1).
//!
//! Wired from `file_watcher.rs` with
//! `#[cfg(test)] #[path = ...] pub(crate) mod kinds_fixture;` so every
//! watcher test module shares one enumeration of the notify kind domain and
//! one hand-written source-tripwire predicate (there is no `regex` crate).
//! WI-2 adds the routing-test helpers: `T`, `unique_path`, the `WriteMark`
//! self-write guard, and `fn_slice` for source tripwires. WI-3 adds the
//! `stat_of` spy (`SPY_STAT`, `stat_spy`) for the `observe_event` tests.

use notify::event::{
    AccessKind, AccessMode, CreateKind, DataChange, MetadataKind, ModifyKind, RemoveKind,
    RenameMode,
};
use notify::EventKind;

const ACCESS_MODES: [AccessMode; 5] = [
    AccessMode::Any,
    AccessMode::Execute,
    AccessMode::Read,
    AccessMode::Write,
    AccessMode::Other,
];

/// Every leaf of notify 6.1.1's `EventKind` (41), built from literal
/// sub-enum arrays rather than from the classifier under test.
pub(crate) fn all_event_kinds() -> Vec<EventKind> {
    let mut kinds = vec![EventKind::Any, EventKind::Other];
    kinds.extend([AccessKind::Any, AccessKind::Read, AccessKind::Other].map(EventKind::Access));
    kinds.extend(ACCESS_MODES.map(|m| EventKind::Access(AccessKind::Open(m))));
    kinds.extend(ACCESS_MODES.map(|m| EventKind::Access(AccessKind::Close(m))));
    kinds.extend(
        [
            CreateKind::Any,
            CreateKind::File,
            CreateKind::Folder,
            CreateKind::Other,
        ]
        .map(EventKind::Create),
    );
    kinds.extend(
        [
            DataChange::Any,
            DataChange::Size,
            DataChange::Content,
            DataChange::Other,
        ]
        .map(|d| EventKind::Modify(ModifyKind::Data(d))),
    );
    kinds.extend(
        [
            MetadataKind::Any,
            MetadataKind::AccessTime,
            MetadataKind::WriteTime,
            MetadataKind::Permissions,
            MetadataKind::Ownership,
            MetadataKind::Extended,
            MetadataKind::Other,
        ]
        .map(|m| EventKind::Modify(ModifyKind::Metadata(m))),
    );
    kinds.extend(
        [
            RenameMode::Any,
            RenameMode::To,
            RenameMode::From,
            RenameMode::Both,
            RenameMode::Other,
        ]
        .map(|r| EventKind::Modify(ModifyKind::Name(r))),
    );
    kinds.extend([ModifyKind::Any, ModifyKind::Other].map(EventKind::Modify));
    kinds.extend(
        [
            RemoveKind::Any,
            RemoveKind::File,
            RemoveKind::Folder,
            RemoveKind::Other,
        ]
        .map(EventKind::Remove),
    );
    kinds
}

/// Hand-written `^\s*[a-z_][a-z0-9_]*\s*=>`: a match arm whose whole pattern
/// is `_` or a bare lowercase binding, i.e. a catch-all under any name.
pub(crate) fn is_bare_binding_arm(line: &str) -> bool {
    let rest = line.trim_start();
    match rest.chars().next() {
        Some(c) if c.is_ascii_lowercase() || c == '_' => {}
        Some(_) | None => return false,
    }
    let end = rest
        .char_indices()
        .find(|&(_, c)| !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'))
        .map_or(rest.len(), |(i, _)| i);
    rest[end..].trim_start().starts_with("=>")
}

/// The lines of `src` whose trimmed start is not a `//` comment.
pub(crate) fn code_lines(src: &str) -> impl Iterator<Item = &str> {
    src.lines()
        .filter(|line| !line.trim_start().starts_with("//"))
}

/// An odd timestamp no clock produces by accident (D32 WI-2).
pub(crate) const T: i64 = 1_700_000_000_777;

/// A temp path unique per call and per test process. It need not exist.
/// Unique paths keep the process-global `write_in_progress` set
/// collision-free under parallel `cargo test`.
pub(crate) fn unique_path(label: &str) -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    std::env::temp_dir().join(format!("mdpro_fw_{label}_{pid}_{n}.md"))
}

/// RAII self-write mark: `mark_write_start` on `new`, `mark_write_end` on
/// drop, so a panicking test never leaks a mark into another test.
pub(crate) struct WriteMark(pub(crate) std::path::PathBuf);

impl WriteMark {
    pub(crate) fn new(path: &std::path::Path) -> Self {
        super::mark_write_start(path);
        Self(path.to_path_buf())
    }
}

impl Drop for WriteMark {
    fn drop(&mut self) {
        super::mark_write_end(&self.0);
    }
}

/// The source text from `anchor` up to the next top-level `fn `, `pub fn `,
/// impl-level `    pub fn `, or column-0 `}`, whichever comes first.
/// Panics when the anchor is absent.
pub(crate) fn fn_slice<'a>(src: &'a str, anchor: &str) -> &'a str {
    let start = src
        .find(anchor)
        .unwrap_or_else(|| panic!("anchor `{anchor}` not found in source"));
    let rest = &src[start..];
    let end = ["\nfn ", "\npub fn ", "\n    pub fn ", "\n}"]
        .iter()
        .filter_map(|marker| rest.find(marker))
        .min()
        .unwrap_or(rest.len());
    &rest[..end]
}

/// Stat values no real file in the tests has (D32 WI-3).
pub(crate) const SPY_STAT: super::watch_log::FileStat = super::watch_log::FileStat {
    mtime_ms: 4242,
    size: 17,
};

/// Paths a [`stat_spy`] closure was called with, in call order.
pub(crate) type SpyCalls = std::rc::Rc<std::cell::RefCell<Vec<std::path::PathBuf>>>;

/// A `stat_of` spy: records every path it is called with and returns
/// `Some(SPY_STAT)`.
pub(crate) fn stat_spy() -> (
    SpyCalls,
    impl Fn(&std::path::Path) -> Option<super::watch_log::FileStat>,
) {
    let calls = SpyCalls::default();
    let seen = std::rc::Rc::clone(&calls);
    let spy = move |path: &std::path::Path| {
        seen.borrow_mut().push(path.to_path_buf());
        Some(SPY_STAT)
    };
    (calls, spy)
}
