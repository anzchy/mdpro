//! Purpose: the MCP server controller (ADR-0040), its server-file I/O and
//! its serve seam.
//!
//! Key decisions:
//! - Everything that touches `server.port` / `server.token` goes through
//!   `files`, parameterised by directory, so tests never reach the real
//!   `data_dir()/mdpro`.
//! - `serve` owns bind and token generation, parameterised by address, so
//!   tests never need a Tauri `AppHandle`; `transitions` spawns the serve task.
//! - `controller` (with `transitions`, `snapshot`, `killable`) is the one
//!   owner of the server's lifecycle: serialized start/stop/reconcile, a
//!   snapshot readable without waiting on a transition, and a stop that
//!   kills every connection once its drain expires (PC-1).
//! - `launch` applies the ADR-0039 launch decision through the controller
//!   (WI-5); `app_exit` drives its exit.
//! - `switch` is the live on/off switch (WI-7): persist the intent, then
//!   reconcile, then one status, the whole switch serialized by the
//!   controller's `switch_lock` (WI-7b); `commands/mcp_server_switch.rs` is
//!   its shell.
//!
//! @coordinates-with src/services/http_server.rs (the app's `ControllerEnv`
//!   and router factory)
//! @coordinates-with src/main.rs, src/services/app_exit.rs,
//!   src/commands/mcp_server_switch.rs

pub mod controller;
pub mod files;
pub mod killable;
pub mod launch;
pub mod serve;
pub mod snapshot;
pub mod switch;
mod transitions;

#[cfg(test)]
mod exit_publish_race_tests;
#[cfg(test)]
mod launch_tests;
#[cfg(test)]
mod lifecycle_tests;
#[cfg(test)]
mod reconcile_tests;
#[cfg(test)]
mod serve_exit_tests;
#[cfg(test)]
mod stop_abort_tests;
#[cfg(test)]
mod switch_guard_tests;
#[cfg(test)]
mod switch_log_tests;
#[cfg(test)]
mod switch_race_tests;
#[cfg(test)]
mod switch_tests;
#[cfg(test)]
pub(crate) mod test_routers;
#[cfg(test)]
pub(crate) mod test_support;
