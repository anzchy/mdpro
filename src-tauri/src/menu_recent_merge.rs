//! Purpose: the pure merge behind the app-wide "Open Recent" session list
//! (D43, design (b)). Windows send a change (`RecentOp`) instead of a whole
//! list, and `apply_recent_op` folds it into the one list Rust keeps.
//!
//! Key decisions:
//! - `Record` is TS `pushRecent` (`src/utils/recentFiles.ts`): an empty path is
//!   a verbatim no-op (no cap), otherwise the path moves to the front, only its
//!   own duplicates are removed, and the result is capped at `MAX_RECENT_FILES`.
//! - `Seed` is `mergePending(current ++ (stored − current), pending)`, capped.
//!   The session list stays the prefix, so a window that failed to load its
//!   preferences can never displace other windows' entries. `stored − current`
//!   keeps duplicates inside `stored`, matching the TS "conserve" rule.
//!   `stored: None` means "nothing stored", the same as an empty list.
//! - `Refresh` returns `current` unchanged (rebuild the menu only).
//! - `sanitize_recent_op` bounds frontend input before the merge (WI-3): Seed
//!   lists are filtered then trimmed, an over-long Record path is rejected.
//! - The shared fixture `tests/fixtures/recent-files-ops.json` pins Rust and TS
//!   to the same results; change both sides and the fixture together.
//!
//! @coordinates-with src/utils/recentFiles.ts
//! @coordinates-with src/menu_recent.rs

use serde::{Deserialize, Serialize};

/// How many paths the Recent Files list keeps. Must equal TS `MAX_RECENT_FILES`.
pub const MAX_RECENT_FILES: usize = 10;

/// Longest path, in bytes, the session list accepts from the frontend.
pub const MAX_RECENT_PATH_BYTES: usize = 4096;

/// Most entries a `Seed` list may carry; longer lists keep their first entries.
pub const MAX_RECENT_OP_ENTRIES: usize = 64;

/// One change a window sends to the session list. Wire shape:
/// `{"kind":"seed","stored":[..]|null,"pendingNewestFirst":[..]}`,
/// `{"kind":"record","path":".."}`, `{"kind":"refresh"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RecentOp {
    /// A window's hydration: its stored list (if it loaded) and the opens it
    /// buffered before hydration, most recent first.
    Seed {
        stored: Option<Vec<String>>,
        pending_newest_first: Vec<String>,
    },
    /// One open, equivalent to TS `pushRecent`.
    Record { path: String },
    /// Rebuild the menu without changing the list.
    Refresh,
}

/// Fold `op` into the session list `current` and return the new list.
pub fn apply_recent_op(current: &[String], op: &RecentOp) -> Vec<String> {
    match op {
        RecentOp::Refresh => current.to_vec(),
        RecentOp::Record { path } => push_recent(current, path),
        RecentOp::Seed {
            stored,
            pending_newest_first,
        } => {
            let disk_only = stored.iter().flatten().filter(|p| !current.contains(p));
            let mut list: Vec<String> = current.iter().chain(disk_only).cloned().collect();
            list.truncate(MAX_RECENT_FILES);
            pending_newest_first
                .iter()
                .rev()
                .fold(list, |acc, p| push_recent(&acc, p))
        }
    }
}

/// TS `pushRecent`: an empty path returns the list verbatim (uncapped);
/// otherwise `path` moves to the front, only its own copies are removed, and
/// the result is capped at `MAX_RECENT_FILES`.
fn push_recent(list: &[String], path: &str) -> Vec<String> {
    if path.is_empty() {
        return list.to_vec();
    }
    std::iter::once(path.to_string())
        .chain(list.iter().filter(|p| p.as_str() != path).cloned())
        .take(MAX_RECENT_FILES)
        .collect()
}

/// Error kind for a `Record` path over `MAX_RECENT_PATH_BYTES`. The returned
/// error starts with it; the sync log records only the kind, never the path.
pub const PATH_TOO_LONG: &str = "path_too_long";

/// Bound a frontend-supplied op before it reaches the merge (rule 60).
///
/// - `Seed`: each list keeps only non-empty paths of at most
///   `MAX_RECENT_PATH_BYTES` bytes, then its first `MAX_RECENT_OP_ENTRIES`
///   (filter first, then trim). One bad stored entry never costs the rest of a
///   hydration.
/// - `Record`: returned unchanged when within the byte limit (an empty path is
///   a no-op downstream); otherwise `Err("path_too_long: …")`, path omitted.
/// - `Refresh`: unchanged.
///
/// Kept paths are byte-identical: nothing is truncated, normalised or
/// character-filtered. Idempotent and total.
pub fn sanitize_recent_op(op: RecentOp) -> Result<RecentOp, String> {
    match op {
        RecentOp::Refresh => Ok(RecentOp::Refresh),
        RecentOp::Record { path } if path.len() > MAX_RECENT_PATH_BYTES => Err(format!(
            "{PATH_TOO_LONG}: recent path too long ({} bytes, max {MAX_RECENT_PATH_BYTES})",
            path.len()
        )),
        RecentOp::Record { path } => Ok(RecentOp::Record { path }),
        RecentOp::Seed {
            stored,
            pending_newest_first,
        } => Ok(RecentOp::Seed {
            stored: stored.map(bound_list),
            pending_newest_first: bound_list(pending_newest_first),
        }),
    }
}

fn bound_list(list: Vec<String>) -> Vec<String> {
    list.into_iter()
        .filter(|p| !p.is_empty() && p.len() <= MAX_RECENT_PATH_BYTES)
        .take(MAX_RECENT_OP_ENTRIES)
        .collect()
}

#[cfg(test)]
#[path = "menu_recent_merge_sanitize_tests.rs"]
mod sanitize_tests;

#[cfg(test)]
#[path = "menu_recent_merge_tests.rs"]
mod tests;
