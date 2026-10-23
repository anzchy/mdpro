//! Test composition for the D111 pending-change Save As refusal.
use super::super::file::{FileError, SaveResult};
use super::{refused_save_as, save_as_watched_with};
use crate::services::file_watcher::FileWatcher;

/// D111-WI-1: Save As with the refusal `save_file_dialog` applies first. When
/// `refuse_path` (the document's own path, sent only while it has an
/// unresolved external change) names the same file as `path`, nothing is
/// written or registered and the reply is `blocked_by_pending_change`; any
/// other target saves through [`save_as_watched_with`]. `save_file_dialog`
/// runs the same two steps inline (its D69 wiring pins the
/// `save_as_watched_with` call there), so this composition is test-only.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn save_as_checked_with(
    document_id: String,
    content: String,
    path: String,
    encoding: Option<String>,
    line_ending: Option<String>,
    action_id: Option<String>,
    refuse_path: Option<String>,
    watcher: &FileWatcher,
) -> Result<SaveResult, FileError> {
    if let Some(blocked) = refused_save_as(&path, refuse_path.as_deref(), action_id.as_deref()) {
        return Ok(blocked);
    }
    save_as_watched_with(
        document_id,
        content,
        path,
        encoding,
        line_ending,
        action_id,
        watcher,
    )
    .await
}
