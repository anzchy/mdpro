//! Purpose: focused-window mode, native enabled state and click-time guards.
//! M4-WI-3 resolves every table row's v1 availability for the focused window;
//! a refused stale click is logged once before the D261 router emits.
//!
//! @coordinates-with src-tauri/src/menu.rs
//! @coordinates-with src-tauri/src/menu_from_layout.rs

use crate::menu_layout::{Availability, MenuLayout};
use serde_json::json;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, Wry};

use super::menu_recent_merge::RecentOp;
use super::{build_menu, MenuFocus, MenuState};
use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ViewMode {
    Source,
    Wysiwyg,
}

impl ViewMode {
    pub fn parse(value: &str) -> Result<Self, &'static str> {
        match value {
            "source" => Ok(Self::Source),
            "wysiwyg" => Ok(Self::Wysiwyg),
            _ => Err("invalid_mode"),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Wysiwyg => "wysiwyg",
        }
    }
}

#[derive(Default)]
pub struct MenuModes {
    by_window: HashMap<String, ViewMode>,
}

impl MenuModes {
    pub fn report(&mut self, label: &str, mode: &str) -> Result<(), &'static str> {
        let mode = ViewMode::parse(mode)?;
        self.by_window.insert(label.to_string(), mode);
        Ok(())
    }

    pub fn for_focused(&self, label: Option<&str>) -> Option<ViewMode> {
        label.and_then(|label| self.by_window.get(label).copied())
    }

    pub fn forget(&mut self, label: &str) {
        self.by_window.remove(label);
    }
}

pub fn allows_insert_table(mode: Option<ViewMode>) -> bool {
    mode == Some(ViewMode::Wysiwyg)
}

pub(super) fn allows(availability: Availability, mode: Option<ViewMode>) -> bool {
    match availability {
        Availability::Both => true,
        Availability::W => allows_insert_table(mode),
        Availability::S => mode == Some(ViewMode::Source),
        Availability::None => false,
    }
}

/// Recheck the target's current mode inside D261's emit callback. A refused
/// action logs here; the caller then suppresses D261's second result log.
pub(super) fn dispatch_if_allowed(
    layout: &MenuLayout,
    action: &str,
    target: &str,
    focused: Option<&str>,
    mode: Option<ViewMode>,
    emit: impl FnOnce(&str) -> Result<(), ()>,
) -> Result<(), ()> {
    let row_id = action.strip_prefix("editor.").unwrap_or(action);
    let Some(row) = layout.rows.iter().find(|row| row.id == row_id) else {
        return emit(target);
    };
    let availability = row.availability.macos.v1;
    if availability != Availability::Both {
        let reason = if focused.is_none() {
            "no_focus"
        } else if focused != Some(target) {
            "stale_target"
        } else if mode.is_none() {
            "no_mode_report"
        } else if availability == Availability::None {
            "unavailable"
        } else if !allows(availability, mode) {
            "wrong_mode"
        } else {
            "allowed"
        };
        if reason != "allowed" {
            logger::log_event(LogEntryPayload {
                level: LogLevel::Info,
                event: "ui.menu.availability".into(),
                status: LogStatus::Cancel,
                action_id: Some(uuid::Uuid::new_v4().to_string()),
                context: Some(json!({ "action": row_id, "reason": reason })),
                duration_ms: None,
                error: None,
            });
            return Err(());
        }
    }
    emit(target)
}

/// Production click seam: read the resolved window's current report and focus
/// at emission time, then run the same row guard as the behavioral tests.
pub(super) fn emit_to_window(
    layout: &MenuLayout,
    action: &str,
    target: &str,
    focus: &MenuFocus,
    menus: Option<&MenuState>,
    emit: impl FnOnce(&str) -> Result<(), ()>,
) -> Result<(), ()> {
    let current_mode = menus.and_then(|state| state.mode_for_window(target));
    let current_focus = focus.snapshot().0;
    dispatch_if_allowed(
        layout,
        action,
        target,
        current_focus.as_deref(),
        current_mode,
        emit,
    )
}

pub(super) fn log_invalid_layout() {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Error,
        event: "ui.menu.availability".into(),
        status: LogStatus::Fail,
        action_id: Some(uuid::Uuid::new_v4().to_string()),
        context: Some(json!({ "reason": "layout_invalid" })),
        duration_ms: None,
        error: None,
    });
}

/// Rebuilds on each native focus change, using `MenuFocus` as the authority.
/// A missing focus or report produces no checked View item and a disabled
/// Insert Table item. `publish_op` serialises this install with list changes.
pub fn refresh_menu_for_focus(app: &AppHandle<Wry>) {
    let focused = app
        .try_state::<MenuFocus>()
        .and_then(|focus| focus.snapshot().0);
    if let Some(state) = app.try_state::<MenuState>() {
        state.set_focused(focused);
        let _ = state.publish_op(RecentOp::Refresh, None, |list, mode| {
            let menu = build_menu(app, list, mode).map_err(|_| "build_failed".to_string())?;
            app.set_menu(menu)
                .map_err(|_| "install_failed".to_string())?;
            Ok(())
        });
    }
}

#[cfg(test)]
#[path = "menu_availability_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "menu_availability_m4_integration_tests.rs"]
mod m4_integration_tests;
