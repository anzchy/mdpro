//! Recent-files state and the "Open Recent" submenu, split out of `menu.rs`.
//!
//! Purpose: hold the app-wide session recent-files list (`MenuState`) and
//! build the submenu from it. `publish_after` publishes a new list only once
//! the menu built from it has installed, so the state never names a menu that
//! failed (D16F row 18).
//!
//! Key decisions (D43, design (b)):
//! - Windows send a `RecentOp`, not a whole list. `MenuState::publish_op`
//!   sanitises it, then holds a dedicated **sync mutex** across read, merge
//!   (`apply_recent_op`), install and publish, so concurrent windows never
//!   lose each other's updates.
//! - The sync mutex is separate from the **data mutex** the menu-click handler
//!   (`menu.rs` `handle_menu_event`) reads, so a menu event fired during
//!   `set_menu` cannot deadlock. No menu event handler calls `publish_op`.
//! - View modes are keyed by the injected caller window. The focused label
//!   comes from `MenuFocus`; a missing focus or report fails closed.
//! - `publish_op` logs `menu.recent_files.sync` with `{op, count, outcome}`
//!   only, never paths; a `seed` with `stored: None` logs a warn with
//!   `outcome: "hydration_failed"` (the line a device run can see while
//!   frontend logging is fail-closed).
//!
//! Caller: `commands/menu.rs` `sync_recent_files_menu`.
//! `MENU_FILE_RECENT_PREFIX` stays in `menu.rs` with the other `MENU_*` ids.
//!
//! @coordinates-with src/menu_recent_merge.rs
//! @coordinates-with src/commands/menu.rs

use super::menu_availability::{MenuModes, ViewMode};
use super::menu_recent_merge::{apply_recent_op, sanitize_recent_op, RecentOp, PATH_TOO_LONG};
use super::MENU_FILE_RECENT_PREFIX;
use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;
use tauri::menu::{MenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Wry};

const SYNC_EVENT: &str = "menu.recent_files.sync";

/// The published session list (data mutex, read by the menu-click handler)
/// and the sync lock that serialises `publish_op`.
#[derive(Default)]
pub struct MenuState {
    recent_files: Mutex<Vec<String>>,
    modes: Mutex<MenuModes>,
    sync: Mutex<SyncState>,
}

/// Guarded by `MenuState::sync`, never by the data mutex.
#[derive(Default)]
struct SyncState {
    focused: Option<String>,
}

/// A mode report bound to the injected Tauri caller, never a frontend label.
pub struct ModeReport {
    pub window: String,
    pub mode: String,
}

impl MenuState {
    pub fn set_focused(&self, label: Option<String>) {
        let mut sync = self.sync.lock().unwrap_or_else(|e| e.into_inner());
        sync.focused = label;
    }

    pub fn forget_window(&self, label: &str) {
        let mut sync = self.sync.lock().unwrap_or_else(|e| e.into_inner());
        self.modes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .forget(label);
        if sync.focused.as_deref() == Some(label) {
            sync.focused = None;
        }
    }

    pub fn mode_for_window(&self, label: &str) -> Option<ViewMode> {
        self.modes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .for_focused(Some(label))
    }

    pub fn set_recent_files(&self, recent_files: Vec<String>) {
        if let Ok(mut data) = self.recent_files.lock() {
            *data = recent_files;
        }
    }

    pub fn recent_files(&self) -> Vec<String> {
        self.recent_files
            .lock()
            .map(|data| data.clone())
            .unwrap_or_default()
    }

