//! Post-picker Save As transaction: validate, reserve, write and confirm together.
use super::file::{FileError, SaveResult};
use super::save_as_watch::{
    log_fenced_save_as, refuse_live_open_target, refuse_open_target,
    refuse_original_changed_during_dialog, save_as_watched_with,
};
use crate::models::SharedShadowStore;
use crate::services::file_watcher::{save_notice::SaveOrigin, FileWatcher};
use std::collections::HashSet;
use std::path::PathBuf;

pub(crate) struct SaveAsTransaction<'a> {
    pub label: &'a str,
    pub document_id: String,
    pub content: String,
    pub picked: String,
    pub original_path: Option<&'a str>,
    pub original_bytes: Option<&'a [u8]>,
    pub encoding: Option<String>,
    pub line_ending: Option<String>,
    pub action_id: &'a str,
    pub watcher: &'a FileWatcher,
    pub shadow: &'a SharedShadowStore,
    pub live_labels: &'a HashSet<String>,
}

/// The test seam runs after the first eligibility check, before reservation.
pub(crate) async fn save_as_post_picker(
    transaction: SaveAsTransaction<'_>,
    between_check_and_reserve: impl FnOnce(),
) -> Result<Option<SaveResult>, FileError> {
    let _guard = super::save_as_open_lock::lock().await;
    let SaveAsTransaction {
        label,
        document_id,
        content,
        picked,
        original_path,
        original_bytes,
        encoding,
        line_ending,
        action_id,
        watcher,
        shadow,
        live_labels,
    } = transaction;
    refuse_original_changed_during_dialog(&picked, original_path, original_bytes, Some(action_id))?;
    refuse_open_target(&picked, original_path, Some(action_id), watcher)?;
    refuse_live_open_target(
        &picked,
        label,
        &document_id,
        Some(action_id),
        shadow,
        live_labels,
    )?;
    between_check_and_reserve();
    // A test can inject a hold at the seam without taking this lock. Recheck
    // at the reservation boundary; real open routes serialize on the lock.
    refuse_open_target(&picked, original_path, Some(action_id), watcher)?;
    refuse_live_open_target(
        &picked,
        label,
        &document_id,
        Some(action_id),
        shadow,
        live_labels,
    )?;
    let raw = PathBuf::from(&picked);
    let Some(hold) = watcher
        .reserve_hold(label, &raw)
        .map(|r| r.without_reconcile())
    else {
        log_fenced_save_as(Some(action_id));
        return Ok(None);
    };
    let saved = save_as_watched_with(
        document_id.clone(),
        content,
        picked,
        encoding,
        line_ending,
        Some(action_id.to_string()),
        watcher,
    )
    .await;
    match saved {
        Ok(mut result) => {
            if watcher.confirm_hold(&hold) {
                result.hold_gen = hold.gen;
            }
            if let Some(written_to) = &result.written_to {
                watcher.notice_saved(
                    &SaveOrigin::new(label, &document_id),
                    &result.path,
                    written_to,
                    Some(action_id),
                );
            }
            Ok(Some(result))
        }
        Err(err) => {
            if !watcher.restore_hold(&hold) {
                watcher.release_hold(label, &raw, hold.gen);
            }
            Err(err)
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
#[path = "save_as_transaction_tests.rs"]
mod tests;
