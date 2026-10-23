//! Purpose: the `keyboardShortcutsVersion` stamp on `UserPreferences`: the
//! version the code's shortcut defaults are at, and how a stored stamp is read.
//! (M1a WI-2, ADR-0114 Decision 9.)
//!
//! Key decisions:
//! - A document without the key is at version 1: every file written before the
//!   stamp existed holds v1 defaults.
//! - The read is lenient, on the `sidebar_width::deserialize_stored`
//!   precedent: one bad stamp must not turn the whole file into a
//!   `ParseError`. Anything that is not a positive integer reads as 1, and an
//!   integer above `u32::MAX` saturates there, so a stamp from a later build is
//!   never read as an older one.
//! - The logger's lock-free settings read (`services/logger_settings_read.rs`)
//!   parses the whole document as `UserPreferences` too, so a hard error on a
//!   bad stamp such as `{}` would also make logging fail closed for that file.
//!   That is a second reason the read stays lenient.
//!
//! @coordinates-with services/preferences_migration.rs — moves a stored stamp
//!   from one version to the next

use serde::{Deserialize, Deserializer};

/// The version of the shortcut defaults this build ships.
pub const CURRENT_KEYBOARD_SHORTCUTS_VERSION: u32 = 2;

/// The version a stamp-less, or unreadable, stamp stands for.
const UNSTAMPED_VERSION: u32 = 1;

/// The stamp a document without the key is at.
pub fn default_keyboard_shortcuts_version() -> u32 {
    UNSTAMPED_VERSION
}

/// `keyboardShortcutsVersion` as read from `config.json`. Never fails: `0`, a
/// negative or fractional number, `null`, a bool, a string or an object read
/// as 1; an integer above `u32::MAX` reads as `u32::MAX`.
pub fn deserialize_stored_version<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    if let Some(n) = value.as_u64() {
        return Ok(match n {
            0 => UNSTAMPED_VERSION,
            n => u32::try_from(n).unwrap_or(u32::MAX),
        });
    }
    // A float that is a whole number above the u64 range (`1e20`) is still a
    // later build's stamp; anything else that is not a u64 is unreadable.
    Ok(match value.as_f64() {
        Some(f) if f.is_finite() && f.fract() == 0.0 && f >= f64::from(u32::MAX) => u32::MAX,
        _ => UNSTAMPED_VERSION,
    })
}
