//! Purpose: the production `QuitEffects`, a thin adapter over `AppHandle`.
//!
//! Pipeline: driver `Step` -> this adapter -> Tauri emit / window activation /
//! ack timer / NSApp `replyToApplicationShouldTerminate:` / ADR-0027 alert;
//! and escape menu -> driver -> ADR-0027 alert (ADR-0030, `driver_escape.rs`).
//!
//! Key decisions:
//! - It holds an `AppHandle` and nothing else. The ack timer reaches the guard
//!   back through Tauri managed state rather than an `Arc` cycle.
//! - `reply` and `native_fallback` post to `macos` on macOS (a failed post is
//!   `false`, which the driver logs as `effect_failed`). Off macOS (ADR-0090)
//!   `reply(true)` is `AppHandle::exit(0)` and `reply(false)` a no-op; the
//!   alert is not drawn: the escape posts `headless_fallback_answer` to the
//!   guard, and a timeout reports `false` so the driver releases the request.
//! - `native_fallback` forwards its `FallbackCause` to the alert, which picks
//!   its title and body from it; the buttons do not depend on it.
//! - Every event goes out as `{requestId, round}` (`QuitEventPayload`,
//!   ADR-0035 A5), including `app:quit-backstop`.
//! - `now_ms` is monotonic from a process-local origin (D16F row 14).
//! - Every dispatch result is reported, never discarded (D16F rows 11, 12, 15):
//!   `emit_all` and `activate` return it to the driver, which logs it, and the
//!   timer's main-thread post goes through `report_dispatch`. Activation runs
//!   all four steps even when one fails (`run_activation`).
//!
//! @coordinates-with src-tauri/src/services/quit_guard/driver.rs

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[cfg(not(target_os = "macos"))]
use super::driver::{deliver_fallback, headless_fallback_answer};
use super::driver::{FallbackCause, QuitEffects, QuitEvent, QuitGuard};
use super::logging;

/// The managed-state type: one guard per app, built on the production effects.
pub type AppQuitGuard = QuitGuard<TauriQuitEffects>;

