//! Focused-window mode and native-menu availability decisions (M3a).

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

/// Native enabled state can lag focus or a failed install. Called after the
/// target is resolved and before the `menu:action` emit.
pub fn table_action_allowed(app: &AppHandle<Wry>, label: &str) -> bool {
    let allowed = app
        .try_state::<MenuState>()
        .is_some_and(|state| allows_insert_table(state.mode_for_window(label)));
    if !allowed {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Info,
            event: "ui.menu.availability".into(),
            status: LogStatus::Cancel,
            action_id: None,
            context: Some(json!({ "action": "paragraph.table", "reason": "unavailable" })),
            duration_ms: None,
            error: None,
        });
    }
    allowed
}

#[cfg(test)]
#[path = "menu_availability_tests.rs"]
mod tests;
