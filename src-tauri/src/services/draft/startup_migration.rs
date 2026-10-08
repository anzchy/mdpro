//! Purpose: the startup legacy-draft migration with its `app.draft_migration`
//! log line, extracted from `main.rs` (ADR-0047 WI-002 / WI-3) so `main()`
//! stays inside its line budget. Behaviour, ordering and log lines unchanged.
//!
//! Key decisions:
//! - Best-effort: a failure is logged at `error` and returned from normally,
//!   so startup is never blocked.
//! - Nothing migrated → no line at all (no `filesMigrated: 0`).
//!
//! @coordinates-with src-tauri/src/main.rs (called once, after `app.launch`
//! and before the Tauri builder)
use serde_json::json;

use super::migrate_legacy_drafts;
use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;

/// One-time migration: move legacy drafts from `~/.mdpro/drafts` (pre-audit-128
/// location) to the current data_dir path, logging one `app.draft_migration`
/// line on success with a non-zero count, or one on failure.
pub fn migrate_legacy_drafts_logged() {
    match migrate_legacy_drafts() {
        Ok(0) => {} // nothing to migrate
        Ok(n) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "app.draft_migration".to_string(),
                status: LogStatus::Success,
                action_id: None,
                context: Some(json!({ "filesMigrated": n })),
                duration_ms: None,
                error: None,
            });
        }
        Err(e) => {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Error,
                event: "app.draft_migration".to_string(),
                status: LogStatus::Fail,
                action_id: None,
                context: None,
                duration_ms: None,
                error: Some(e.to_string()),
            });
        }
    }
}

#[cfg(test)]
#[path = "startup_migration_tests.rs"]
mod startup_migration_tests;
