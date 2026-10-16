//! Purpose: moves stored keyboard shortcuts from one defaults version to the
//! next (ADR-0114 Decision 9, M1a WI-2).
//!
//! Pipeline: `load_preferences_locked_with` parses `config.json` → repairs
//! `""` bindings (D-b) → [`migrate`] → writes back once when the stamp moved,
//! under the caller's `PrefsGuard` → [`log_write_back`].
//!
//! Key decisions:
//! - A value moves only when it equals **its own** from-version default; a
//!   custom value, a sentinel and another field's default are kept verbatim.
//! - The stamp moves `from → to` whenever the stored stamp is `from`, even
//!   with no value changed: the stamp is itself the change (M17).
//! - The repair runs **before** the migration, so a `""` is read as the v1
//!   default it stands for and migrated with it (M16).
//! - M1a ships [`PRODUCTION_PLAN`] with `to == CURRENT == 1` and an empty map,
//!   so a production load never moves a document and never writes.
//!
//! @coordinates-with models/keyboard_shortcuts_version.rs — the stamp and
//!   `CURRENT_KEYBOARD_SHORTCUTS_VERSION`
//! @coordinates-with services/preferences.rs — the loader that runs it

use serde_json::Value;

use crate::models::{
    KeyboardShortcuts, LogEntryPayload, LogLevel, LogStatus, UserPreferences,
    CURRENT_KEYBOARD_SHORTCUTS_VERSION,
};
use crate::services::logger;
use crate::services::preferences::{save_preferences, PreferencesError};
use crate::services::prefs_guard::PrefsGuard;

/// One binding whose default changed between two versions, by wire name.
#[derive(Debug, Clone, Copy)]
pub struct MappedDefault {
    pub field: &'static str,
    pub from: &'static str,
    pub to: &'static str,
}

/// A single version step: documents stamped `from` move to `to`. A plan with
/// `to <= from` moves nothing.
#[derive(Debug, Clone, Copy)]
pub struct MigrationPlan {
    pub from: u32,
    pub to: u32,
    pub map: &'static [MappedDefault],
}

/// What a migration did. `WriteFailed` is the loader's: the document was
/// migrated in memory but the write-back failed, so the next load retries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MigrationOutcome {
    Unchanged,
    Migrated { changed_count: usize },
    WriteFailed { changed_count: usize },
}

/// The v1 → v2 default changes. Empty in M1a: the real map lands with M1b,
/// together with `CURRENT_KEYBOARD_SHORTCUTS_VERSION = 2`.
const V1_TO_V2_DEFAULTS: &[MappedDefault] = &[];

/// The plan production loads run. Its target is CURRENT, so while CURRENT is
/// 1 it is a no-op.
pub const PRODUCTION_PLAN: MigrationPlan = MigrationPlan {
    from: 1,
    to: CURRENT_KEYBOARD_SHORTCUTS_VERSION,
    map: V1_TO_V2_DEFAULTS,
};

/// Pure. When `prefs` is stamped `plan.from`, replaces each mapped binding
/// equal to its from-version default with its to-version default and stamps
/// `plan.to`; otherwise returns `prefs` untouched with `Unchanged`.
pub fn migrate(
    mut prefs: UserPreferences,
    plan: &MigrationPlan,
) -> (UserPreferences, MigrationOutcome) {
    if prefs.keyboard_shortcuts_version != plan.from || plan.to <= plan.from {
        return (prefs, MigrationOutcome::Unchanged);
    }
    let Ok(Value::Object(mut bindings)) = serde_json::to_value(&prefs.keyboard_shortcuts) else {
        return (prefs, MigrationOutcome::Unchanged);
    };
    let mut changed_count = 0;
    for mapped in plan.map {
        if bindings.get(mapped.field).and_then(Value::as_str) == Some(mapped.from) {
            bindings.insert(mapped.field.to_string(), Value::from(mapped.to));
            changed_count += 1;
        }
    }
    if changed_count > 0 {
        match serde_json::from_value::<KeyboardShortcuts>(Value::Object(bindings)) {
            Ok(shortcuts) => prefs.keyboard_shortcuts = shortcuts,
            Err(_) => return (prefs, MigrationOutcome::Unchanged),
        }
    }
    prefs.keyboard_shortcuts_version = plan.to;
    (prefs, MigrationOutcome::Migrated { changed_count })
}

/// Runs `plan` on a freshly loaded document and, when the stamp moved, writes
/// it back once under the caller's guard. A failed write keeps the migrated
/// document and reports `WriteFailed`; the file still holds the old stamp, so
/// the next load retries. Every attempted write-back is logged.
pub(crate) fn migrate_loaded(
    _guard: &PrefsGuard<'_>,
    prefs: UserPreferences,
    plan: &MigrationPlan,
) -> (UserPreferences, MigrationOutcome) {
    let (migrated, outcome) = migrate(prefs, plan);
    let MigrationOutcome::Migrated { changed_count } = outcome else {
        return (migrated, outcome);
    };
    match save_preferences(&migrated) {
        Ok(()) => {
            log_write_back(plan, outcome, None);
            (migrated, outcome)
        }
        Err(err) => {
            let failed = MigrationOutcome::WriteFailed { changed_count };
            let message = match err {
                PreferencesError::IoError { message }
                | PreferencesError::ParseError { message } => message,
                PreferencesError::ReentrantLoad => "ReentrantLoad".to_string(),
            };
            log_write_back(plan, failed, Some(message));
            (migrated, failed)
        }
    }
}

/// Logs one `preferences.shortcuts.migrate` line for an attempted write-back.
/// The context is exactly `{fromVersion, toVersion, changedCount, outcome}`:
/// no chord and no path.
fn log_write_back(plan: &MigrationPlan, outcome: MigrationOutcome, error: Option<String>) {
    let (level, status, name, changed_count) = match outcome {
        MigrationOutcome::Migrated { changed_count } => (
            LogLevel::Info,
            LogStatus::Success,
            "migrated",
            changed_count,
        ),
        MigrationOutcome::WriteFailed { changed_count } => (
            LogLevel::Warn,
            LogStatus::Fail,
            "writeFailed",
            changed_count,
        ),
        MigrationOutcome::Unchanged => return,
    };
    logger::log_event(LogEntryPayload {
        level,
        event: "preferences.shortcuts.migrate".to_string(),
        status,
        action_id: Some(uuid::Uuid::new_v4().to_string()),
        context: Some(serde_json::json!({
            "fromVersion": plan.from,
            "toVersion": plan.to,
            "changedCount": changed_count,
            "outcome": name,
        })),
        duration_ms: None,
        error,
    });
}

#[cfg(test)]
#[path = "preferences_migration_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "preferences_migration_load_tests.rs"]
mod load_tests;

#[cfg(test)]
#[path = "preferences_migration_writeback_tests.rs"]
mod writeback_tests;
