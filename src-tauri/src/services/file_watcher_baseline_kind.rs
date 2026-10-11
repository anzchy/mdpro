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
//! (D164), file_watcher_baseline_lock_tests.rs (B18′ scans this file),
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
use notify::event::{DataChange, MetadataKind, ModifyKind};
use notify::EventKind;

/// The kinds the unchanged-file drop applies to (ADR-0068 decision 1,
/// ADR-0080).
pub(crate) fn is_filtered_kind(kind: &EventKind) -> bool {
    matches!(
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
