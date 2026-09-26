//! Log vocabulary for per-file window-geometry restore (D24 follow-up, WI-3).
//!
//! Purpose: turn a [`RestoreOutcome`] into the fields and level of the
//! `window.open` / `window.create` Success lines, so the whole log object has a
//! testable shape instead of being assembled inside untestable builder glue.
//!
//! @coordinates-with services/window_restore.rs (re-exports everything here),
//! services/open_route/tauri_glue.rs, commands/window.rs

use super::{GeometrySource, RestoreOutcome, RestoreReason};
use crate::models::LogLevel;
use serde_json::{json, Value};

/// The restore part of a Success log line: exactly `geometry`,
/// `geometryReason` and `geometryClamped`. Enum strings and a bool only — no
/// path and no coordinate ever enters the log from here.
pub(crate) fn restore_log_fields(outcome: &RestoreOutcome) -> Value {
    let geometry = match outcome.source {
        GeometrySource::Stored => "stored",
        GeometrySource::Default => "default",
    };
    let reason = match outcome.reason {
        RestoreReason::Stored => "stored",
        RestoreReason::NoPath => "no_path",
        RestoreReason::NoRecord => "no_record",
        RestoreReason::ReadFailed => "read_failed",
    };
    json!({
        "geometry": geometry,
        "geometryReason": reason,
        "geometryClamped": outcome.clamped,
    })
}

/// `Warn` for a read failure, `Info` otherwise. Never `Error`: the window
/// opened either way, so the line's status stays `Success`.
pub(crate) fn restore_log_level(outcome: &RestoreOutcome) -> LogLevel {
    match outcome.reason {
        RestoreReason::ReadFailed => LogLevel::Warn,
        RestoreReason::Stored | RestoreReason::NoPath | RestoreReason::NoRecord => LogLevel::Info,
    }
}

/// The `window.open` Success context: the pre-existing `windowId`,
/// `windowLabel` and `filePath`, plus [`restore_log_fields`] merged top-level.
pub(crate) fn window_open_context(
    window_id: &str,
    label: &str,
    path: &str,
    outcome: &RestoreOutcome,
) -> Value {
    with_restore_fields(
        json!({ "windowId": window_id, "windowLabel": label, "filePath": path }),
        outcome,
    )
}

/// The `window.create` Success context: the pre-existing `windowId` and
/// `filePath` (`null` when absent), plus [`restore_log_fields`] merged top-level.
pub(crate) fn window_create_context(
    window_id: &str,
    file_path: Option<&str>,
    outcome: &RestoreOutcome,
) -> Value {
    with_restore_fields(
        json!({ "windowId": window_id, "filePath": file_path }),
        outcome,
    )
}

fn with_restore_fields(mut base: Value, outcome: &RestoreOutcome) -> Value {
    if let (Some(obj), Value::Object(fields)) = (base.as_object_mut(), restore_log_fields(outcome))
    {
        obj.extend(fields);
    }
    base
}
