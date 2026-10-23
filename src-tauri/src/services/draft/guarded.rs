//! Purpose: the click-time re-check for the recovery dialog (ADR-0038 §4):
//! `recover_draft_guarded[_with]` and `discard_draft_guarded[_with]`.
//!
//! Key decisions:
//! - **The draft lock is held from the check through the write or delete**,
//!   so no save, recover, discard or cleanup can land in between.
//! - **The `*_with` forms build the `LiveContext` under that lock**, once, so
//!   the check sees the windows and open set as they are at the act. The
//!   `&LiveContext` forms are `#[cfg(test)]` thin wrappers passing a clone of
//!   `ctx`: a caller-built context would reopen snapshot-before-lock.
//! - **Check order (A12, ADR-0127)**: missing → `NotFound` (discard: `Ok(false)`);
//!   corrupt → `ParseError` on recover, still deletable on discard; another
//!   live owner → `OwnedByLiveWindow`; unreadable shadow store →
//!   `ShadowStoreUnavailable`; a match in another window → `OpenInWindow`.
//!   Recover accepts a match only in its own calling window; Discard refuses
//!   any live use, including that window.
//! - **Fail closed on an unreadable store.** `owner::in_use` treats it as
//!   "nothing open", which is right for listing only, so this module checks
//!   `ctx.open` itself.
//! - Recover allows a match only in the calling window and returns its exact
//!   target plus a fresh claim; guarded Discard still refuses any live use.
//! - A successful recover stamps `recovered`, `owner = caller`, a fresh
//!   `last_modified` and a claim. Legacy two-file drafts pass the same
//!   open-set check and are converted to a claimed bundle after the legacy read.
//!   If `load_draft`'s unlocked
//!   migrate-on-read turned the pair into a bundle in between, that call
//!   returns `NotFound` rather than recovering an unchecked bundle.
//!
//! @coordinates-with src-tauri/src/services/draft/owner.rs
//! @coordinates-with src-tauri/src/services/draft/lock.rs
use chrono::Utc;
use std::fs;
use std::path::Path;
use std::sync::MutexGuard;

use crate::models::DraftMetadata;

use super::lock::draft_lock;
use super::owner::recovery_target;
use super::paths::{bundle_path, legacy_draft_path, legacy_meta_path};
use super::recovery::recover_draft;
use super::{
    delete_draft_locked, in_use, owner_is_live, write_bundle_atomic, DraftBundle, DraftClaimToken,
    DraftError, DraftOwner, InUseReason, LiveContext, RecoverResult,
};

fn io_error(err: std::io::Error) -> DraftError {
    DraftError::IoError {
        message: err.to_string(),
    }
}

fn parse_error(err: serde_json::Error) -> DraftError {
    DraftError::ParseError {
        message: err.to_string(),
    }
}

/// A12 steps 2-4: refuse a draft that a live window is using.
fn refuse_if_in_use(
    document_id: &str,
    original_path: Option<&str>,
    owner: Option<&DraftOwner>,
    ctx: &LiveContext,
) -> Result<(), DraftError> {
    if owner_is_live(owner, ctx) {
        return Err(DraftError::OwnedByLiveWindow);
    }
    if ctx.open.is_err() {
        return Err(DraftError::ShadowStoreUnavailable);
    }
    match in_use(document_id, original_path, owner, ctx) {
        Some(InUseReason::OwnedByLiveWindow) => Err(DraftError::OwnedByLiveWindow),
        Some(InUseReason::OpenInWindow) => Err(DraftError::OpenInWindow),
        None => Ok(()),
    }
}

/// The `originalPath` of a legacy two-file draft; `None` without metadata.
fn legacy_original_path(document_id: &str) -> Result<Option<String>, DraftError> {
    let meta = legacy_meta_path(document_id)?;
    if !meta.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&meta).map_err(io_error)?;
    let meta: DraftMetadata = serde_json::from_str(&raw).map_err(parse_error)?;
    Ok(meta.original_path)
}

/// Recover `document_id` for `caller`, unless a live window is using it.
/// Checks against a copy of `ctx`; see [`recover_draft_guarded_with`].
/// Test-only: a caller-built `ctx` is the snapshot-before-lock pattern.
#[cfg(test)]
pub(crate) fn recover_draft_guarded(
    document_id: &str,
    caller: &DraftOwner,
    ctx: &LiveContext,
) -> Result<RecoverResult, DraftError> {
    recover_draft_guarded_with(document_id, caller, || ctx.clone())
}

