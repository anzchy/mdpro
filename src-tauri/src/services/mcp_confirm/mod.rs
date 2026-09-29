//! Purpose: in-window, queued, bounded confirmation of MCP writes
//! (ADR-0042). A write to a document applies at once only when the window
//! that owns the document is focused; otherwise the owning window is asked,
//! one prompt at a time, and every pending request ends on reply, timeout,
//! server stop, app exit or the window closing.
//!
//! Pipeline (built so far: `gate`, `queue`; the rest is planned):
//!   `shadow_store::owner_and_focus` → `gate::decide` → (Prompt)
//!   `queue::PendingTable::enqueue` → effects boundary emits each
//!   `Effect::Show` to the owner → reply command / timeout / withdraw /
//!   cancel ends it via `PendingTable` → `Effect::Resolve` wakes the waiter
//!   → HTTP handler maps the outcome.
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

pub mod gate;
pub mod queue;
