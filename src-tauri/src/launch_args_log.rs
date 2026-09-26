//! Count-only log payload for a launch-argument filter (D33).
//!
//! Purpose: describe what [`super::filter_launch_args`] did to one launch's
//! arguments as a single `file.open.args_filtered` log entry, without writing
//! any path or argument into the log.
//!
//! @coordinates-with launch_args.rs (parent; re-exports these items),
//! models/log_entry.rs (`LogEntryPayload`, `LogLevel`, `LogStatus`),
//! main.rs (emits one entry per launch, cli and single-instance)
//!
//! Key decisions:
//! - **Counts only.** The context carries the source label, the accepted
//!   count and one count per [`DropReason`](super::DropReason), every key
//!   present even at 0. Paths are never logged here, so the entry is safe to
//!   emit on every launch.
//! - **Level is a pure function of the drop counts.** `Warn` iff any non-flag
//!   reason dropped an argument; flags alone (`--devtools`, `-psn_…`) are
//!   expected noise and stay `Info`.

use super::{DropCounts, LaunchFilter};
use crate::models::log_entry::{LogEntryPayload, LogLevel, LogStatus};
use serde_json::json;

/// Event name for the per-launch filter summary.
pub const ARGS_FILTERED_EVENT: &str = "file.open.args_filtered";

/// Which launch path produced a [`LaunchFilter`]. Closed set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchSource {
    /// First-process launch: `std::env::args()` of this process.
    Cli,
    /// Arguments forwarded from a second process by the single-instance plugin.
    SingleInstance,
}

impl LaunchSource {
    /// Stable log label; renaming one is a log-contract change.
    pub fn as_str(self) -> &'static str {
        match self {
            LaunchSource::Cli => "cli",
            LaunchSource::SingleInstance => "single_instance",
        }
    }
}

/// `Warn` iff any argument was dropped for a reason other than being a flag.
pub fn args_filtered_log_level(dropped: &DropCounts) -> LogLevel {
    let DropCounts {
        flag: _,
        relative_without_cwd,
        unresolved,
        not_regular_file,
        not_markdown,
        non_utf8,
    } = *dropped;
    let unexpected = relative_without_cwd + unresolved + not_regular_file + not_markdown + non_utf8;
    if unexpected > 0 {
        LogLevel::Warn
    } else {
        LogLevel::Info
    }
}

/// One `file.open.args_filtered` entry: source, accepted count and per-reason
/// drop counts. Never contains a path.
pub fn args_filtered_log_entry(source: LaunchSource, filter: &LaunchFilter) -> LogEntryPayload {
    let DropCounts {
        flag,
        relative_without_cwd,
        unresolved,
        not_regular_file,
        not_markdown,
        non_utf8,
    } = filter.dropped;
    LogEntryPayload {
        level: args_filtered_log_level(&filter.dropped),
        event: ARGS_FILTERED_EVENT.to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(json!({
            "source": source.as_str(),
            "accepted": filter.paths.len(),
            "dropped": {
                "flag": flag,
                "relative_without_cwd": relative_without_cwd,
                "unresolved": unresolved,
                "not_regular_file": not_regular_file,
                "not_markdown": not_markdown,
                "non_utf8": non_utf8,
            },
        })),
        duration_ms: None,
        error: None,
    }
}
