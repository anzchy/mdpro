//! Purpose: build the `context` of the `app.ready` log line (ADR-0047, WI-2;
//! D175): `startupTimeMs`, `appVersion`, `platform`, `pid`, `buildId` and
//! `releaseId`, exactly those six keys.
//!
//! Key decisions:
//! - The bin (`src-tauri/src/main.rs`) reads `MDPRO_BUILD_ID` with
//!   `option_env!` and passes the raw value to `current_app_ready_context`.
//!   The lib never reads the variable itself, so a changing id recompiles
//!   only the `tauri-app` bin, not the lib or `mdpro_mcp`.
//! - The raw id goes through `build_info::normalize_build_id`, so a missing
//!   or malformed id is logged as `unknown`.
//! - D175: the bin reads `MDPRO_RELEASE_ID` (set only by `release.yml`) the
//!   same way and passes it as `raw_release_id`; it goes through
//!   `release_info::normalize_release_id` and is logged as `releaseId`. The
//!   two ids are independent: neither one's value or validity affects the
//!   other's key.
//! - `app_ready_context` and `with_release_id` are pure;
//!   `current_app_ready_context` only supplies the process facts (version,
//!   OS, pid).
//!
//! @coordinates-with services/build_info.rs, services/release_info.rs,
//!   main.rs (`app.ready` log)

use super::build_info::normalize_build_id;
use super::release_info::normalize_release_id;
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

/// Add the `releaseId` key to a context built by `app_ready_context`. The
/// value is passed through unchanged; every other key is left as it is.
pub fn with_release_id(mut ctx: Value, release_id: &str) -> Value {
    if let Value::Object(map) = &mut ctx {
        map.insert("releaseId".to_string(), json!(release_id));
    }
    ctx
}

/// Build the `app.ready` context for the running process. `raw_build_id` and
/// `raw_release_id` are the bin's compile-time `MDPRO_BUILD_ID` and
/// `MDPRO_RELEASE_ID`, each normalised here (`unknown` when missing or
/// malformed).
pub fn current_app_ready_context(
    startup_ms: u64,
    raw_build_id: Option<&str>,
    raw_release_id: Option<&str>,
) -> Value {
    let ctx = app_ready_context(
        startup_ms,
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::process::id(),
        normalize_build_id(raw_build_id),
    );
    with_release_id(ctx, normalize_release_id(raw_release_id))
}

#[cfg(test)]
#[path = "app_ready_release_tests.rs"]
mod app_ready_release_tests;
#[cfg(test)]
#[path = "app_ready_tests.rs"]
mod app_ready_tests;
