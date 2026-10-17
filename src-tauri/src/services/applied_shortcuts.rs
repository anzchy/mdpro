//! Purpose: the applied keyboard-shortcut snapshot (M1a WI-4, ADR-0114): the
//! bindings this run actually uses, resolved once at startup and fixed for
//! the run (restart-to-apply). Served to the frontend by
//! `commands/shortcuts.rs::get_applied_shortcuts`.
//!
//! Pipeline: `main.rs` `.setup` → [`snapshot_at_startup`] (the public guarded
//! `load_preferences`, then [`resolve_applied`]) → `app.manage(AppliedShortcutsState)`
//! before `build_menu` → `get_applied_shortcuts` reads it.
//!
//! Key decisions:
//! - [`AppliedShortcutsState`] has no setter. A Settings save writes
//!   `config.json` but cannot change what this run reports as applied.
//! - A failed load resolves `KeyboardShortcuts::default()` with
//!   `source: defaultsAfterLoadFailure` and writes nothing, matching the
//!   frontend's fallback when `get_preferences` fails.
//! - `keyboardShortcutsVersion` is the loaded (post-migration) document's
//!   version; CURRENT only on the fallback path.
//! - M1a resolves stored values only: `"<unassigned>"` → unassigned,
//!   `"<system>"` → system, `""` → bound to the default (defensive: the D-b
//!   repair already removed it), anything else → bound verbatim. The conflict
//!   filter (`services/binding_conflicts.rs`, M1a WI-8) exists but is inert;
//!   M1b wires it in.
//! - Logs carry the source and counts only: never a chord, a sentinel or a path.
//!
//! @coordinates-with services/preferences.rs — `load_preferences`, the run's
//!   one migrating load at startup
//! @coordinates-with src/types/keyboardShortcuts.ts — the TS twin of the wire
//!   shape; both are held to `tests/fixtures/applied-shortcuts-contract.json`

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

use crate::models::{
    KeyboardShortcuts, LogEntryPayload, LogLevel, LogStatus, CURRENT_KEYBOARD_SHORTCUTS_VERSION,
    SYSTEM_BINDING, UNASSIGNED_BINDING,
};
use crate::services::logger;
use crate::services::preferences::{load_preferences, PreferencesError};

const RESOLVE_EVENT: &str = "preferences.shortcuts.applied.resolve";

/// One applied binding. Serialises as `{"state":"bound","chord":…}`,
/// `{"state":"unassigned"}` or `{"state":"system"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum AppliedBinding {
    Bound { chord: String },
    Unassigned,
    System,
}

/// Where the snapshot came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppliedSource {
    Loaded,
    DefaultsAfterLoadFailure,
}

impl AppliedSource {
    fn as_str(self) -> &'static str {
        match self {
            AppliedSource::Loaded => "loaded",
            AppliedSource::DefaultsAfterLoadFailure => "defaultsAfterLoadFailure",
        }
    }
}

/// The wire shape of `get_applied_shortcuts`. `bindings` is keyed by the same
/// camelCase field names as the stored `keyboardShortcuts` group, and is a
/// `BTreeMap` so its order is deterministic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedShortcuts {
    pub keyboard_shortcuts_version: u32,
    pub source: AppliedSource,
    pub bindings: BTreeMap<String, AppliedBinding>,
}

/// How many bindings are in each state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BindingCounts {
    pub bound: usize,
    pub unassigned: usize,
    pub system: usize,
}

/// Counts `bindings` by state.
pub fn binding_counts(bindings: &BTreeMap<String, AppliedBinding>) -> BindingCounts {
    bindings
        .values()
        .fold(BindingCounts::default(), |mut c, b| {
            match b {
                AppliedBinding::Bound { .. } => c.bound += 1,
                AppliedBinding::Unassigned => c.unassigned += 1,
                AppliedBinding::System => c.system += 1,
            }
            c
        })
}

fn as_object(k: &KeyboardShortcuts) -> serde_json::Map<String, Value> {
    match serde_json::to_value(k) {
        Ok(Value::Object(m)) => m,
        // Unreachable: a struct of strings always serialises to an object.
        _ => serde_json::Map::new(),
    }
}

