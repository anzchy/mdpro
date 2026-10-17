//! Purpose: binds each native menu action to one window (D261). Records
//! which window has focus (`MenuFocus`), classifies the action, resolves its
//! target window when the click arrives, emits `menu:action` to that window
//! only, and logs exactly one `menu.action.dispatch` line per click.
//!
//! Pipeline: `menu.rs::emit_menu_action` → `route` → `classify` →
//! `resolve_target` (from `MenuFocus::snapshot` and the live labels) →
//! `dispatch` → one `emit_to(label)` and one log line.
//!
//! Key decisions:
//! - A focused window wins. With none focused, a Window-class action is
//!   cancelled (`no_focused_window`); an App-class action goes to the
//!   last-focused window if it is still live, else to the lowest live label
//!   by byte order (`any_live`), else it is cancelled (`no_live_window`).
//! - `MenuFocus` keeps no history: forgetting the last-focused window leaves
//!   `last_focused` empty, and any_live answers from there.
//! - Only `WindowEvent::Destroyed` forgets a window. `CloseRequested` can be
//!   vetoed, so it leaves focus alone.
//! - The target is fixed at resolution; `dispatch` never re-reads focus, and
//!   an `emit_to` error is logged as `fail` with no retry and no broadcast.
//! - The log line carries `action`, `target` and `via`, never `value`: an
//!   Open Recent value is a file path.
//!
//! @coordinates-with src/menu.rs (`emit_menu_action`)
//! @coordinates-with src/services/window_focus.rs (`on_focus_event` feeds it)
//! @coordinates-with src/main.rs (manages it; `Destroyed` forgets)
//! @coordinates-with src/hooks/useMenuEvents.ts (the listener)

use serde::Serialize;
use serde_json::json;
use std::sync::{Mutex, MutexGuard};
use tauri::{Manager, Runtime};

use crate::models::{LogEntryPayload, LogLevel, LogStatus};

/// `(focused, last_focused)` as read under the lock.
pub type FocusSnapshot = (Option<String>, Option<String>);

#[derive(Debug, Default)]
struct FocusState {
    focused: Option<String>,
    last_focused: Option<String>,
}

/// Which window has focus now, and which had it last, for menu routing.
/// Deliberately separate from the shadow store's `focused_window`, which the
/// vetoable `CloseRequested` clears (D217).
#[derive(Debug, Default)]
pub struct MenuFocus(Mutex<FocusState>);

impl MenuFocus {
    pub const fn new() -> Self {
        Self(Mutex::new(FocusState {
            focused: None,
            last_focused: None,
        }))
    }

    fn state(&self) -> MutexGuard<'_, FocusState> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A focus sets both fields; a blur clears `focused` only while `label`
    /// still holds it, so a late blur after another window's focus is
    /// harmless.
    pub fn apply(&self, label: &str, focused: bool) {
        let mut state = self.state();
        if focused {
            state.focused = Some(label.to_string());
            state.last_focused = Some(label.to_string());
        } else if state.focused.as_deref() == Some(label) {
            state.focused = None;
        }
    }

    /// Clears whichever field holds `label`. No fallback to an earlier window.
    pub fn forget(&self, label: &str) {
        let mut state = self.state();
        if state.focused.as_deref() == Some(label) {
            state.focused = None;
        }
        if state.last_focused.as_deref() == Some(label) {
            state.last_focused = None;
        }
    }

    pub fn snapshot(&self) -> FocusSnapshot {
        let state = self.state();
        (state.focused.clone(), state.last_focused.clone())
    }
}

/// Read when no `MenuFocus` is managed (setup never finished): nothing is
/// focused, so only any_live can answer.
pub static UNMANAGED_FOCUS: MenuFocus = MenuFocus::new();

