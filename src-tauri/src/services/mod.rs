//! Purpose: the backend service layer (business logic behind the IPC
//! commands in `commands/`).
//!
//! Key decisions:
//! - `mcp_controller` owns MCP server-file I/O (ADR-0040); `http_server`
//!   calls into it rather than writing the files itself.
//! - `preferences_mcp` is the locked write path for `mcp.serverEnabled`
//!   (ADR-0040 WI-6); the MCP switch persists through it.
//! - `prefs_guard` is the held form of `preferences::preferences_rw_lock`; it
//!   marks its thread so a nested preferences load is refused instead of
//!   deadlocking (ADR-0114, M1a WI-1).
//! - `applied_shortcuts` holds the run's applied keyboard-shortcut snapshot,
//!   resolved once at startup and fixed for the run (ADR-0114, M1a WI-4).
//! - `verify_run` (ADR-0047 WI-002) exists only with the `verify-run` Cargo
//!   feature, so a feature-off build carries no guard code.

pub mod app_exit;
pub mod app_ready;
pub mod applied_shortcuts;
pub mod build_info;
pub mod draft;
pub mod encoding;
pub mod file_watcher;
pub mod html_template;
pub mod http_server;
pub mod logger;
pub mod logger_settings_read;
pub mod markdown;
pub mod markdown_ext;
pub mod mcp_confirm;
pub mod mcp_controller;
pub mod mcp_launch;
pub mod open_route;
pub mod path_plain;
pub mod preferences;
pub mod preferences_mcp;
pub mod preferences_merge;
pub mod preferences_migration;
pub mod prefs_guard;
pub mod quit_guard;
pub mod release_info;
#[cfg(test)]
mod run_isolation_fixtures;
#[cfg(test)]
mod run_isolation_tests;
pub mod shadow_store;
#[cfg(feature = "verify-run")]
pub mod verify_run;
pub mod window_focus;
pub(crate) mod window_geometry;
pub mod window_restore;