/// Monotonic milliseconds since a process-local origin, fixed by the first
/// read. The coordinator takes time as a parameter, so this is the only place
/// the production path reads a clock; being monotonic, a wall-clock step (NTP,
/// a manual change) can no longer move a quit deadline (D16F row 14).
pub fn now_ms() -> u64 {
    static ORIGIN: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    let origin = *ORIGIN.get_or_init(std::time::Instant::now);
    u64::try_from(origin.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Run every activation step, in slice order, and report whether all of them
/// succeeded. No step is skipped because an earlier one failed: a window that
/// can still be brought forward is worth bringing forward (row 12).
pub(super) fn run_activation<E>(steps: &mut [&mut dyn FnMut() -> Result<(), E>]) -> bool {
    steps
        .iter_mut()
        .fold(true, |all_ok, step| step().is_ok() && all_ok)
}

/// Log a main-thread dispatch that could not be posted as
/// `effect_failed {effect}`; a posted one logs nothing. The error itself is
/// not log material, so only the fixed effect name is written (row 11).
pub(super) fn report_dispatch<E>(result: Result<(), E>, request_id: u64, effect: &str) {
    if result.is_err() {
        logging::log_effect_failed(request_id, effect);
    }
}

/// The app-level half of activation (ADR-0025 §2). Off macOS there is no
/// hidden-app state to undo, so it trivially succeeds.
fn activate_app(app: &AppHandle) -> Result<(), ()> {
    #[cfg(target_os = "macos")]
    {
        super::macos::activate_app(app).map_err(drop)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

/// The wire shape of every quit event (ADR-0035 A5): `{requestId, round}`.
/// The round lets a window tag its answer, so a late answer from an earlier
/// round cannot be mistaken for one to the current round.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuitEventPayload {
    request_id: u64,
    round: u32,
}

impl From<QuitEvent> for QuitEventPayload {
    fn from(event: QuitEvent) -> Self {
        Self {
            request_id: event.request_id(),
            round: event.round(),
        }
    }
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
    fn emit_all(&self, event: QuitEvent) -> bool {
        self.app
            .emit(event.name(), QuitEventPayload::from(event))
            .is_ok()
    }

    fn emit_to(&self, label: &str, event: QuitEvent) -> bool {
        self.app
            .emit_to(label, event.name(), QuitEventPayload::from(event))
            .is_ok()
    }

    /// App first, then the one window (ADR-0025 §2): a window raised while
    /// the app is still hidden stays behind it for a frame. A missing window
    /// counts as a failed step.
    fn activate(&self, label: &str) -> bool {
        let window = self.app.get_webview_window(label);
        let on_window = |call: fn(&WebviewWindow) -> tauri::Result<()>| {
            window
                .as_ref()
                .ok_or(())
                .and_then(|w| call(w).map_err(drop))
        };
        run_activation(&mut [
            &mut || activate_app(&self.app),
            &mut || on_window(|w| w.unminimize()),
            &mut || on_window(|w| w.show()),
            &mut || on_window(|w| w.set_focus()),
        ])
    }

    fn arm_timer(&self, request_id: u64, deadline_ms: u64) {
        let app = self.app.clone();
        std::thread::spawn(move || {
            let wait = deadline_ms.saturating_sub(now_ms());
            std::thread::sleep(std::time::Duration::from_millis(wait));
            // The guard lives in managed state, so the timer never holds a
            // reference to it and there is no Arc cycle with the effects.
            let posted = app.clone().run_on_main_thread(move || {
                if let Some(guard) = app.try_state::<AppQuitGuard>() {
                    guard.tick(now_ms());
                }
            });
            report_dispatch(posted, request_id, "timerDispatch");
        });
    }

    fn reply(&self, terminate: bool) -> bool {
        // Off macOS there is no deferred terminate to resolve: the reply IS the
        // exit (D190-WI-4). `AppHandle::exit` goes through `ExitRequested` and
        // `RunEvent::Exit`, where `main.rs` runs the server-file cleanup; a
        // cancel has nothing to resolve.
        #[cfg(target_os = "macos")]
        {
            super::macos::reply_to_should_terminate(&self.app, terminate)
        }
        #[cfg(not(target_os = "macos"))]
        {
            if terminate {
                self.app.exit(0);
            }
            true
        }
    }

    fn native_fallback(
        &self,
        request_id: u64,
        timed_out: Vec<String>,
        cause: FallbackCause,
    ) -> bool {
        // ADR-0027: the alert names no window, so the labels are only the
        // driver's log material. They are counted there, not passed on.
        let _ = timed_out;
        // The cause picks the alert's wording (`alert_text.rs`); the buttons
        // are the same for every cause.
        #[cfg(target_os = "macos")]
        {
            super::macos::present_fallback_alert(&self.app, request_id, cause)
        }
        // Off macOS no alert is drawn (ADR-0090). A timeout reports `false`,
        // so the driver hands the request back to the windows; the escape is
        // answered for the person who chose it, posted like the macOS alert's
        // button so it never re-enters the driver from inside `fallback`.
        #[cfg(not(target_os = "macos"))]
        {
            match headless_fallback_answer(cause) {
                Some(answer) => {
                    let app = self.app.clone();
                    self.app
                        .run_on_main_thread(move || {
                            let guard = app.try_state::<AppQuitGuard>();
                            deliver_fallback(guard.as_deref(), request_id, answer);
                        })
                        .is_ok()
                }
                None => false,
            }
        }
    }
}

// The wire payload contract (ADR-0035 A5). Registered here so the private
// payload struct is reachable.
#[cfg(test)]
#[path = "effects_payload_tests.rs"]
mod effects_payload_tests;

#[cfg(test)]
#[path = "effects_headless_tests.rs"]
mod effects_headless_tests;
