//! Purpose: the recovery-dialog draft commands (ADR-0038 §3-5): `list_drafts`,
//! `recover_draft`, `discard_recovery_draft` and `cleanup_old_drafts`.
//!
//! Key decisions:
//! - **The Tauri shells only supply a `live_context` provider** and the
//!   caller's `DraftOwner`. Every decision is in the tested `*_logged_with` /
//!   `recover_draft_gated_with` seams and the guarded services under them.
//! - **Recover, discard and cleanup build the context under the draft lock**
//!   (`*_with`, ADR-0038 §4): order is `DraftGate` (recover only, outer) →
//!   `DRAFT_LOCK` → shadow-store mutex (inside `live_context`). A context
//!   snapshotted before the lock could be stale by the act. A recover can
//!   never mark a draft recovered after a committed quit deleted it (the
//!   relisting race in the D27 plan), and a closed gate builds no context.
//! - Listing takes no lock (read-only, fails open), so `list_drafts` builds
//!   its context up front. The `&LiveContext` seams are test-only wrappers.
//! - **`live_context`**: live labels are `app.webview_windows()`. A missing
//!   shadow store (unreachable: main.rs registers one) is an empty open set
//!   (A11; the owner check still applies); a
//!   poisoned one is `Err(ShadowUnavailable)`, which recover and discard
//!   refuse on and cleanup keeps everything for.
//! - **Logs carry counts and enums only**: `file.draft.list` / `.cleanup`
//!   log the count structs, `file.draft.recover` / `.discard` an `outcome` in
//!   {ok, in_use, not_found, error}, and failures `error = DraftError::kind()`.
//!   Never an id, path, title or window label.
//! - Wire compatibility: `list_drafts` still returns the entry array and
//!   `cleanup_old_drafts` the deleted count, as the frontend expects.
//!
//! @coordinates-with src-tauri/src/services/draft/guarded.rs
//! @coordinates-with src-tauri/src/services/draft/live_listing.rs
//! @coordinates-with src-tauri/src/commands/draft.rs
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::models::{LogEntryPayload, LogLevel, LogStatus, SharedShadowStore};
use crate::services::draft::{
    cleanup_old_drafts_for_with, discard_draft_guarded_with, list_drafts_for,
    recover_draft_guarded_with, session_id, CleanupCounts, DraftError, DraftListing,
    DraftMetadataEntry, DraftOwner, LiveContext, OpenSet, RecoverResult, ShadowUnavailable,
};
use crate::services::logger;
use crate::services::quit_guard::{DraftGate, QUIT_COMMITTED};

const EVENT_LIST: &str = "file.draft.list";
const EVENT_RECOVER: &str = "file.draft.recover";
const EVENT_DISCARD: &str = "file.draft.discard";
const EVENT_CLEANUP: &str = "file.draft.cleanup";

/// The outcome enum logged for a recover or discard failure.
fn outcome_of(err: &DraftError) -> &'static str {
    match err {
        DraftError::OwnedByLiveWindow | DraftError::OpenInWindow => "in_use",
        DraftError::NotFound { .. } => "not_found",
        DraftError::IoError { .. } | DraftError::ParseError { .. } => "error",
    }
}

/// Refusals are expected (a stale dialog row); real failures are errors.
fn fail_level(err: &DraftError) -> LogLevel {
    match err {
        DraftError::OwnedByLiveWindow | DraftError::OpenInWindow | DraftError::NotFound { .. } => {
            LogLevel::Warn
        }
        DraftError::IoError { .. } | DraftError::ParseError { .. } => LogLevel::Error,
    }
}

/// Run `op` between a `Start` line and one `Success` / `Fail` line for
/// `event`. `success` builds the success context; a failure logs only
/// `outcome` (when `with_outcome`) and `kind()`.
fn logged<T>(
    event: &str,
    with_outcome: bool,
    op: impl FnOnce() -> Result<T, DraftError>,
    success: impl FnOnce(&T) -> Value,
) -> Result<T, DraftError> {
    let action_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: event.to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: None,
        duration_ms: None,
        error: None,
    });
    let result = op();
    let duration_ms = Some(start.elapsed().as_millis() as u64);
    let (level, status, context, error) = match &result {
        Ok(value) => (LogLevel::Info, LogStatus::Success, success(value), None),
        Err(err) => {
            let context = if with_outcome {
                json!({ "outcome": outcome_of(err) })
            } else {
                json!({})
            };
            (fail_level(err), LogStatus::Fail, context, Some(err.kind()))
        }
    };
    logger::log_event(LogEntryPayload {
        level,
        event: event.to_string(),
        status,
        action_id: Some(action_id),
        context: Some(context),
        duration_ms,
        error: error.map(str::to_string),
    });
    result
}

/// Recover `document_id` for `caller` while `gate` is provably open, checking
/// against a copy of `ctx`; see [`recover_draft_gated_with`].
#[cfg(test)]
pub(crate) fn recover_draft_gated(
    gate: &DraftGate,
    document_id: &str,
    caller: &DraftOwner,
    ctx: &LiveContext,
) -> Result<RecoverResult, DraftError> {
    recover_draft_gated_with(gate, document_id, caller, || ctx.clone())
}

