//! Per-file window-geometry restore (D24 follow-up).
//!
//! Purpose: find the geometry stored in `windowStates` for a file, under any
//! spelling of its path, so a window opened for that file can come back where
//! the user left it.
//!
//! @coordinates-with services/open_route/lookup.rs (`same_file`, `canonical`),
//! services/window_geometry.rs, commands/window.rs
//!
//! Key decisions:
//! - **One path-identity rule.** Keys are compared with `open_route`'s
//!   `same_file` (ADR-0033 decision 2): canonical forms when both sides
//!   canonicalize, the raw string otherwise. So a symlink, `/./` or
//!   `/tmp`↔`/private/tmp` spelling finds the entry, and a key for a file that
//!   no longer exists still matches its exact raw spelling.
//! - **Aliases resolve by a total order**: largest `last_accessed`, then the
//!   lexicographically smallest key (the eviction tie-break in
//!   `commands/window.rs`), so the result never depends on `HashMap` order.
//! - **No `services → commands` dependency**; the pure rules it builds on live
//!   in `services/window_geometry.rs`.

use crate::models::WindowGeometry;
use crate::services::open_route::lookup::{canonical, same_file};
use crate::services::preferences::{
    load_preferences_locked, preferences_rw_lock, PreferencesError,
};
use crate::services::prefs_guard::{GuardError, PrefsGuard};
use crate::services::window_geometry::{
    resolve_window_geometry, ResolvedGeometry, WorkArea, FALLBACK_WORK_AREA, MIN_WINDOW_SIZE,
};
use std::collections::HashMap;

#[path = "window_restore_log.rs"]
mod restore_log;
#[cfg(test)]
pub(crate) use restore_log::restore_log_fields;
pub(crate) use restore_log::{restore_log_level, window_create_context, window_open_context};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, WebviewWindowBuilder};

/// The entry of `states` whose key names the same file as `path`, or `None`.
///
/// When several keys are aliases of that file, the one with the largest
/// `last_accessed` wins; equal timestamps go to the smallest key. The returned
/// value is always a clone of an input entry, never a merged one.
pub(crate) fn find_stored_geometry(
    states: &HashMap<String, WindowGeometry>,
    path: &str,
) -> Option<WindowGeometry> {
    let incoming_canon = canonical(path);
    states
        .iter()
        .filter(|(key, _)| same_file(path, incoming_canon.as_ref(), key))
        .min_by(|(ka, a), (kb, b)| {
            b.last_accessed
                .cmp(&a.last_accessed)
                .then_with(|| ka.cmp(kb))
        })
        .map(|(_, g)| g.clone())
}

/// Where a window's geometry came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GeometrySource {
    Stored,
    Default,
}

/// Why the window got the geometry it got.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RestoreReason {
    Stored,
    NoPath,
    NoRecord,
    ReadFailed,
}

/// The typed outcome of a restore decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RestoreOutcome {
    pub source: GeometrySource,
    pub reason: RestoreReason,
    pub clamped: bool,
}

/// Why the stored geometry could not be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RestoreReadError {
    LockPoisoned,
    Io(String),
    Parse(String),
}

/// Decide what geometry a window opened for `path` gets, and why.
///
/// Pure. `path == None` (⌘⇧N) is `NoPath` whatever `read` holds, so a new
/// empty window never inherits a record. Every non-`Stored` result is exactly
/// `resolve_window_geometry(None, …)`: no position (the window server
/// cascades) and the fitted default size. A `Stored` result is the one clamp
/// (`clamp_geometry` via `resolve_window_geometry`), and `clamped` is true
/// exactly when that clamp changed the record — a legacy 2x entry or a
/// display that moved.
pub(crate) fn decide_window_geometry(
    path: Option<&str>,
    read: Result<Option<WindowGeometry>, RestoreReadError>,
    work_area: WorkArea,
) -> (ResolvedGeometry, RestoreOutcome) {
    let default = |reason| {
        (
            resolve_window_geometry(None, work_area, MIN_WINDOW_SIZE),
            RestoreOutcome {
                source: GeometrySource::Default,
                reason,
                clamped: false,
            },
        )
    };
    if path.is_none() {
        return default(RestoreReason::NoPath);
    }
    match read {
        Err(_) => default(RestoreReason::ReadFailed),
        Ok(None) => default(RestoreReason::NoRecord),
        Ok(Some(g)) => {
            let resolved = resolve_window_geometry(Some(g.clone()), work_area, MIN_WINDOW_SIZE);
            let clamped = resolved.position != Some((f64::from(g.x), f64::from(g.y)))
                || resolved.size != (f64::from(g.width), f64::from(g.height));
            (
                resolved,
                RestoreOutcome {
                    source: GeometrySource::Stored,
                    reason: RestoreReason::Stored,
                    clamped,
                },
            )
        }
    }
}

/// Message of the `Io` error a reentrant read becomes. It decides exactly as
/// any other read failure does (`ReadFailed`), and carries no path.
const REENTRANT: &str = "ReentrantLoad";

