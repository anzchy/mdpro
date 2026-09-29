//! Purpose: in-window, queued, bounded confirmation of MCP writes
//! (ADR-0042). A write to a document applies at once only when the window
//! that owns the document is focused; otherwise the owning window is asked,
//! one prompt at a time, and every pending request ends on reply, timeout,
//! server stop, app exit or the window closing.
//!
//! Pipeline (planned; WI-1 builds only the first step):
//!   `shadow_store::owner_and_focus` → `gate::decide` → (Prompt) pending
//!   queue per window → effects boundary emits the request to the owner →
//!   reply command resolves it → HTTP handler maps the outcome.
//!
//! Key decisions:
//! - `gate` is pure: no Tauri or tokio types, so the approval rule is
//!   tested exhaustively without a runtime.
//! - The approval rule is "the owning window is focused", never "any window
//!   is focused" (ADR-0042 decision 2). Owner and focus come from one lock
//!   acquisition so the pair cannot be torn by a concurrent focus change.

pub mod gate;
