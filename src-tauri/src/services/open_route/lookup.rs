//! Pure lookup: which live, routable window holds a document at this path.
//!
//! See the module docs in `open_route/mod.rs` for the rules (ADR-0033).
use super::{RouteLookup, RouteTarget};
use crate::models::{ShadowStore, SharedShadowStore};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::path::PathBuf;

/// A document with a path, copied out of the store.
struct Doc {
    id: String,
    path: String,
    dirty: bool,
}

/// An eligible (routable and live) window, copied out of the store.
struct Candidate {
    label: String,
    focus: i64,
    docs: Vec<Doc>,
}

/// One matching window and its best matching document.
struct Hit<'a> {
    label: &'a str,
    focus: i64,
    doc: &'a Doc,
}

/// Find the window that should receive an external open of `path`.
///
/// Only windows that are `routable` and in `live_labels` count. The target
/// carries the matched document's stored id and path. See the module docs.
pub fn lookup(store: &ShadowStore, path: &str, live_labels: &HashSet<String>) -> RouteLookup {
    choose(&candidates(store, live_labels), path)
}

/// Locking wrapper around [`lookup`]. The eligible windows are copied out
/// under the lock and canonicalized after it is released. A poisoned lock is
/// an `Err`, never a panic.
pub fn lookup_in_shared(
    store: &SharedShadowStore,
    path: &str,
    live_labels: &HashSet<String>,
) -> Result<RouteLookup, String> {
    let snapshot = {
        let guard = store
            .lock()
            .map_err(|e| format!("Failed to lock shadow store: {}", e))?;
        candidates(&guard, live_labels)
    };
    Ok(choose(&snapshot, path))
}

fn candidates(store: &ShadowStore, live_labels: &HashSet<String>) -> Vec<Candidate> {
    store
        .windows
        .iter()
        .filter(|(label, w)| w.routable && live_labels.contains(label.as_str()))
        .map(|(label, w)| Candidate {
            label: label.clone(),
            focus: w.last_focused_at,
            docs: w
                .documents
                .iter()
                .filter_map(|d| {
                    d.path.as_ref().map(|p| Doc {
                        id: d.id.clone(),
                        path: p.clone(),
                        dirty: d.is_dirty,
                    })
                })
                .collect(),
        })
        .collect()
}

/// Canonical form when available; `None` when canonicalization fails.
fn canonical(path: &str) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok()
}

/// Canonical comparison, or raw string comparison when either side fails.
fn same_file(incoming: &str, incoming_canon: Option<&PathBuf>, stored: &str) -> bool {
    match (incoming_canon, canonical(stored)) {
        (Some(a), Some(b)) => *a == b,
        _ => incoming == stored,
    }
}

/// Ranking: dirty first, then newer focus, then the smaller label.
fn rank(a: &Hit, b: &Hit) -> Ordering {
    b.doc
        .dirty
        .cmp(&a.doc.dirty)
        .then(b.focus.cmp(&a.focus))
        .then(a.label.cmp(b.label))
}

fn choose(candidates: &[Candidate], path: &str) -> RouteLookup {
    let incoming_canon = canonical(path);
    let hits: Vec<Hit> = candidates
        .iter()
        .filter_map(|c| {
            // Within one window, a dirty matching document beats a clean one;
            // otherwise the first matching document in tab order.
            let mut best: Option<&Doc> = None;
            for d in c
                .docs
                .iter()
                .filter(|d| same_file(path, incoming_canon.as_ref(), &d.path))
            {
                if best.is_none_or(|b| d.dirty && !b.dirty) {
                    best = Some(d);
                }
            }
            best.map(|doc| Hit {
                label: &c.label,
                focus: c.focus,
                doc,
            })
        })
        .collect();
    let target = hits.iter().min_by(|a, b| rank(a, b)).map(|h| RouteTarget {
        window_label: h.label.to_string(),
        document_id: h.doc.id.clone(),
        path: h.doc.path.clone(),
    });
    RouteLookup {
        target,
        match_count: hits.len(),
    }
}

// The fixture uses real symlinks, so these tests are Unix-only.
#[cfg(all(test, unix))]
#[path = "lookup_fixture.rs"]
mod lookup_fixture;
#[cfg(all(test, unix))]
#[path = "lookup_law_tests.rs"]
mod lookup_law_tests;
#[cfg(all(test, unix))]
#[path = "lookup_tests.rs"]
mod lookup_tests;
