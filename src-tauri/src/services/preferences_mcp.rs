//! Purpose: the one write path for `mcp.serverEnabled` (ADR-0040 WI-6).
//!
//! The MCP server switch (`mcp_set_server_enabled`, WI-7) persists the user's
//! intent here before it acts on the server. Generic `set_preferences` writes
//! stop carrying `serverEnabled` in WI-10, so this is where the value changes.
//!
//! Key decisions:
//! - **load → set → save under `preferences_rw_lock()`** (PC-3), held as a
//!   `PrefsGuard` for the whole span; the load is `load_preferences_locked`
//!   (M1a WI-1), because the public loader takes the lock itself. The same
//!   lock serialises `set_preferences` and `save_window_state`, so a
//!   concurrent generic write cannot be lost between our load and our save.
//!   Conservation is relative to the typed round trip, not to raw JSON: the
//!   saved document is the loaded preferences with one field changed.
//! - **No defaults on a failed read.** A load error (corrupt JSON, a wrong
//!   type, an unreadable file, a directory in its place) is `Unreadable` and
//!   nothing is written, so a broken config is never replaced by defaults.
//! - The error is a unit enum with no OS text or path, so callers can log and
//!   serialise it without leaking either.
//!
//! @coordinates-with services/preferences.rs — `load_preferences_locked`,
//!   `save_preferences`; services/prefs_guard.rs — `PrefsGuard`.
//! @coordinates-with services/mcp_controller/ — the switch (WI-7) calls this
//!   before `reconcile`.

use crate::services::preferences::{load_preferences_locked, save_preferences};
use crate::services::prefs_guard::{GuardError, PrefsGuard};

/// Why persisting `serverEnabled` failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PersistError {
    /// The existing config could not be read or parsed; nothing was written.
    Unreadable,
    /// The config was read but the save failed; the old file is intact.
    WriteFailed,
    /// The shared preferences lock was poisoned.
    LockPoisoned,
}

/// Persist `mcp.serverEnabled = enabled`, leaving every other preference as
/// `load_preferences_locked` returned it.
///
/// A missing config is created (the loader materialises defaults, then the
/// value is set on top). A config that exists but cannot be read or parsed is
/// left byte-identical. A thread that already holds a `PrefsGuard` is refused
/// as `Unreadable`: nothing was read and nothing is written.
pub fn persist_server_enabled(enabled: bool) -> Result<(), PersistError> {
    let guard = PrefsGuard::acquire().map_err(|e| match e {
        GuardError::Poisoned => PersistError::LockPoisoned,
        GuardError::Reentrant => PersistError::Unreadable,
    })?;
    let mut prefs = load_preferences_locked(&guard).map_err(|_| PersistError::Unreadable)?;
    prefs.mcp.server_enabled = enabled;
    save_preferences(&prefs).map_err(|_| PersistError::WriteFailed)
}

#[cfg(test)]
#[path = "preferences_mcp_tests.rs"]
mod preferences_mcp_tests;

#[cfg(test)]
#[path = "preferences_mcp_lock_tests.rs"]
mod preferences_mcp_lock_tests;
