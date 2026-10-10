//! The event kinds the D32 unchanged-file drop applies to (ADR-0068
//! decision 1).
//!
//! Purpose: name the notify kinds the watcher may drop when the file is
//! unchanged (`is_filtered_kind`). Pure: no I/O, no store, no lock.
//!
//! @coordinates-with services/file_watcher_baseline.rs (parent; re-exports
//! `is_filtered_kind`), services/file_watcher_route.rs (`process_event` asks
//! `is_unchanged` for a filtered kind or a replaced file),
//! file_watcher_baseline_kind_tests.rs, file_watcher_baseline_lock_tests.rs
//! (B18′ scans this file)
//!
//! Key decisions:
//! - **Three filtered kinds** (ADR-0068 decision 1): `Modify(Metadata(Extended))`,
//!   `Modify(Metadata(Any))` and `Modify(Data(Content))`, the residual flags
//!   FSEvents reports for an xattr write within ~30 s of a real one. The
//!   route also checks a replaced file (ADR-0072); other kinds never are.
use notify::event::{DataChange, MetadataKind, ModifyKind};
use notify::EventKind;

/// The kinds the unchanged-file drop applies to (ADR-0068 decision 1).
pub(crate) fn is_filtered_kind(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Modify(
            ModifyKind::Metadata(MetadataKind::Extended | MetadataKind::Any)
                | ModifyKind::Data(DataChange::Content)
        )
    )
}
