//! Atomic owner/focus read for the MCP write gate (ADR-0042). Kept out of
//! `shadow_store.rs`, which is already past the 300-line limit, and
//! re-exported from it as `shadow_store::owner_and_focus`.

use crate::models::SharedShadowStore;

/// The window holding `doc_id` and the focused window, read under one lock
/// acquisition so a concurrent focus change cannot tear the pair.
///
/// A poisoned lock is an `Err`, never a panic. Used by the MCP write
/// confirmation gate; `get_status` keeps `is_any_window_focused`.
pub fn owner_and_focus(
    store: &SharedShadowStore,
    doc_id: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let shadow = store
        .lock()
        .map_err(|e| format!("Failed to lock shadow store: {}", e))?;

    let owner = shadow
        .find_window_for_document(doc_id)
        .map(|s| s.to_string());
    Ok((owner, shadow.focused_window.clone()))
}
