//! Purpose: the MCP controller's observable state (ADR-0040 WI-3): the
//! phase, the error, the snapshot, and the pure rule for how a serve task's
//! exit changes the snapshot (`apply_serve_exit`).
//!
//! Key decisions:
//! - Every enum here is payload-free (no path, no address, no OS text): they
//!   reach logs and the status wire. `McpPhase` / `McpServerError` serialise
//!   snake_case (`bind_in_use`, …) as the `phase` / `error` fields of
//!   `mcp_get_status` (WI-4), pinned to `tests/fixtures/mcp-status-contract.json`.
//! - The snapshot lives behind its own `std::sync::Mutex`, separate from the
//!   controller's async transition lock, so a status read never waits on a
//!   transition. A poisoned snapshot lock is `Err(SnapshotError::Poisoned)`,
//!   never read through.
//! - `apply_serve_exit` is pure and takes the generation captured when the
//!   task was spawned (PC-5): a stale generation never changes the snapshot,
//!   and a cancellation (an abort by `stop`) is never a `ServeFailed`.
//!
//! @coordinates-with src/services/mcp_controller/controller.rs (owner)
//! @coordinates-with src/services/mcp_controller/transitions.rs (writer)

use crate::services::mcp_controller::serve::ServeError;
use serde::Serialize;
use std::sync::Mutex;

/// Where the MCP server is in its lifecycle. Wire: `"disabled"`, … .
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpPhase {
    Disabled,
    Starting,
    Running,
    Stopping,
    Failed,
}

/// Why the server is `Failed`. Payload-free. Wire: `"bind_in_use"`, … .
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpServerError {
    /// The port is held by another listener.
    BindInUse,
    /// Any other bind failure.
    BindFailed,
    /// `server.port` / `server.token` could not be written.
    PublishFailed,
    /// The serve task ended by itself while the server should be live.
    ServeFailed,
}

/// The controller's observable state. `generation` counts start attempts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct McpSnapshot {
    pub phase: McpPhase,
    pub port: Option<u16>,
    pub error: Option<McpServerError>,
    pub generation: u64,
}

impl McpSnapshot {
    /// The state of a fresh controller: nothing started yet.
    pub const fn initial() -> Self {
        McpSnapshot {
            phase: McpPhase::Disabled,
            port: None,
            error: None,
            generation: 0,
        }
    }
}

/// The snapshot could not be read. Payload-free; its text has no path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotError {
    Poisoned,
}

impl std::fmt::Display for SnapshotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SnapshotError::Poisoned => f.write_str("mcp status unavailable"),
        }
    }
}

/// How a serve task ended, as the controller sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServeExit {
    /// The serve future returned by itself (graceful or with an error).
    Finished(Result<(), ServeError>),
    /// The task was aborted (by `stop`'s abort path).
    Cancelled,
}

/// The snapshot after the serve task of generation `exited_gen` ended.
///
/// Changes the snapshot only when `exited_gen` is current, the phase is
/// `Starting` or `Running`, and the task finished by itself: then there is
/// no server any more, so the result is `Failed(ServeFailed)` with no port.
pub fn apply_serve_exit(snap: McpSnapshot, exited_gen: u64, exit: ServeExit) -> McpSnapshot {
    let current = exited_gen == snap.generation;
    let should_be_live = matches!(snap.phase, McpPhase::Starting | McpPhase::Running);
    match exit {
        ServeExit::Finished(_) if current && should_be_live => McpSnapshot {
            phase: McpPhase::Failed,
            port: None,
            error: Some(McpServerError::ServeFailed),
            generation: snap.generation,
        },
        ServeExit::Finished(_) | ServeExit::Cancelled => snap,
    }
}

/// The shared cell the snapshot lives in.
pub(crate) type SnapshotCell = Mutex<McpSnapshot>;

/// Read the snapshot; a poisoned lock is an error, never read through.
pub(crate) fn read(cell: &SnapshotCell) -> Result<McpSnapshot, SnapshotError> {
    cell.lock()
        .map(|guard| *guard)
        .map_err(|_| SnapshotError::Poisoned)
}

/// Replace the snapshot. A poisoned lock is left poisoned (the write is
/// dropped), so every later read keeps reporting `Err`.
pub(crate) fn write(cell: &SnapshotCell, snap: McpSnapshot) {
    if let Ok(mut guard) = cell.lock() {
        *guard = snap;
    }
}

/// Replace the snapshot with `f(current)`, atomically. Returns the new
/// value, or `None` if the lock is poisoned (nothing is written then).
pub(crate) fn update(
    cell: &SnapshotCell,
    f: impl FnOnce(McpSnapshot) -> McpSnapshot,
) -> Option<McpSnapshot> {
    let mut guard = cell.lock().ok()?;
    *guard = f(*guard);
    Some(*guard)
}
