//! Purpose: the production `QuitEffects`, a thin adapter over `AppHandle`.
//!
//! Pipeline: driver `Step` -> this adapter -> Tauri emit / window activation /
//! ack timer -> (WI-4) the NSApp `replyToApplicationShouldTerminate:`.
//!
//! Key decisions:
//! - It holds an `AppHandle` and nothing else. The ack timer reaches the guard
//!   back through Tauri managed state rather than an `Arc` cycle.
//! - The NSApp reply and the ADR-0027 timeout alert are WI-4's work; both are
//!   inert here, and nothing calls them yet because the native hook that starts
//!   a request is installed in WI-4.
//!
//! @coordinates-with src/services/quit_guard/driver.rs

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::driver::{QuitEffects, QuitEvent, QuitGuard};

/// The managed-state type: one guard per app, built on the production effects.
pub type AppQuitGuard = QuitGuard<TauriQuitEffects>;

/// Wall-clock milliseconds. The coordinator takes time as a parameter, so this
/// is the only place the production path reads a clock.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuitEventPayload {
    request_id: u64,
}

pub struct TauriQuitEffects {
    app: AppHandle,
}

impl TauriQuitEffects {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl QuitEffects for TauriQuitEffects {
    fn emit_all(&self, event: QuitEvent) {
        let _ = self.app.emit(
            event.name(),
            QuitEventPayload {
                request_id: event.request_id(),
            },
        );
    }

    fn emit_to(&self, label: &str, event: QuitEvent) {
        let _ = self.app.emit_to(
            label,
            event.name(),
            QuitEventPayload {
                request_id: event.request_id(),
            },
        );
    }

    fn activate(&self, label: &str) {
        // App first, then the one window: unhiding after showing the window
        // would leave it behind a hidden app for a frame.
        #[cfg(target_os = "macos")]
        super::macos::activate_app(&self.app);
        if let Some(window) = self.app.get_webview_window(label) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    fn arm_timer(&self, _request_id: u64, deadline_ms: u64) {
        let app = self.app.clone();
        std::thread::spawn(move || {
            let wait = deadline_ms.saturating_sub(now_ms());
            std::thread::sleep(std::time::Duration::from_millis(wait));
            // The guard lives in managed state, so the timer never holds a
            // reference to it and there is no Arc cycle with the effects.
            let _ = app.clone().run_on_main_thread(move || {
                if let Some(guard) = app.try_state::<AppQuitGuard>() {
                    guard.tick(now_ms());
                }
            });
        });
    }

    fn reply(&self, terminate: bool) {
        // Off macOS there is no deferred terminate to resolve, so this stays a
        // no-op, as the plan requires.
        #[cfg(target_os = "macos")]
        super::macos::reply_to_should_terminate(&self.app, terminate);
        #[cfg(not(target_os = "macos"))]
        let _ = terminate;
    }

    fn native_fallback(&self, request_id: u64, timed_out: Vec<String>) {
        // ADR-0027: the alert names no window, so the labels are only the
        // driver's log material. They are counted there, not passed on.
        let _ = timed_out;
        #[cfg(target_os = "macos")]
        super::macos::present_timeout_alert(&self.app, request_id);
        #[cfg(not(target_os = "macos"))]
        let _ = request_id;
    }
}