/// Resolves every stored binding to its applied state. Pure: one entry per
/// `KeyboardShortcuts` field, under its camelCase name.
pub fn resolve_applied(shortcuts: &KeyboardShortcuts) -> BTreeMap<String, AppliedBinding> {
    let defaults = as_object(&KeyboardShortcuts::default());
    as_object(shortcuts)
        .into_iter()
        .map(|(field, value)| {
            let stored = value.as_str().unwrap_or_default();
            let binding = match stored {
                UNASSIGNED_BINDING => AppliedBinding::Unassigned,
                SYSTEM_BINDING => AppliedBinding::System,
                "" => AppliedBinding::Bound {
                    chord: defaults
                        .get(&field)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                },
                chord => AppliedBinding::Bound {
                    chord: chord.to_string(),
                },
            };
            (field, binding)
        })
        .collect()
}

/// The variant name of a load error: never its message, which can carry a path.
fn error_kind(e: &PreferencesError) -> &'static str {
    match e {
        PreferencesError::IoError { .. } => "IoError",
        PreferencesError::ParseError { .. } => "ParseError",
        PreferencesError::ReentrantLoad => "ReentrantLoad",
    }
}

/// Resolves the run's applied snapshot from the public guarded loader. On a
/// load failure it resolves the defaults with `source:
/// defaultsAfterLoadFailure`, writes nothing, and logs `Fail`.
pub fn snapshot_at_startup() -> AppliedShortcuts {
    let started = Instant::now();
    let action_id = uuid::Uuid::new_v4().to_string();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: RESOLVE_EVENT.to_string(),
        status: LogStatus::Start,
        action_id: Some(action_id.clone()),
        context: None,
        duration_ms: None,
        error: None,
    });

    let (snapshot, failure) = match load_preferences() {
        Ok(prefs) => (
            AppliedShortcuts {
                keyboard_shortcuts_version: prefs.keyboard_shortcuts_version,
                source: AppliedSource::Loaded,
                bindings: resolve_applied(&prefs.keyboard_shortcuts),
            },
            None,
        ),
        Err(e) => (
            AppliedShortcuts {
                keyboard_shortcuts_version: CURRENT_KEYBOARD_SHORTCUTS_VERSION,
                source: AppliedSource::DefaultsAfterLoadFailure,
                bindings: resolve_applied(&KeyboardShortcuts::default()),
            },
            Some(error_kind(&e)),
        ),
    };

    let counts = binding_counts(&snapshot.bindings);
    logger::log_event(LogEntryPayload {
        level: if failure.is_some() {
            LogLevel::Warn
        } else {
            LogLevel::Info
        },
        event: RESOLVE_EVENT.to_string(),
        status: if failure.is_some() {
            LogStatus::Fail
        } else {
            LogStatus::Success
        },
        action_id: Some(action_id),
        context: Some(json!({
            "source": snapshot.source.as_str(),
            "boundCount": counts.bound,
            "unassignedCount": counts.unassigned,
            "systemCount": counts.system,
        })),
        duration_ms: Some(u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)),
        error: failure.map(str::to_string),
    });
    snapshot
}

/// The run's applied snapshot, as Tauri managed state. Built once in `setup`;
/// it has no setter, so nothing after startup can change it.
#[derive(Debug, Clone)]
pub struct AppliedShortcutsState(Arc<AppliedShortcuts>);

impl AppliedShortcutsState {
    pub fn new(snapshot: AppliedShortcuts) -> Self {
        Self(Arc::new(snapshot))
    }

    /// The snapshot, read-only.
    pub fn snapshot(&self) -> &AppliedShortcuts {
        &self.0
    }
}

#[cfg(test)]
#[path = "applied_shortcuts_tests.rs"]
mod applied_shortcuts_tests;

#[cfg(test)]
#[path = "applied_shortcuts_startup_tests.rs"]
mod applied_shortcuts_startup_tests;
