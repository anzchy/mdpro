//! Purpose: the serve seam for the MCP HTTP server (ADR-0040 WI-2): bind a
//! listener, generate the auth token, and map a serve result to `ServeError`.
//! The serve future comes from `killable::default_serve`; the task is spawned
//! by `transitions::spawn_watched`.
//!
//! Pipeline: the controller's `start_locked` (`transitions.rs`) calls
//! `bind` -> `generate_token` -> its own serve spawn (`ControllerEnv::serve`,
//! `killable::serve_killable` in production) -> `files::publish`.
//!
//! Key decisions:
//! - The serve result reaches the `JoinHandle` through `map_serve_result`; it
//!   is never `.ok()`-ed away (the old `start_server` discarded it). The
//!   controller-less `spawn_serve` had only test callers and was removed;
//!   tests spawn `killable::default_serve()` directly.
//! - Every error enum is payload-free (no address, no path, no OS text):
//!   they reach logs and, later, the status wire.
//! - Parameterised by address, never `dirs::data_dir()` or an `AppHandle`,
//!   so tests run on `127.0.0.1:0`. The lifecycle owner is
//!   `controller::McpController`; the old one-shot `start_server_in` /
//!   `ServeEnv` path was removed when launch moved to it (WI-5).
//!
//! @coordinates-with src/services/mcp_controller/transitions.rs (the caller)
//! @coordinates-with src/services/mcp_controller/killable.rs (`serve_killable`
//!   applies `map_serve_result`)

use rand::Rng;
use std::io;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

/// Why `bind` failed. Payload-free: no address, no OS text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BindError {
    /// The address is already bound by another listener.
    InUse,
    /// Any other bind failure (unassignable address, permission, ...).
    Other,
}

/// Why a serve task ended with an error. Payload-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServeError {
    Io,
}

/// The spawned serve task. It resolves to the serve result.
pub type ServeHandle = JoinHandle<Result<(), ServeError>>;

/// Bind a TCP listener on `addr`, classifying the failure.
pub async fn bind(addr: SocketAddr) -> Result<TcpListener, BindError> {
    TcpListener::bind(addr).await.map_err(|e| match e.kind() {
        io::ErrorKind::AddrInUse => BindError::InUse,
        _ => BindError::Other,
    })
}

/// The mapping `killable::serve_killable` applies to `axum::serve(...).await`.
pub(crate) fn map_serve_result(result: io::Result<()>) -> Result<(), ServeError> {
    result.map_err(|_| ServeError::Io)
}

/// Generate a fresh auth token: 32 random bytes as 64 lowercase hex chars.
pub(crate) fn generate_token() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
#[path = "serve_tests.rs"]
mod tests;
