//! Purpose: the confirmation broker's boundary to Tauri (ADR-0042), as a
//! trait with one thin production adapter.
//!
//! Pipeline: broker outbox -> `ConfirmEffects::emit_to` (one window, never
//! a broadcast) -> after a delivered `mcp:confirm_request`,
//! `ConfirmEffects::request_attention` (Dock bounce).
//!
//! Key decisions:
//! - Both calls return `Result`; the broker never discards one. A failed
//!   request emit cancels that request as `EmitFailed` so its window's queue
//!   does not stall; other failures are logged.
//! - `TauriConfirmEffects` holds an `AppHandle` and nothing else, as
//!   `quit_guard::effects::TauriQuitEffects` does. It has no automated test
//!   (the Tauri `test` feature is not enabled); its real path is the
//!   WI-10 device check.
//! - Attention is `Informational`: one bounce, not a bounce until focused.
//!
//! @coordinates-with src-tauri/src/services/mcp_confirm/broker.rs

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, UserAttentionType};

use super::broker::ConfirmBroker;

/// What the broker needs from the app. `Send + Sync` because the broker is
/// shared by every HTTP handler and the reply command.
pub trait ConfirmEffects: Send + Sync {
    /// Emit `event` with `payload` to the one window labelled `window`.
    fn emit_to(&self, window: &str, event: &str, payload: Value) -> Result<(), String>;
    /// Ask the OS to draw the user's attention to `window`.
    fn request_attention(&self, window: &str) -> Result<(), String>;
}

/// The managed-state type: one broker per app, on the production effects.
pub type AppConfirmBroker = ConfirmBroker<TauriConfirmEffects>;

pub struct TauriConfirmEffects {
    app: AppHandle,
}

impl TauriConfirmEffects {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl ConfirmEffects for TauriConfirmEffects {
    fn emit_to(&self, window: &str, event: &str, payload: Value) -> Result<(), String> {
        self.app
            .emit_to(window, event, payload)
            .map_err(|e| e.to_string())
    }

    fn request_attention(&self, window: &str) -> Result<(), String> {
        let target = self
            .app
            .get_webview_window(window)
            .ok_or_else(|| "window not found".to_string())?;
        target
            .request_user_attention(Some(UserAttentionType::Informational))
            .map_err(|e| e.to_string())
    }
}
