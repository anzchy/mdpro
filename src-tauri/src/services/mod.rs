//! Purpose: the backend service layer (business logic behind the IPC
//! commands in `commands/`).
//!
//! Key decisions:
//! - `mcp_controller` owns MCP server-file I/O (ADR-0040); `http_server`
//!   calls into it rather than writing the files itself.
//! - `preferences_mcp` is the locked write path for `mcp.serverEnabled`
//!   (ADR-0040 WI-6); the MCP switch persists through it.

pub mod app_exit;
pub mod app_ready;
pub mod build_info;
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
pub mod preferences;
pub mod preferences_mcp;
pub mod quit_guard;
pub mod shadow_store;
pub(crate) mod window_geometry;
pub mod window_restore;
