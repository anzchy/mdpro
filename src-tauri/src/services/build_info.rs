//! Purpose: normalise the compiled-in build id (`MDPRO_BUILD_ID`) to a value
//! that is safe to log and report (ADR-0047, WI-1).
//!
//! The only legitimate setter of `MDPRO_BUILD_ID` is
//! `scripts/control/build.mjs`. When it is missing or malformed, the id is
//! the literal `unknown`.
//!
//! Key decisions:
//! - The `option_env!("MDPRO_BUILD_ID")` read lives in the bin crate
//!   (`src-tauri/src/main.rs`), not in this lib module, so that a changing id
//!   recompiles only the `tauri-app` bin and never the lib or `mdpro_mcp`.
//!   This module only receives the raw value as a parameter.
//! - A valid id is exactly 64 lowercase hex chars (`[0-9a-f]`). It is
//!   returned byte-for-byte; nothing is trimmed, case-folded or truncated.

/// The id reported when `MDPRO_BUILD_ID` is missing or malformed.
const UNKNOWN_BUILD_ID: &str = "unknown";

/// Return `raw` when it is exactly 64 lowercase hex chars, otherwise
/// `"unknown"`.
pub fn normalize_build_id(raw: Option<&str>) -> &str {
    match raw {
        Some(id) if is_valid_build_id(id) => id,
        _ => UNKNOWN_BUILD_ID,
    }
}

/// Length of a valid build id, in bytes (a SHA-256 in hex).
const BUILD_ID_LEN: usize = 64;

/// `true` when `id` is exactly 64 bytes, each in `[0-9a-f]`.
fn is_valid_build_id(id: &str) -> bool {
    id.len() == BUILD_ID_LEN && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
#[path = "build_info_tests.rs"]
mod build_info_tests;
