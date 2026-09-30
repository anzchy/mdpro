//! Purpose: in-window, queued, bounded confirmation of MCP writes
//! (ADR-0042). A write to a document applies at once only when the window
//! that owns the document is focused; otherwise the owning window is asked,
//! one prompt at a time, and every pending request ends on reply, timeout,
//! server stop, app exit or the window closing.
//!
//! Pipeline (built so far: `gate`, `queue`, `broker`, `outbox`, `effects`,
//! `payload`, `logging`, and the lifecycle hooks below; the HTTP and
//! command wiring is planned):
//!   `shadow_store::owner_and_focus` → `gate::decide` → (Prompt)
//!   `broker::ConfirmBroker::confirm` → `queue::PendingTable::enqueue` →
//!   `outbox` turns each `Effect` into a wire entry under the lock →
//!   `broker` drains it outside the lock through `effects::ConfirmEffects`
//!   (`mcp:confirm_request` + attention, `mcp:confirm_resolved`) → reply /
//!   60 s deadline / withdraw / cancel ends it via `PendingTable` →
//!   `Effect::Resolve` wakes the waiter → HTTP handler maps the outcome.
//!
//! Key decisions:
//! - `gate` is pure: no Tauri or tokio types, so the approval rule is
//!   tested exhaustively without a runtime.
//! - The approval rule is "the owning window is focused", never "any window
//!   is focused" (ADR-0042 decision 2). Owner and focus come from one lock
//!   acquisition so the pair cannot be torn by a concurrent focus change.
//! - `queue` is pure too (no Tauri, tokio or clock): every operation returns
//!   the `Effect`s to carry out, so FIFO, one-shown-per-window,
//!   exactly-once and window independence are checked by hand-enumerated
//!   laws. Ids come from an injected `IdSource`.
//! - A shown request ends with exactly one `Resolve` or `Dismiss`
//!   (withdraw); a reply counts only from the owning window for its shown
//!   request, and anything naming an ended id is a no-op.
//! - `cancel_all` (server stop) leaves the table usable; `close` (app exit)
//!   is absorbing, so every later request is cancelled at once.
//! - Wire rule (`outbox`): every end of a shown request sends exactly one
//!   `mcp:confirm_resolved` to the owner, before that window's next
//!   `mcp:confirm_request`; a withdrawn never-shown request and
//!   `cancel_window` (the window is gone) send none.
//! - `broker` never holds its lock across an `.await` or a boundary call;
//!   deadlines are `tokio::time::Instant` so the paused test clock drives
//!   them; a poisoned table fails closed (`Cancelled(EmitFailed)`); a dropped
//!   `confirm` future withdraws its request.
//! - Lifecycle (here): `stop_hook` is the controller's
//!   `ControllerEnv::with_stop_hook` callback: `ServerStop` -> `cancel_all`
//!   (the next start confirms again), `AppExit` -> `close`.
//!   `on_window_event` cancels a window's queue on `Destroyed` only, never
//!   on a vetoable close request; it uses `matches!` because the event enum
//!   is `#[non_exhaustive]`. Neither raises; a failure is logged.
//! - `payload` keys are camelCase, pinned by
//!   `tests/fixtures/mcp-confirm-contract.json`; `logging` never writes the
//!   title, content, path or token.
//!
//! @coordinates-with src/services/mcp_controller/controller.rs (`StopCause`,
//!   `StopHook`, `begin_exit`)
//! @coordinates-with src/services/mcp_controller/transitions.rs (`stop_locked`)

pub mod broker;
pub mod effects;
pub mod gate;
pub mod logging;
mod outbox;
pub mod payload;
pub mod queue;

#[cfg(test)]
pub(crate) mod test_effects;

use std::sync::Arc;

use broker::ConfirmBroker;
use effects::ConfirmEffects;
use queue::Cause;

use crate::services::logger;
use crate::services::mcp_controller::controller::{StopCause, StopHook};

/// The controller's stop hook over `broker` (`ControllerEnv::with_stop_hook`).
/// `ServerStop` cancels every pending request and leaves the broker usable
/// for the next start; `AppExit` closes it, so later requests end at once.
/// A failure (poisoned table) is logged, never raised.
pub fn stop_hook<E: ConfirmEffects + 'static>(broker: Arc<ConfirmBroker<E>>) -> StopHook {
    Arc::new(move |cause| {
        let (cause, result) = match cause {
            StopCause::ServerStop => (Cause::ServerStop, broker.cancel_all(Cause::ServerStop)),
            StopCause::AppExit => (Cause::AppExit, broker.close(Cause::AppExit)),
        };
        if result.is_err() {
            logger::log_event(logging::cancel_failed_entry(cause, None));
        }
    })
}

/// Route a window event to the broker.
///
/// **Only `Destroyed`**, and only for `label`'s queue: its requests end as
/// `Cancelled(WindowClosed)` with no emit to the gone window. A vetoable
/// close request must not cancel (the user can keep the window), and a blur
/// is not a close. `tauri::WindowEvent` is `#[non_exhaustive]`, so this is a
/// `matches!`, as in `quit_guard::on_window_event`.
pub fn on_window_event<E: ConfirmEffects>(
    broker: &ConfirmBroker<E>,
    label: &str,
    event: &tauri::WindowEvent,
) {
    // `cancel_window` runs only for `Destroyed` (`&&` short-circuits).
    if matches!(event, tauri::WindowEvent::Destroyed) && broker.cancel_window(label).is_err() {
        let line = logging::cancel_failed_entry(Cause::WindowClosed, Some(label));
        logger::log_event(line);
    }
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod lifecycle_tests;

#[cfg(test)]
#[path = "window_event_tests.rs"]
mod window_event_tests;
