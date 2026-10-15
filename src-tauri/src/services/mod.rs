//! Purpose: the backend service layer (business logic behind the IPC
//! commands in `commands/`).
//!
//! Key decisions:
//! - `mcp_controller` owns MCP server-file I/O (ADR-0040); `http_server`
//!   calls into it rather than writing the files itself.
//! - `preferences_mcp` is the locked write path for `mcp.serverEnabled`
//!   (ADR-0040 WI-6); the MCP switch persists through it.
//! - `verify_run` (ADR-0047 WI-002) exists only with the `verify-run` Cargo
//!   feature, so a feature-off build carries no guard code.
//! - `control_channel` (ADR-0047 WI-006 spike) exists only with the
//!   `control-channel` feature, likewise.

pub mod app_exit;
pub mod app_ready;
pub mod build_info;
#[cfg(feature = "control-channel")]
pub mod control_channel;
pub mod draft;
pub mod encoding;
pub mod file_watcher;
pub mod html_template;
pub mod http_server;
pub mod logger;
pub mod markdown;
pub mod markdown_ext;
pub mod mcp_confirm;
pub mod mcp_controller;
pub mod mcp_launch;
pub mod open_route;
pub mod path_plain;
pub mod preferences;
pub mod preferences_mcp;
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
