//! Purpose: route an external open (Finder, single instance) of a file that
//! is already open to the window that holds it (D29).
//!
//! Pipeline: incoming paths -> `lookup` per path (which live, routable window
//! holds a document at this path, from the MCP shadow store) -> `RouteLookup`
//! -> `plan_route` (existing window, or today's fallback, per path) ->
//! `execute_plan` (emit / new window / one broadcast, one `file.open.route`
//! log per path). `tauri_glue::route_external_open` binds the executor's side
//! effects to the Tauri runtime; `main.rs` calls it from `RunEvent::Opened`
//! (app ready) and from the single-instance callback.
//!
//! Key decisions:
//! - **Both sides are canonicalized** with `std::fs::canonicalize`. When
//!   either side fails (for example the file is gone), the raw strings are
//!   compared instead, with no further normalization (ADR-0033 decision 2).
//! - **Only windows that are `routable` and whose label is live** are
//!   considered, for the target and for `match_count` (decisions 2 and 3).
//! - **The dirty copy wins, then the most recently focused window, then the
//!   lexicographically smallest label** (decision 5). The label tie-break
//!   makes the result independent of `HashMap` order.
//! - **Dirtiness is the matched document's**, not the window's: a window that
//!   is dirty only through some other document does not win.
//! - **The target carries the stored `document_id` and `path`**, never the
//!   incoming path, so an alias path still focuses the right tab (decision 1).
//! - `lookup_in_shared` copies what it needs out under the lock and
//!   canonicalizes outside it. A poisoned lock is an `Err`, never a panic
//!   (decision 7).
//!
//! @coordinates-with docs/adr/0033-an-external-open-of-an-already-open-file-goes-to-its-window.md
//! @coordinates-with src-tauri/src/services/shadow_store.rs
//! @coordinates-with src-tauri/src/main.rs
pub mod execute;
pub mod lookup;
pub mod payload;
pub mod plan;
pub mod tauri_glue;

pub use execute::execute_plan;
pub use lookup::{lookup, lookup_in_shared};
pub use payload::{OpenInWindowPayload, OPEN_IN_WINDOW_EVENT};
pub use plan::{
    lookup_all, plan_route, route_log_context, route_log_severity, Outcome, PlanEntry, RoutePlan,
    Source,
};
pub use tauri_glue::{has_windows_with_documents, open_file_in_new_window, route_external_open};

#[cfg(test)]
mod plan_lookup_all_tests;

/// The window and document an external open is routed to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteTarget {
    /// Label of the window that holds the document.
    pub window_label: String,
    /// The matched document's stored id.
    pub document_id: String,
    /// The matched document's stored path (not the incoming path).
    pub path: String,
}

/// Result of looking up which window holds a path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteLookup {
    /// The chosen window and document, if any eligible window holds the path.
    pub target: Option<RouteTarget>,
    /// Number of eligible windows that hold the path.
    pub match_count: usize,
}
