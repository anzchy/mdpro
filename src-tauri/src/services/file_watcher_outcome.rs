//! The closed set of reasons one notify event did or did not become a
//! `file:changed` emission (D32).
//!
//! Purpose: name every routing outcome of `process_event` as one
//! `WatchOutcome` variant, with a fixed snake_case string (`as_str`) that the
//! `file.watch.event` log line carries in its `outcome` field.
//!
//! @coordinates-with services/file_watcher.rs (parent; mounts this file with
//! `#[path]` and re-exports `WatchOutcome`), file_watcher_route.rs
//! (`process_event` returns it),
//! file_watcher_log.rs (`build_watch_event_log` writes `as_str()` and maps
//! each outcome to a status and change type), file_watcher_gate_tests.rs
//! (o1: `as_str` is exact and injective, `ALL` is complete),
//! file_watcher_log_event_tests.rs (w2: status and change type over `ALL`)
//!
//! Key decisions:
//! - **Closed vocabulary.** The device checklist greps the log for these
//!   exact strings, so renaming one is a contract change; o1 is the tripwire.
//! - **`ignored_unchanged`** (ADR-0068) is the outcome for a
//!   `Modify(Metadata(Extended))`, `Modify(Metadata(Any))` or
//!   `Modify(Data(Content))` event, or a replaced file (ADR-0072: a
//!   single-path rename or a `Create` on an existing path, such as our own
//!   atomic ⌘S), on a file whose bytes and stat equal its baseline; it is
//!   non-emitting and logs as `Cancel`, like the other `ignored_*` outcomes. Renamed from `ignored_metadata_unchanged` when the
//!   filter widened to Content (D32 WI-4b).
//! - **`ALL` is test-only** and enumerates every variant, so the tests that
//!   iterate the domain see a new variant as soon as it is added.
//! - Lives in its own sibling file so `file_watcher.rs` keeps headroom under
//!   the 300-line limit; behaviour is unchanged by the move.

/// Why one notify event did or did not become a `file:changed` emission.
/// Closed on purpose: the D32 diagnostic log writes `as_str()` and the
/// device checklist greps for these exact strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum WatchOutcome {
    /// A `Modify` that changed the file, or a replaced file: a single-path
    /// `Modify(Name(_))` or a `Create` whose path still exists (ADR-0072).
    EmittedModified,
    EmittedDeleted,
    EmittedRenamed,
    /// Same first path and same change type emitted less than
    /// `DEBOUNCE_INTERVAL` ago (D116).
    Debounced,
    /// A `Modify` or a replaced file on a path `save_file` is writing right now.
    SelfWrite,
    /// `Any`, `Access` and `Other`, and a `Create` whose path does not exist:
    /// never routed.
    IgnoredKind,
    IgnoredNoPath,
    /// `Modify(Name(_))` with one path that no longer exists, i.e. the file
    /// was moved away (macOS FSEvents `ITEM_RENAMED`; D107). With the path
    /// still present it is a replaced file instead (ADR-0072).
    IgnoredRenameSinglePath,
    /// One of the three filtered kinds (`Metadata(Extended)`, `Metadata(Any)`,
    /// `Data(Content)`) or a replaced file (ADR-0072) on a file whose mtime,
    /// size and content hash all equal its baseline, read coherently
    /// (ADR-0068 decision 3); not emitted.
    IgnoredUnchanged,
}

impl WatchOutcome {
    /// Every outcome, for the tests that enumerate the domain.
    #[cfg(test)]
    pub(crate) const ALL: [WatchOutcome; 9] = [
        WatchOutcome::EmittedModified,
        WatchOutcome::EmittedDeleted,
        WatchOutcome::EmittedRenamed,
        WatchOutcome::Debounced,
        WatchOutcome::SelfWrite,
        WatchOutcome::IgnoredKind,
        WatchOutcome::IgnoredNoPath,
        WatchOutcome::IgnoredRenameSinglePath,
        WatchOutcome::IgnoredUnchanged,
    ];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            WatchOutcome::EmittedModified => "emitted_modified",
            WatchOutcome::EmittedDeleted => "emitted_deleted",
            WatchOutcome::EmittedRenamed => "emitted_renamed",
            WatchOutcome::Debounced => "debounced",
            WatchOutcome::SelfWrite => "self_write",
            WatchOutcome::IgnoredKind => "ignored_kind",
            WatchOutcome::IgnoredNoPath => "ignored_no_path",
            WatchOutcome::IgnoredRenameSinglePath => "ignored_rename_single_path",
            WatchOutcome::IgnoredUnchanged => "ignored_unchanged",
        }
    }
}
