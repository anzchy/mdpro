//! Purpose: the one write path for `mcp.serverEnabled` (ADR-0040 WI-6).
//!
//! The MCP server switch (`mcp_set_server_enabled`, WI-7) persists the user's
//! intent here before it acts on the server. Generic `set_preferences` writes
//! stop carrying `serverEnabled` in WI-10, so this is where the value changes.
//!
//! Key decisions:
//! - **load → set → save under `preferences_rw_lock()`** (PC-3). The same
//!   lock serialises `set_preferences` and `save_window_state`, so a
//!   concurrent generic write cannot be lost between our load and our save.
//!   Conservation is relative to the typed round trip, not to raw JSON: the
//!   saved document is `load_preferences()` with one field changed.
//! - **No defaults on a failed read.** A load error (corrupt JSON, a wrong
//!   type, an unreadable file, a directory in its place) is `Unreadable` and
//!   nothing is written, so a broken config is never replaced by defaults.
//! - The error is a unit enum with no OS text or path, so callers can log and
//!   serialise it without leaking either.
//!
//! @coordinates-with services/preferences.rs — `preferences_rw_lock`,
//!   `load_preferences`, `save_preferences`.
//! @coordinates-with services/mcp_controller/ — the switch (WI-7) calls this
//!   before `reconcile`.

use crate::services::preferences::{load_preferences, preferences_rw_lock, save_preferences};

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
/// `load_preferences()` returned it.
///
/// A missing config is created (`load_preferences` materialises defaults, then
/// the value is set on top). A config that exists but cannot be read or parsed
/// is left byte-identical.
pub fn persist_server_enabled(enabled: bool) -> Result<(), PersistError> {
    let _guard = preferences_rw_lock()
        .lock()
        .map_err(|_| PersistError::LockPoisoned)?;
    let mut prefs = load_preferences().map_err(|_| PersistError::Unreadable)?;
    prefs.mcp.server_enabled = enabled;
    save_preferences(&prefs).map_err(|_| PersistError::WriteFailed)
}

#[cfg(test)]
#[path = "preferences_mcp_tests.rs"]
mod preferences_mcp_tests;

#[cfg(test)]
#[path = "preferences_mcp_lock_tests.rs"]
mod preferences_mcp_lock_tests;
