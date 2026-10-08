//! Purpose: build the `context` of the `app.ready` log line (ADR-0047, WI-2):
//! `startupTimeMs`, `appVersion`, `platform`, `pid` and `buildId`, exactly
//! those five keys.
//!
//! Key decisions:
//! - The bin (`src-tauri/src/main.rs`) reads `MDPRO_BUILD_ID` with
//!   `option_env!` and passes the raw value to `current_app_ready_context`.
//!   The lib never reads the variable itself, so a changing id recompiles
//!   only the `tauri-app` bin, not the lib or `mdpro_mcp`.
//! - The raw id goes through `build_info::normalize_build_id`, so a missing
//!   or malformed id is logged as `unknown`.
//! - `app_ready_context` is pure; `current_app_ready_context` only supplies
//!   the process facts (version, OS, pid).
//!
//! @coordinates-with services/build_info.rs, main.rs (`app.ready` log)

use super::build_info::normalize_build_id;
use serde_json::{json, Value};

/// Build the `app.ready` context from explicit inputs. Every value is
/// passed through unchanged.
pub fn app_ready_context(
    startup_ms: u64,
    app_version: &str,
    platform: &str,
    pid: u32,
    build_id: &str,
) -> Value {
    json!({
        "startupTimeMs": startup_ms,
        "appVersion": app_version,
        "platform": platform,
        "pid": pid,
        "buildId": build_id
    })
}

/// Build the `app.ready` context for the running process. `raw_build_id` is
/// the bin's compile-time `MDPRO_BUILD_ID`, normalised here.
pub fn current_app_ready_context(startup_ms: u64, raw_build_id: Option<&str>) -> Value {
    app_ready_context(
        startup_ms,
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::process::id(),
        normalize_build_id(raw_build_id),
    )
}

#[cfg(test)]
#[path = "app_ready_tests.rs"]
mod app_ready_tests;
