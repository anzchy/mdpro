//! Pure route planner (D29 WI-3): for each incoming path, either go to the
//! window that holds it or keep today's fallback. Also the `file.open.route`
//! log context.
//!
//! Key decisions:
//! - **Paths are planned one by one, in input order** (ADR-0033 decision 6).
//!   The plan has exactly one entry per input path, so nothing is dropped,
//!   duplicated or reordered, and the executor can log in input order.
//! - **The fallback is today's behaviour** (decision 7). Finder with the app
//!   ready opens a new window. Single instance opens a new window when the
//!   app has documents, otherwise the unrouted paths are broadcast as one
//!   `file:open` group. A lookup `Err` counts as unrouted.
//! - **Every entry carries its own lookup's `match_count`**: 0 for no match
//!   and 0 for a lookup `Err`. The executor logs it and computes nothing.
//! - **The log context carries no path and no content** (decision 8).
use super::{lookup_in_shared, RouteLookup, RouteTarget};
use crate::models::SharedShadowStore;
use serde_json::{json, Value};
use std::collections::HashSet;

/// Where an external open came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// macOS `RunEvent::Opened` with the app ready.
    Finder,
    /// A second process launched with paths.
    SingleInstance,
}

impl Source {
    /// The `source` string, the same as the existing `file.open.external` logs.
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Finder => "finder",
            Source::SingleInstance => "single_instance",
        }
    }
}

/// Where one path ended up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    ExistingWindow,
    NewWindow,
    Broadcast,
}

impl Outcome {
    /// The `outcome` string of the `file.open.route` log.
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::ExistingWindow => "existing-window",
            Outcome::NewWindow => "new-window",
            Outcome::Broadcast => "broadcast",
        }
    }
}

/// One input path's planned action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanEntry {
    /// Route to the window that holds the path. `path` is the incoming path,
    /// used if the emit fails; `target` carries the stored id and path.
    ExistingWindow {
        path: String,
        target: RouteTarget,
        match_count: usize,
    },
    /// Open in a new window (today's behaviour).
    NewWindow { path: String, match_count: usize },
    /// Part of the single `file:open` broadcast group (today's behaviour).
    Broadcast { path: String, match_count: usize },
}

/// The ordered plan: exactly one entry per input path, in input order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutePlan {
    pub entries: Vec<PlanEntry>,
}

/// Plan every path. `lookups` pairs each incoming path with its lookup
/// result. `has_windows_with_documents` matters only for `SingleInstance`.
pub fn plan_route(
    source: Source,
    lookups: &[(String, Result<RouteLookup, String>)],
    has_windows_with_documents: bool,
) -> RoutePlan {
    let broadcast = source == Source::SingleInstance && !has_windows_with_documents;
    let entries = lookups
        .iter()
        .map(|(path, result)| {
            let path = path.clone();
            match result {
                Ok(RouteLookup {
                    target: Some(target),
                    match_count,
                }) => PlanEntry::ExistingWindow {
                    path,
                    target: target.clone(),
                    match_count: *match_count,
                },
                Ok(RouteLookup {
                    target: None,
                    match_count,
                }) => fallback(path, *match_count, broadcast),
                Err(_) => fallback(path, 0, broadcast),
            }
        })
        .collect();
    RoutePlan { entries }
}

fn fallback(path: String, match_count: usize, broadcast: bool) -> PlanEntry {
    if broadcast {
        PlanEntry::Broadcast { path, match_count }
    } else {
        PlanEntry::NewWindow { path, match_count }
    }
}

/// Context of one `file.open.route` log: exactly `source`, `outcome`,
/// `windowLabel` (null unless delivered to a window) and `matchCount`.
pub fn route_log_context(
    source: Source,
    outcome: Outcome,
    window_label: Option<&str>,
    match_count: usize,
) -> Value {
    json!({
        "source": source.as_str(),
        "outcome": outcome.as_str(),
        "windowLabel": window_label,
        "matchCount": match_count,
    })
}

/// Look up every path, in order. Without a managed store (setup not done)
/// each lookup is an `Err`, which the planner treats as unrouted.
pub fn lookup_all(
    store: Option<&SharedShadowStore>,
    paths: &[String],
    live_labels: &HashSet<String>,
) -> Vec<(String, Result<RouteLookup, String>)> {
    paths
        .iter()
        .map(|p| {
            let result = match store {
                Some(s) => lookup_in_shared(s, p, live_labels),
                None => Err("shadow store is not managed yet".to_string()),
            };
            (p.clone(), result)
        })
        .collect()
}

#[cfg(test)]
#[path = "plan_tests.rs"]
mod plan_tests;