    /// Apply `op` to the session list, install a menu built from the result,
    /// and publish it. Returns the published list.
    ///
    /// The op is sanitised first (`sanitize_recent_op`); a rejection installs
    /// nothing and changes nothing. Then, under the sync mutex: a report
    /// updates only its window (kept even if install fails),
    /// the merge runs against the current list, `install(merged, focused mode)`
    /// runs while the old list is still published (and may read it through
    /// `recent_files()`), and the merged list is published only on `Ok`.
    /// On `Err` the old list stays and the install error is returned.
    pub fn publish_op(
        &self,
        op: RecentOp,
        report: Option<ModeReport>,
        install: impl FnOnce(&[String], Option<&str>) -> Result<(), String>,
    ) -> Result<Vec<String>, String> {
        let started = Instant::now();
        let kind = op_kind(&op);
        log_sync(
            LogLevel::Info,
            LogStatus::Start,
            json!({ "op": kind }),
            None,
            None,
        );
        let op = match sanitize_recent_op(op) {
            Ok(op) => op,
            Err(e) => {
                let context = json!({ "op": kind });
                log_sync(
                    LogLevel::Error,
                    LogStatus::Fail,
                    context,
                    Some(PATH_TOO_LONG),
                    None,
                );
                return Err(e);
            }
        };

        // Poison only means another sync panicked; the mode map is intact.
        let sync = self.sync.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(report) = report {
            if let Err(reason) = self
                .modes
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .report(&report.window, &report.mode)
            {
                log_sync(
                    LogLevel::Error,
                    LogStatus::Fail,
                    json!({ "op": kind }),
                    Some(reason),
                    None,
                );
                return Err(reason.to_string());
            }
        }
        let current = match self.recent_files.lock() {
            Ok(data) => data.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        let merged = apply_recent_op(&current, &op);
        if matches!(op, RecentOp::Seed { stored: None, .. }) {
            let context =
                json!({ "op": kind, "outcome": "hydration_failed", "count": merged.len() });
            log_sync(LogLevel::Warn, LogStatus::Fail, context, None, None);
        }

        let mode = self
            .modes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .for_focused(sync.focused.as_deref())
            .map(ViewMode::as_str);
        match publish_after(self, merged.clone(), |list| install(list, mode)) {
            Ok(()) => {
                let elapsed = u64::try_from(started.elapsed().as_millis()).ok();
                let context = json!({ "op": kind, "count": merged.len() });
                log_sync(LogLevel::Info, LogStatus::Success, context, None, elapsed);
                Ok(merged)
            }
            Err(e) => {
                // Kind only: an install error is not ours to vouch for as path-free.
                let context = json!({ "op": kind });
                log_sync(
                    LogLevel::Error,
                    LogStatus::Fail,
                    context,
                    Some("install_failed"),
                    None,
                );
                Err(e)
            }
        }
    }
}

fn op_kind(op: &RecentOp) -> &'static str {
    match op {
        RecentOp::Seed { .. } => "seed",
        RecentOp::Record { .. } => "record",
        RecentOp::Refresh => "refresh",
    }
}

/// One `menu.recent_files.sync` record. `context` carries only `op`, `count`
/// and `outcome`; `error` is a fixed kind string, never a message or a path.
fn log_sync(
    level: LogLevel,
    status: LogStatus,
    context: Value,
    error: Option<&str>,
    duration_ms: Option<u64>,
) {
    logger::log_event(LogEntryPayload {
        level,
        event: SYNC_EVENT.to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms,
        error: error.map(String::from),
    });
}

/// Install a menu built from `list`, then publish `list` as the recent files.
///
/// `install` receives the **new** list and runs exactly once while the old list
/// is still published. The state changes only when `install` returns `Ok`, so a
/// failed build or `set_menu` never lets an old menu item index resolve against
/// a list it was not built from (audit row 18).
pub fn publish_after(
    state: &MenuState,
    list: Vec<String>,
    install: impl FnOnce(&[String]) -> Result<(), String>,
) -> Result<(), String> {
    install(&list)?;
    state.set_recent_files(list);
    Ok(())
}

pub(super) fn recent_label(path: &str) -> String {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path);
    file_name.to_string()
}

pub(super) fn build_recent_submenu(
    app: &AppHandle<Wry>,
    recent_files: &[String],
) -> tauri::Result<Submenu<Wry>> {
    let mut builder = SubmenuBuilder::new(app, "Open Recent");
    if recent_files.is_empty() {
        let empty_item = MenuItem::with_id(
            app,
            "menu.file.recent.empty",
            "No Recent Files",
            false,
            None::<&str>,
        )?;
        builder = builder.item(&empty_item);
    } else {
        for (index, path) in recent_files.iter().enumerate() {
            let id = format!("{}{}", MENU_FILE_RECENT_PREFIX, index);
            let label = recent_label(path);
            let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;
            builder = builder.item(&item);
        }
    }
    builder.build()
}

#[cfg(test)]
#[path = "menu_recent_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "menu_recent_command_contract_tests.rs"]
mod command_contract_tests;

#[cfg(test)]
#[path = "menu_recent_op_tests.rs"]
mod op_tests;

#[cfg(test)]
#[path = "menu_recent_op_view_mode_tests.rs"]
mod op_view_mode_tests;

#[cfg(test)]
#[path = "menu_recent_op_validation_tests.rs"]
mod op_validation_tests;

#[cfg(test)]
#[path = "menu_recent_log_tests.rs"]
mod log_tests;