/// The `Destroyed` hook: forgets `label` in the managed `MenuFocus`, if any.
pub fn forget_window<R: Runtime, M: Manager<R>>(manager: &M, label: &str) {
    if let Some(focus) = manager.try_state::<MenuFocus>() {
        focus.forget(label);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionClass {
    /// Acts on the app (new, open, preferences, theme): may fall back.
    App,
    /// Acts on one window's document: needs a focused window.
    Window,
}

/// App-class actions are a closed list; everything else, unknown strings
/// included, is Window-class and so fails closed.
pub fn classify(action: &str) -> ActionClass {
    match action {
        "file.new" | "file.new_window" | "file.open" | "file.open_recent" | "file.preferences" => {
            ActionClass::App
        }
        _ if action.starts_with("theme.") => ActionClass::App,
        _ => ActionClass::Window,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Via {
    Focused,
    LastFocused,
    AnyLive,
}

impl Via {
    pub fn as_str(self) -> &'static str {
        match self {
            Via::Focused => "focused",
            Via::LastFocused => "last_focused",
            Via::AnyLive => "any_live",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    NoFocusedWindow,
    NoLiveWindow,
}

impl CancelReason {
    pub fn as_str(self) -> &'static str {
        match self {
            CancelReason::NoFocusedWindow => "no_focused_window",
            CancelReason::NoLiveWindow => "no_live_window",
        }
    }
}

pub type Resolved = Result<(String, Via), CancelReason>;

/// Resolves the target window. Total over its inputs and independent of the
/// order of `live`.
pub fn resolve_target(snapshot: &FocusSnapshot, class: ActionClass, live: &[String]) -> Resolved {
    let (focused, last_focused) = snapshot;
    if let Some(label) = focused {
        return Ok((label.clone(), Via::Focused));
    }
    if class == ActionClass::Window {
        return Err(CancelReason::NoFocusedWindow);
    }
    if let Some(label) = last_focused.as_ref().filter(|l| live.contains(l)) {
        return Ok((label.clone(), Via::LastFocused));
    }
    live.iter()
        .min()
        .map(|label| (label.clone(), Via::AnyLive))
        .ok_or(CancelReason::NoLiveWindow)
}

/// The `menu:action` payload; `target` lets the window check it was meant.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuActionPayload {
    pub action: String,
    pub value: Option<String>,
    pub target: String,
}

/// The fixed `fail` reason; the emitter's own error is never logged.
pub const EMIT_FAILED: &str = "emit_failed";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchOutcome {
    Success { label: String, via: Via },
    Cancel { reason: CancelReason },
    Fail { label: String, reason: &'static str },
}

/// Emits at most once, to the resolved label, then logs exactly one line.
pub fn dispatch<E>(
    action: &str,
    value: Option<String>,
    resolved: Resolved,
    emit: impl FnOnce(&str, &MenuActionPayload) -> Result<(), E>,
    log: impl FnOnce(LogEntryPayload),
) -> DispatchOutcome {
    let outcome = match resolved {
        Err(reason) => DispatchOutcome::Cancel { reason },
        Ok((label, via)) => {
            let payload = MenuActionPayload {
                action: action.to_string(),
                value,
                target: label.clone(),
            };
            match emit(&label, &payload) {
                Ok(()) => DispatchOutcome::Success { label, via },
                Err(_) => DispatchOutcome::Fail {
                    label,
                    reason: EMIT_FAILED,
                },
            }
        }
    };
    log(dispatch_log_entry(action, &outcome));
    outcome
}

/// The one `menu.action.dispatch` line for an outcome. Never carries `value`.
pub fn dispatch_log_entry(action: &str, outcome: &DispatchOutcome) -> LogEntryPayload {
    let (level, status, target, via, error) = match outcome {
        DispatchOutcome::Success { label, via } => (
            LogLevel::Info,
            LogStatus::Success,
            Some(label.as_str()),
            Some(via.as_str()),
            None,
        ),
        DispatchOutcome::Cancel { reason } => (
            LogLevel::Info,
            LogStatus::Cancel,
            None,
            None,
            Some(reason.as_str()),
        ),
        DispatchOutcome::Fail { label, reason } => (
            LogLevel::Error,
            LogStatus::Fail,
            Some(label.as_str()),
            None,
            Some(*reason),
        ),
    };
    LogEntryPayload {
        level,
        event: "menu.action.dispatch".to_string(),
        status,
        action_id: None,
        context: Some(json!({ "action": action, "target": target, "via": via })),
        duration_ms: None,
        error: error.map(str::to_string),
    }
}

/// The seam `emit_menu_action` calls: classify, resolve from `focus` as it
/// stands now, then dispatch.
pub fn route<E>(
    action: &str,
    value: Option<String>,
    focus: &MenuFocus,
    live: &[String],
    emit: impl FnOnce(&str, &MenuActionPayload) -> Result<(), E>,
    log: impl FnOnce(LogEntryPayload),
) -> DispatchOutcome {
    let class = classify(action);
    let resolved = resolve_target(&focus.snapshot(), class, live);
    dispatch(action, value, resolved, emit, log)
}

#[cfg(test)]
#[path = "menu_target_tests.rs"]
mod tests;