/// Recover `document_id` for `caller` while `gate` is provably open. The
/// gate's read guard is held for the whole guarded recover, which takes the
/// draft lock and only then runs `make_ctx`: gate → draft lock → shadow
/// store. No recover write lands after the gate closes, and a closed gate
/// never builds a context.
pub(crate) fn recover_draft_gated_with(
    gate: &DraftGate,
    document_id: &str,
    caller: &DraftOwner,
    make_ctx: impl FnOnce() -> LiveContext,
) -> Result<RecoverResult, DraftError> {
    gate.if_open(|| recover_draft_guarded_with(document_id, caller, make_ctx))
        .unwrap_or_else(|| {
            Err(DraftError::IoError {
                message: "a quit has committed: draft recovery is closed".to_string(),
            })
        })
}

/// The drafts to offer for recovery, logging the listing counts. Listing is
/// read-only and takes no lock, so the shell builds its context up front.
pub(crate) fn list_drafts_logged(ctx: &LiveContext) -> Result<DraftListing, DraftError> {
    logged(
        EVENT_LIST,
        false,
        || list_drafts_for(ctx),
        |listing| serde_json::to_value(listing.counts).unwrap_or(Value::Null),
    )
}

/// `recover_draft_logged_with` against a copy of `ctx`.
#[cfg(test)]
pub(crate) fn recover_draft_logged(
    gate: &DraftGate,
    document_id: &str,
    caller: &DraftOwner,
    ctx: &LiveContext,
) -> Result<RecoverResult, DraftError> {
    recover_draft_logged_with(gate, document_id, caller, || ctx.clone())
}

/// `recover_draft_gated_with`, logging its outcome.
pub(crate) fn recover_draft_logged_with(
    gate: &DraftGate,
    document_id: &str,
    caller: &DraftOwner,
    make_ctx: impl FnOnce() -> LiveContext,
) -> Result<RecoverResult, DraftError> {
    logged(
        EVENT_RECOVER,
        true,
        || recover_draft_gated_with(gate, document_id, caller, make_ctx),
        |_| json!({ "outcome": "ok" }),
    )
}

/// `discard_recovery_draft_logged_with` against a copy of `ctx`.
#[cfg(test)]
pub(crate) fn discard_recovery_draft_logged(
    document_id: &str,
    ctx: &LiveContext,
) -> Result<bool, DraftError> {
    discard_recovery_draft_logged_with(document_id, || ctx.clone())
}

/// The guarded discard from the recovery dialog, logging its outcome.
/// `Ok(false)` when there was nothing to delete.
pub(crate) fn discard_recovery_draft_logged_with(
    document_id: &str,
    make_ctx: impl FnOnce() -> LiveContext,
) -> Result<bool, DraftError> {
    logged(
        EVENT_DISCARD,
        true,
        || discard_draft_guarded_with(document_id, make_ctx),
        |deleted| json!({ "outcome": "ok", "deleted": deleted }),
    )
}

/// `cleanup_old_drafts_logged_with` against a copy of `ctx`.
#[cfg(test)]
pub(crate) fn cleanup_old_drafts_logged(ctx: &LiveContext) -> Result<CleanupCounts, DraftError> {
    cleanup_old_drafts_logged_with(|| ctx.clone())
}

/// Delete stale recovered drafts no live window uses, logging the counts.
pub(crate) fn cleanup_old_drafts_logged_with(
    make_ctx: impl FnOnce() -> LiveContext,
) -> Result<CleanupCounts, DraftError> {
    logged(
        EVENT_CLEANUP,
        false,
        || cleanup_old_drafts_for_with(make_ctx),
        |counts| serde_json::to_value(counts).unwrap_or(Value::Null),
    )
}

/// The running app as the draft rule sees it. Not unit-testable (needs an
/// `AppHandle`); the two-arm store mapping is left to review, per the matrix.
fn live_context(app: &AppHandle) -> LiveContext {
    let live_labels = app.webview_windows().into_keys().collect();
    let open = match app.try_state::<SharedShadowStore>() {
        // No shadow store registered. main.rs always registers one, so this is
        // unreachable in the app; plan A11 treats it as an empty open set.
        None => Ok(OpenSet::default()),
        Some(store) => match store.lock() {
            Ok(guard) => Ok(OpenSet::from_store(&guard)),
            Err(_) => Err(ShadowUnavailable),
        },
    };
    LiveContext {
        session_id: session_id().to_string(),
        live_labels,
        open,
    }
}

#[tauri::command]
pub async fn list_drafts(app: AppHandle) -> Result<Vec<DraftMetadataEntry>, DraftError> {
    list_drafts_logged(&live_context(&app)).map(|listing| listing.entries)
}

#[tauri::command]
pub async fn recover_draft(
    window: WebviewWindow,
    document_id: String,
) -> Result<RecoverResult, DraftError> {
    let caller = DraftOwner {
        session_id: session_id().to_string(),
        window_label: window.label().to_string(),
    };
    recover_draft_logged_with(&QUIT_COMMITTED, &document_id, &caller, || {
        live_context(window.app_handle())
    })
}

#[tauri::command]
pub async fn discard_recovery_draft(
    app: AppHandle,
    document_id: String,
) -> Result<bool, DraftError> {
    discard_recovery_draft_logged_with(&document_id, || live_context(&app))
}

#[tauri::command]
pub async fn cleanup_old_drafts(app: AppHandle) -> Result<usize, DraftError> {
    cleanup_old_drafts_logged_with(|| live_context(&app)).map(|counts| counts.deleted)
}