/// Recover `document_id` for `caller`, building the context with `make_ctx`
/// once, under the draft lock, so the check sees the app as it is at the act.
pub fn recover_draft_guarded_with(
    document_id: &str,
    caller: &DraftOwner,
    make_ctx: impl FnOnce() -> LiveContext,
) -> Result<RecoverResult, DraftError> {
    let path = bundle_path(document_id)?;
    let held = draft_lock();
    let ctx = make_ctx();
    recover_locked(&held, document_id, caller, &path, &ctx)
}

/// The recover check-then-act. `_held` is the caller's draft-lock guard.
fn recover_locked(
    _held: &MutexGuard<'static, ()>,
    document_id: &str,
    caller: &DraftOwner,
    path: &Path,
    ctx: &LiveContext,
) -> Result<RecoverResult, DraftError> {
    if path.exists() {
        let raw = fs::read_to_string(path).map_err(io_error)?;
        let mut bundle: DraftBundle = serde_json::from_str(&raw).map_err(parse_error)?;
        let target = recovery_target(
            document_id,
            bundle.original_path.as_deref(),
            bundle.owner.as_ref(),
            caller,
            ctx,
        )?;
        let token = DraftClaimToken {
            source_id: document_id.into(),
            nonce: uuid::Uuid::new_v4().to_string(),
            session_id: caller.session_id.clone(),
        };
        bundle.recovered = true;
        bundle.owner = Some(caller.clone());
        bundle.claim = Some(token.clone());
        bundle.claim_consumed = false;
        bundle.last_modified = Utc::now().to_rfc3339();
        write_bundle_atomic(path, &bundle, document_id)?;
        return Ok(RecoverResult {
            content: bundle.content,
            original_path: bundle.original_path,
            title: bundle.title,
            hold_gen: 0,
            target,
            claim_token: token,
        });
    }

    if !legacy_draft_path(document_id)?.exists() {
        return Err(DraftError::NotFound {
            document_id: document_id.to_string(),
        });
    }
    let original_path = legacy_original_path(document_id)?;
    let target = recovery_target(document_id, original_path.as_deref(), None, caller, ctx)?;
    let token = DraftClaimToken {
        source_id: document_id.into(),
        nonce: uuid::Uuid::new_v4().to_string(),
        session_id: caller.session_id.clone(),
    };
    let result = recover_draft(document_id, target, token.clone())?;
    let bundle = DraftBundle {
        revision: String::new(),
        owner: Some(caller.clone()),
        claim: Some(token),
        claim_consumed: false,
        content: result.content.clone(),
        original_path: result.original_path.clone(),
        last_modified: Utc::now().to_rfc3339(),
        recovered: true,
        title: result.title.clone(),
    };
    write_bundle_atomic(path, &bundle, document_id)?;
    let _ = fs::remove_file(legacy_draft_path(document_id)?);
    let _ = fs::remove_file(legacy_meta_path(document_id)?);
    Ok(result)
}

/// Delete `document_id`'s draft from the recovery dialog, unless a live window
/// is using it. `Ok(false)` when there was nothing to delete. Checks against a
/// copy of `ctx`; see [`discard_draft_guarded_with`]. Test-only, as above.
#[cfg(test)]
pub(crate) fn discard_draft_guarded(
    document_id: &str,
    ctx: &LiveContext,
) -> Result<bool, DraftError> {
    discard_draft_guarded_with(document_id, || ctx.clone())
}

/// [`discard_draft_guarded`], building the context with `make_ctx` once,
/// under the draft lock.
pub fn discard_draft_guarded_with(
    document_id: &str,
    make_ctx: impl FnOnce() -> LiveContext,
) -> Result<bool, DraftError> {
    let path = bundle_path(document_id)?;
    let legacy_md = legacy_draft_path(document_id)?;
    let legacy_meta = legacy_meta_path(document_id)?;
    let _held = draft_lock();
    let ctx = make_ctx();

    if path.exists() {
        // An unreadable or corrupt bundle stays deletable (A6); only its id
        // can still be checked against the open set.
        let bundle = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<DraftBundle>(&raw).ok());
        match &bundle {
            Some(b) => refuse_if_in_use(
                document_id,
                b.original_path.as_deref(),
                b.owner.as_ref(),
                &ctx,
            )?,
            None => refuse_if_in_use(document_id, None, None, &ctx)?,
        }
    } else if legacy_md.exists() || legacy_meta.exists() {
        // Corrupt legacy metadata stays deletable; only the id is checked then.
        let original_path = legacy_original_path(document_id).unwrap_or_default();
        refuse_if_in_use(document_id, original_path.as_deref(), None, &ctx)?;
    } else {
        return Ok(false);
    }
    delete_draft_locked(document_id, None, true)
}

#[cfg(all(test, unix))]
#[path = "guarded_discard_tests.rs"]
mod guarded_discard_tests;
#[cfg(all(test, unix))]
#[path = "guarded_tests.rs"]
mod guarded_tests;
