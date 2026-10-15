//! The sidebar width preference (D189, ADR-0088): its range, its default, and
//! how a value is read from `config.json` and from `set_preferences`.

use serde::{Deserialize, Deserializer};

pub const SIDEBAR_WIDTH_MIN: u32 = 180;
pub const SIDEBAR_WIDTH_MAX: u32 = 480;
pub const SIDEBAR_WIDTH_DEFAULT: u32 = 220;

pub fn default_sidebar_width() -> u32 {
    SIDEBAR_WIDTH_DEFAULT
}

/// Rounds `raw` and clamps it into [`SIDEBAR_WIDTH_MIN`, `SIDEBAR_WIDTH_MAX`].
/// A non-finite value (`NaN`, `±∞`) has no meaningful position in the range,
/// so it reads as the default rather than as an end of the range.
pub fn clamp_sidebar_width(raw: f64) -> u32 {
    if !raw.is_finite() {
        return SIDEBAR_WIDTH_DEFAULT;
    }
    raw.round()
        .clamp(f64::from(SIDEBAR_WIDTH_MIN), f64::from(SIDEBAR_WIDTH_MAX)) as u32
}

/// `sidebarWidth` as read from `config.json`. Never fails: a value of the
/// wrong type reads as the default, because one bad field must not turn the
/// whole file into a `ParseError` (and every other setting into a reset). A
/// number is clamped; the clamped value is only written back if some later
/// `set_preferences` writes the file anyway.
pub fn deserialize_stored<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(value
        .as_f64()
        .map(clamp_sidebar_width)
        .unwrap_or(SIDEBAR_WIDTH_DEFAULT))
}

/// `sidebarWidth` as sent to `set_preferences` (an IPC trust boundary, rule
/// 60). A number is clamped into range; anything else is rejected, so the
/// command fails instead of persisting a value the frontend never meant.
pub fn deserialize_partial<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u32>, D::Error> {
    Ok(Option::<f64>::deserialize(d)?.map(clamp_sidebar_width))
}

#[cfg(test)]
#[path = "sidebar_width_tests.rs"]
mod tests;
