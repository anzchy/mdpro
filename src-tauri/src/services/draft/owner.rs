//! Purpose: the pure rule for "a draft is in use by a live window" (ADR-0038 §2).
//!
//! Key decisions:
//! - **The owner is live** only if its session id is this process's AND its
//!   label is a live window. Labels such as `main` recur across runs, so a
//!   label alone would keep a crashed run's draft "live" forever.
//! - **A live owner wins over an open document** (`OwnedByLiveWindow`): the
//!   owner is the authoritative guard, the shadow store is best-effort.
//! - **Open means the id, or a `same_file` path, sits in a live window's
//!   shadow-store entry.** Routability is not a filter, unlike
//!   `open_route::lookup` candidates. An untitled draft never matches by path.
//! - `OpenSet` is a copy taken under the shadow-store lock; paths are
//!   canonicalized later, in `in_use`, outside that lock.
//! - An unreadable store is `open: Err(ShadowUnavailable)`. `in_use` then
//!   answers from the owner alone; callers that must fail closed check `open`
//!   themselves (D27 WI-2).
//!
//! No `AppHandle` here: callers build `LiveContext`.
//!
//! @coordinates-with src-tauri/src/services/open_route/lookup.rs
//! @coordinates-with src-tauri/src/services/shadow_store.rs
use std::collections::HashSet;
use std::sync::OnceLock;

use super::{DraftError, DraftOwner, RecoverTarget};
use crate::models::ShadowStore;
use crate::services::open_route::lookup::{canonical, same_file};

/// This process's session id: one UUIDv4, generated on first use.
pub fn session_id() -> &'static str {
    static SESSION_ID: OnceLock<String> = OnceLock::new();
    SESSION_ID.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

/// The shadow store could not be read (poisoned lock).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShadowUnavailable;

/// Why a draft is in use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InUseReason {
    /// Its owner is a live window of this session.
    OwnedByLiveWindow,
    /// Its id, or its file, is open in a live window.
    OpenInWindow,
}

/// One open document, copied out of the shadow store.
#[derive(Debug, Clone)]
struct OpenDoc {
    window_label: String,
    id: String,
    path: Option<String>,
}

/// A snapshot of every window's open documents. Liveness is applied at
/// query time from `LiveContext::live_labels`.
#[derive(Debug, Clone, Default)]
pub struct OpenSet {
    docs: Vec<OpenDoc>,
}

impl OpenSet {
    /// Copy the open documents of every window out of `store`.
    pub fn from_store(store: &ShadowStore) -> Self {
        let docs = store
            .windows
            .iter()
            .flat_map(|(label, w)| {
                w.documents.iter().map(move |d| OpenDoc {
                    window_label: label.clone(),
                    id: d.id.clone(),
                    path: d.path.clone(),
                })
            })
            .collect();
        OpenSet { docs }
    }
}

/// Everything the rule needs to know about the running app.
#[derive(Debug, Clone)]
pub struct LiveContext {
    pub session_id: String,
    pub live_labels: HashSet<String>,
    pub open: Result<OpenSet, ShadowUnavailable>,
}

/// Whether `owner` is a live window of this session.
pub fn owner_is_live(owner: Option<&DraftOwner>, ctx: &LiveContext) -> bool {
    owner.is_some_and(|o| {
        o.session_id == ctx.session_id && ctx.live_labels.contains(&o.window_label)
    })
}

/// Why the draft `id` (for `original_path`, owned by `owner`) is in use, or
/// `None` when no live window is using it. See the module docs for the rule.
pub fn in_use(
    id: &str,
    original_path: Option<&str>,
    owner: Option<&DraftOwner>,
    ctx: &LiveContext,
) -> Option<InUseReason> {
    if owner_is_live(owner, ctx) {
        return Some(InUseReason::OwnedByLiveWindow);
    }
    let open = ctx.open.as_ref().ok()?;
    let draft_canon = original_path.and_then(canonical);
    let is_open = open
        .docs
        .iter()
        .filter(|d| ctx.live_labels.contains(&d.window_label))
        .any(|d| {
            d.id == id
                || match (original_path, d.path.as_deref()) {
                    (Some(p), Some(stored)) => same_file(p, draft_canon.as_ref(), stored),
                    (Some(_), None) | (None, Some(_)) | (None, None) => false,
                }
        });
    is_open.then_some(InUseReason::OpenInWindow)
}

/// Resolve a recovery target only after checking every live window for a match.
/// A caller match must never hide a matching tab in another window.
pub fn recovery_target(
    id: &str,
    original_path: Option<&str>,
    owner: Option<&DraftOwner>,
    caller: &DraftOwner,
    ctx: &LiveContext,
) -> Result<Option<RecoverTarget>, DraftError> {
    if owner_is_live(owner, ctx) && owner.is_some_and(|o| o.window_label != caller.window_label) {
        return Err(DraftError::OwnedByLiveWindow);
    }
    let open = ctx
        .open
        .as_ref()
        .map_err(|_| DraftError::ShadowStoreUnavailable)?;
    let draft_canon = original_path.and_then(canonical);
    let mut local: Option<&OpenDoc> = None;
    for doc in open
        .docs
        .iter()
        .filter(|d| ctx.live_labels.contains(&d.window_label))
    {
        let matches = doc.id == id
            || match (original_path, doc.path.as_deref()) {
                (Some(p), Some(stored)) => same_file(p, draft_canon.as_ref(), stored),
                _ => false,
            };
        if !matches {
            continue;
        }
        if doc.window_label != caller.window_label {
            return Err(DraftError::OpenInWindow);
        }
        if local.is_none() || doc.id == id {
            local = Some(doc);
        }
    }
    Ok(local.map(|doc| RecoverTarget {
        id: doc.id.clone(),
        stored_path: doc.path.clone(),
    }))
}

// The symlink fixture is shared with `open_route::lookup`, not copied.
#[cfg(all(test, unix))]
#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../open_route/lookup_fixture.rs"]
mod owner_fixture;
#[cfg(all(test, unix))]
#[path = "owner_tests.rs"]
mod owner_tests;