/// Read `path`'s stored geometry, holding `lock` (as a `PrefsGuard`) only while
/// `config.json` is loaded.
///
/// The seam behind [`read_stored_geometry`]: tests inject a genuinely
/// poisoned mutex here instead of poisoning the process-global one. A poisoned
/// lock is `LockPoisoned` — never read through with `into_inner`; a thread
/// that already holds a guard is refused, not deadlocked. A parse or
/// I/O failure is returned as-is; nothing here writes `config.json` back, so a
/// corrupt file is left byte-for-byte alone.
///
/// The guard is dropped before [`find_stored_geometry`] runs: that lookup
/// canonicalizes up to 100 keys, which can stall on a slow or network volume,
/// and it works on an owned copy of the preferences, so holding the lock
/// through it would only block `save_window_geometry` for nothing.
pub(crate) fn read_stored_geometry_in(
    lock: &Mutex<()>,
    path: &str,
) -> Result<Option<WindowGeometry>, RestoreReadError> {
    let prefs = {
        let guard = PrefsGuard::acquire_in(lock).map_err(|e| match e {
            GuardError::Poisoned => RestoreReadError::LockPoisoned,
            GuardError::Reentrant => RestoreReadError::Io(REENTRANT.to_string()),
        })?;
        load_preferences_locked(&guard).map_err(|e| match e {
            PreferencesError::IoError { message } => RestoreReadError::Io(message),
            PreferencesError::ParseError { message } => RestoreReadError::Parse(message),
            PreferencesError::ReentrantLoad => RestoreReadError::Io(REENTRANT.to_string()),
        })?
    };
    Ok(find_stored_geometry(&prefs.window_states, path))
}

/// Read `path`'s stored geometry under the global `preferences_rw_lock`.
///
/// Holding the lock matters on first run: `load_preferences` materialises a
/// default `config.json` when none exists, and doing that unlocked could
/// overwrite a concurrent `save_window_geometry`.
pub(crate) fn read_stored_geometry(path: &str) -> Result<Option<WindowGeometry>, RestoreReadError> {
    read_stored_geometry_in(preferences_rw_lock(), path)
}

/// Read `path`'s stored geometry and decide the window's geometry from it:
/// the one entry point both window-building sites use. `None` (a window with
/// no file) never touches disk.
pub(crate) fn restore_geometry_for(
    path: Option<&str>,
    work_area: WorkArea,
) -> (ResolvedGeometry, RestoreOutcome) {
    let read = match path {
        Some(p) => read_stored_geometry(p),
        None => Ok(None),
    };
    decide_window_geometry(path, read, work_area)
}

/// The primary monitor's work area in logical points, or [`FALLBACK_WORK_AREA`]
/// when the platform reports no monitor. Clamping is against the primary
/// display only (multi-monitor is deferred).
pub(crate) fn primary_work_area(app: &AppHandle) -> WorkArea {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return FALLBACK_WORK_AREA;
    };
    let area = monitor.work_area();
    work_area_from_physical(
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
        monitor.scale_factor(),
    )
}

/// Convert a physical-pixel work area to logical points by dividing every
/// field by `scale`. Pure. A scale that is non-finite or `<= 0` is treated as
/// `1.0`, so a bogus platform report never yields NaN/infinite geometry.
pub(crate) fn work_area_from_physical(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
) -> WorkArea {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    WorkArea {
        x: f64::from(x) / scale,
        y: f64::from(y) / scale,
        width: f64::from(width) / scale,
        height: f64::from(height) / scale,
    }
}

/// Hand a resolved geometry to a window builder — the single place that calls
/// `min_inner_size`, `position` and `inner_size`. `position` only when `Some`
/// (so new windows cascade); `inner_size` always. Logical units throughout.
///
/// Builder glue: needs a live `AppHandle` and a window server, so it has no
/// unit test; covered by the WI-3 source pin and device checks D-1…D-4.
pub(crate) fn apply_resolved<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
    resolved: &ResolvedGeometry,
) -> WebviewWindowBuilder<'a, R, M> {
    let mut builder = builder
        .min_inner_size(MIN_WINDOW_SIZE.0, MIN_WINDOW_SIZE.1)
        .inner_size(resolved.size.0, resolved.size.1);
    if let Some((x, y)) = resolved.position {
        builder = builder.position(x, y);
    }
    builder
}

// The lookup fixture is shared with `open_route::lookup`, not copied. Only the
// `Fixture` part is used here, hence `dead_code`.
#[cfg(all(test, unix))]
#[allow(dead_code)]
#[path = "open_route/lookup_fixture.rs"]
mod restore_fixture;
#[cfg(test)]
#[path = "window_restore_test_home.rs"]
pub(crate) mod test_home;
#[cfg(test)]
#[path = "window_restore_area_tests.rs"]
mod window_restore_area_tests;
#[cfg(test)]
#[path = "window_restore_decide_tests.rs"]
mod window_restore_decide_tests;
#[cfg(test)]
#[path = "window_restore_log_tests.rs"]
mod window_restore_log_tests;
#[cfg(all(test, unix))]
#[path = "window_restore_lookup_tests.rs"]
mod window_restore_lookup_tests;
#[cfg(all(test, unix))]
#[path = "window_restore_read_tests.rs"]
mod window_restore_read_tests;
