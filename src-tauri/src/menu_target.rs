//! Purpose: binds each native menu action to one window (D261). Records
//! which window has focus (`MenuFocus`), captures it during native menu
//! tracking, resolves the selected target from that capture, emits to it
//! only, and logs exactly one `menu.action.dispatch` line per click.
//!
//! Pipeline: AppKit begin/will-send/end → `MenuFocus` id capture (an ended,
//! unselected session keeps its Begin owner for one WillSend, D319-F3) →
//! `menu.rs::emit_menu_action` → `route_for_event` → `classify` → `resolve_target` →
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
//! - A present capture may contain no focused window. Consume it once by
//!   matching menu id. A dead captured owner cancels Window-class actions;
//!   App-class actions use the live last-focused or lowest live window.
//! - The target is fixed at resolution; `dispatch` never re-reads focus, and
//!   an `emit_to` error is logged as `fail` with no retry and no broadcast.
//! - The log line carries `action`, `target` and `via`, never `value`: an
//!   Open Recent value is a file path. Each route also writes one
//!   content-free `menu.capture` `route` line (capture taken, decision).
//!
//! @coordinates-with src/menu.rs (`emit_menu_action`)
//! @coordinates-with src/services/window_focus.rs (`on_focus_event` feeds it)
//! @coordinates-with src/main.rs (manages it; `Destroyed` forgets)
//! @coordinates-with src/hooks/useMenuEvents.ts (the listener)

use serde::Serialize;
use serde_json::json;
use tauri::{Manager, Runtime};

use crate::models::{LogEntryPayload, LogLevel, LogStatus};

#[path = "menu_target_capture_log.rs"]
pub(crate) mod capture_log;
#[path = "menu_capture_state.rs"]
mod menu_capture_state;
pub use menu_capture_state::{FocusSnapshot, MenuFocus, UNMANAGED_FOCUS};
#[cfg(target_os = "macos")]
pub use menu_capture_state::{NativeRef, NativeTree};

/// The `Destroyed` hook: forgets `label` in the managed `MenuFocus`, if any.
pub fn forget_window<R: Runtime, M: Manager<R>>(manager: &M, label: &str) {
    if let Some(focus) = manager.try_state::<MenuFocus>() {
        focus.forget(label);
    }
    if let Some(menus) = manager.try_state::<super::MenuState>() {
        menus.forget_window(label);
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
        "file.new" | "file.new_window" | "file.open" | "file.open_recent" | "file.preferences"
        | "theme.light" | "theme.dark" | "theme.system" => ActionClass::App,
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

/// Legacy and off-Mac seam: consume a click capture when present, otherwise
/// use current focus, then dispatch. Native events use `route_for_event`.
pub fn route<E>(
    action: &str,
    value: Option<String>,
    focus: &MenuFocus,
    live: &[String],
    emit: impl FnOnce(&str, &MenuActionPayload) -> Result<(), E>,
    log: impl FnOnce(LogEntryPayload),
) -> DispatchOutcome {
    route_selected(None, action, value, focus, live, emit, log)
}

impl MenuFocus {
    /// Route one Tauri menu event by item id. A mismatched pending selection
    /// expires and uses arrival focus; a dead captured App owner uses a live
    /// fallback, while a Window action cancels.
    pub fn route_for_event<E>(
        &self,
        id: &str,
        action: &str,
        value: Option<String>,
        live: &[String],
        emit: impl FnOnce(&str, &MenuActionPayload) -> Result<(), E>,
        log: impl FnOnce(LogEntryPayload),
    ) -> DispatchOutcome {
        route_selected(Some(id), action, value, self, live, emit, log)
    }
}

fn route_selected<E>(
    id: Option<&str>,
    action: &str,
    value: Option<String>,
    focus: &MenuFocus,
    live: &[String],
    emit: impl FnOnce(&str, &MenuActionPayload) -> Result<(), E>,
    log: impl FnOnce(LogEntryPayload),
) -> DispatchOutcome {
    let class = classify(action);
    let arrived = focus.snapshot();
    let (captured, capture) = focus.take_capture(id);
    let selected = captured.as_ref().unwrap_or(&arrived);
    let captured_owner_dead = captured.is_some()
        && selected
            .0
            .as_ref()
            .is_some_and(|label| !live.contains(label));
    let click_time = captured.is_some() && !captured_owner_dead && selected.0 != arrived.0;
    let decision = if captured_owner_dead {
        "owner_closed"
    } else if click_time {
        "click_time"
    } else {
        "arrival"
    };
    capture_log::emit(vec![capture_log::entry(json!({
        "step": "route",
        "capture": capture,
        "decision": decision,
    }))]);
    let resolved = match (captured_owner_dead, class) {
        (true, ActionClass::Window) => Err(CancelReason::NoFocusedWindow),
        (true, ActionClass::App) => {
            let fallback = (None, arrived.1.clone().filter(|label| live.contains(label)));
            resolve_target(&fallback, class, live)
        }
        (false, _) => resolve_target(selected, class, live),
    };
    dispatch(action, value, resolved, emit, |mut entry| {
        if click_time && entry.status != LogStatus::Cancel {
            if let Some(context) = entry.context.as_mut() {
                context["via"] = json!("click_time");
            }
        }
        log(entry);
    })
}

#[cfg(test)]
#[path = "menu_target_tests.rs"]
mod tests;
