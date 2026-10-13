//! The event kinds the D32 unchanged-file drop applies to (ADR-0068
//! decision 1, as amended by ADR-0080).
//!
//! Purpose: name the notify kinds the watcher may drop when the file is
//! unchanged (`is_filtered_kind`). Pure: no I/O, no store, no lock.
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; re-exports
//! `is_filtered_kind`), services/file_watcher_route.rs (`process_event_checked`
//! asks `is_unchanged_why` for a filtered kind or a replaced file),
//! file_watcher_baseline_kind_tests.rs, file_watcher_route_permission_tests.rs
//! (D164), file_watcher_route_windows_modify_any_tests.rs (D190-WI-2),
//! file_watcher_baseline_seam.rs (`windows_kinds_forced`), file_watcher_baseline_lock_tests.rs (B18′ scans this file),
//! docs/adr/0080-permission-and-ownership-changes-on-an-unchanged-file-do-not-prompt.md
//!
//! Key decisions:
//! - **Five filtered kinds.** ADR-0068 decision 1's three:
//!   `Modify(Metadata(Extended))`, `Modify(Metadata(Any))` and
//!   `Modify(Data(Content))`, the residual flags FSEvents reports for an xattr
//!   write within ~30 s of a real one. ADR-0080 (D164) adds
//!   `Modify(Metadata(Ownership))` and `Modify(Metadata(Permissions))`: on
//!   macOS a `chmod` arrives as Ownership, and a permission-only change on
//!   unchanged bytes must not prompt. A `chmod 000` still emits, because the
//!   check's read fails and fails open (`read_failed`), not because of the
//!   kind. `WriteTime`, `AccessTime` and `Other` stay unfiltered. The route
//!   also checks a replaced file (ADR-0072); other kinds never are.
//! - **Windows adds `Modify(Any)`** (ADR-0093, D190-WI-2). notify 6 maps
//!   ReadDirectoryChangesW's FILE_ACTION_MODIFIED to `Modify(Any)` and gives
//!   no subkind, so on Windows it goes through the same check; a real write
//!   still fails it and emits. Other hosts keep the five kinds exactly
//!   (`Modify(Any)` there stays unchecked). `is_filtered_kind_on` takes the
//!   host as a flag so both sets are tested on the macOS host; the test
//!   build can force Windows' set (`seam::with_windows_kinds`).
use notify::event::{DataChange, MetadataKind, ModifyKind};
use notify::EventKind;

/// The kinds the unchanged-file drop applies to on this host (ADR-0068
/// decision 1, ADR-0080, ADR-0093).
pub(crate) fn is_filtered_kind(kind: &EventKind) -> bool {
    is_filtered_kind_on(kind, windows_kinds())
}

/// The kinds the drop applies to on a Windows host (`windows`) or any
/// other: the five of ADR-0068 decision 1 and ADR-0080 everywhere, plus
/// `Modify(Any)` on Windows only (ADR-0093), where notify reports every
/// FILE_ACTION_MODIFIED, including the writes around our own save, as it.
pub(crate) fn is_filtered_kind_on(kind: &EventKind, windows: bool) -> bool {
    let windows_write = windows && matches!(kind, EventKind::Modify(ModifyKind::Any));
    windows_write
        || matches!(
            kind,
            EventKind::Modify(
                ModifyKind::Metadata(
                    MetadataKind::Extended
                        | MetadataKind::Any
                        | MetadataKind::Ownership
                        | MetadataKind::Permissions
                ) | ModifyKind::Data(DataChange::Content)
            )
        )
}

/// Production: the host decides.
#[cfg(not(test))]
fn windows_kinds() -> bool {
    cfg!(windows)
}

/// Test build: the host, or a test that forced Windows' kinds (D190-WI-2).
#[cfg(test)]
fn windows_kinds() -> bool {
    cfg!(windows) || super::seam::windows_kinds_forced()
}
