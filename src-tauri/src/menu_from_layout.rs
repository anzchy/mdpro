//! Purpose: resolve macOS native menu item properties from the command layout
//! and the run's applied shortcut snapshot, then build custom native items
//! from that same descriptor list. Off-Mac builders keep their existing keys.
//!
//! @coordinates-with src-tauri/src/menu.rs
//! @coordinates-with src-tauri/src/services/binding_conflicts.rs

use crate::menu_layout::{menu_layout, Availability, KeyKind, MenuLayout, MenuPath, Platform};
use crate::models::{KeyboardShortcuts, LogEntryPayload, LogLevel, LogStatus};
use crate::services::applied_shortcuts::{
    resolve_applied, AppliedBinding, AppliedShortcuts, AppliedShortcutsState, AppliedSource,
};
use crate::services::binding_conflicts::{resolve_with, Resolution, SuppressReason};
use crate::services::logger;
use serde_json::json;
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use tauri::menu::{CheckMenuItem, MenuItem};
use tauri::{AppHandle, Manager, Wry};

use super::menu_availability::{allows, focused_tab_count, switch_documents_enabled, ViewMode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MenuItemSpec {
    pub command_id: String,
    pub menu_id: Option<String>,
    pub path: Vec<String>,
    pub enabled: bool,
    pub accelerator: Option<String>,
}

/// Resolve only editor-owned macOS menu ids. A disabled row still resolves so
/// the click-time availability guard can record its refusal.
pub(super) fn editor_action_for_menu_id(layout: &MenuLayout, menu_id: &str) -> Option<String> {
    layout.rows.iter().find_map(|row| {
        if row.menu_id.as_deref() != Some(menu_id)
            || !matches!(row.menu.macos, MenuPath::Path(_))
            || matches!(row.id.as_str(), "paragraph.table" | "format.highlight")
            || !matches!(
                row.id.split('.').next(),
                Some("edit" | "paragraph" | "format")
            )
        {
            return None;
        }
        Some(format!("editor.{}", row.id))
    })
}

/// Known disabled non-editor items must still reach the click-time refusal.
pub(super) fn unavailable_action_for_menu_id(layout: &MenuLayout, menu_id: &str) -> Option<String> {
    layout.rows.iter().find_map(|row| {
        if row.menu_id.as_deref() == Some(menu_id)
            && matches!(row.menu.macos, MenuPath::Path(_))
            && row.availability.macos.v1 == Availability::None
        {
            Some(row.id.clone())
        } else {
            None
        }
    })
}

pub(super) fn specs_for_app(
    app: &AppHandle<Wry>,
    active_view_mode: Option<&str>,
) -> tauri::Result<Option<Vec<MenuItemSpec>>> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    let default_applied = AppliedShortcuts {
        keyboard_shortcuts_version: 1,
        source: AppliedSource::DefaultsAfterLoadFailure,
        bindings: resolve_applied(&KeyboardShortcuts::default()),
    };
    let managed = app.try_state::<AppliedShortcutsState>();
    let applied = managed
        .as_ref()
        .map(|state| state.snapshot())
        .unwrap_or(&default_applied);
    let layout = menu_layout()
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    let mode = active_view_mode.and_then(|value| ViewMode::parse(value).ok());
    let mut items = menu_layout_for(layout, applied, mode);
    if let Some(item) = items
        .iter_mut()
        .find(|item| item.command_id == "view.switchDocuments")
    {
        item.enabled = switch_documents_enabled(focused_tab_count(app));
        if !item.enabled {
            item.accelerator = None;
        }
    }
    Ok(Some(items))
}

pub(super) fn menu_layout_for(
    layout: &MenuLayout,
    applied: &AppliedShortcuts,
    mode: Option<ViewMode>,
) -> Vec<MenuItemSpec> {
    menu_layout_for_with_logger(layout, applied, mode, logger::log_event)
}

/// Builds descriptors and emits its summary through the supplied log boundary.
fn menu_layout_for_with_logger(
    layout: &MenuLayout,
    applied: &AppliedShortcuts,
    mode: Option<ViewMode>,
    log: impl Fn(LogEntryPayload),
) -> Vec<MenuItemSpec> {
    let stored: BTreeMap<String, String> = applied
        .bindings
        .iter()
        .map(|(field, binding)| {
            let chord = match binding {
                AppliedBinding::Bound { chord } => chord.clone(),
                AppliedBinding::Unassigned => "<unassigned>".to_string(),
                AppliedBinding::System => "<system>".to_string(),
            };
            (field.clone(), chord)
        })
        .collect();
    let resolutions = resolve_with(
        layout,
        Platform::Macos,
        applied.keyboard_shortcuts_version,
        &stored,
        &BTreeMap::new(),
    )
    .resolutions;
    let reserved: BTreeSet<&str> = layout.reserved.macos.iter().map(String::as_str).collect();
    let v2 = applied.keyboard_shortcuts_version >= 2;
    let dropped = Cell::new(0usize);
    let specs: Vec<MenuItemSpec> = layout
        .rows
        .iter()
        .filter_map(|row| {
            let MenuPath::Path(path) = &row.menu.macos else {
                return None;
            };
            let chord = match row.key.macos.kind {
                KeyKind::Fixed => row.key.macos.default_at(v2).map(str::to_string),
                KeyKind::Configurable => {
                    row.pref_field
                        .as_ref()
                        .and_then(|field| match resolutions.get(field) {
                            Some(Resolution::Bound { chord }) => Some(chord.clone()),
                            Some(Resolution::Suppressed {
                                reason: SuppressReason::Unparseable,
                                ..
                            }) => {
                                dropped.set(dropped.get() + 1);
                                log_dropped_accelerator(&row.id, "unparseable", &log);
                                None
                            }
                            Some(Resolution::Suppressed { .. }) => {
                                dropped.set(dropped.get() + 1);
                                None
                            }
                            _ => None,
                        })
                }
            };
            let accelerator = chord.and_then(|chord| {
                if reserved.contains(chord.as_str()) {
                    dropped.set(dropped.get() + 1);
                    return None;
                }
                let native = native_accelerator(&chord);
                if native.is_none() {
                    dropped.set(dropped.get() + 1);
                    log_dropped_accelerator(&row.id, "native_unparseable", &log);
                }
                native
            });
            let enabled = allows(row.availability.macos.v1, mode);
            Some(MenuItemSpec {
                command_id: row.id.clone(),
                menu_id: row.menu_id.clone(),
                path: path.clone(),
                enabled,
                accelerator: accelerator
                    .filter(|_| enabled && !(row.id == "view.switchDocuments" && !v2)),
            })
        })
        .collect();
    log(LogEntryPayload {
        level: LogLevel::Info,
        event: "ui.menu.build".into(),
        status: LogStatus::Success,
        action_id: Some(uuid::Uuid::new_v4().to_string()),
        context: Some(json!({
            "itemCount": specs.len(),
            "disabledCount": specs.iter().filter(|item| !item.enabled).count(),
            "droppedAccelerators": dropped.get(),
            "version": applied.keyboard_shortcuts_version,
        })),
        duration_ms: None,
        error: None,
    });
    specs
}

fn required<'a>(specs: &'a [MenuItemSpec], menu_id: &str) -> tauri::Result<&'a MenuItemSpec> {
    specs
        .iter()
        .find(|spec| spec.menu_id.as_deref() == Some(menu_id))
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("command layout missing menu id {menu_id}"),
            )
            .into()
        })
}

/// Exact values passed to Tauri's native item constructors on macOS.
fn native_parts<'a>(
    specs: &'a [MenuItemSpec],
    menu_id: &str,
) -> tauri::Result<(&'a str, &'a str, bool, Option<&'a str>)> {
    let spec = required(specs, menu_id)?;
    let id = spec
        .menu_id
        .as_deref()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "missing menu id"))?;
    let title = spec
        .path
        .last()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "empty menu path"))?;
    Ok((id, title, spec.enabled, spec.accelerator.as_deref()))
}

/// The one custom-item property entry for the macOS descriptor and the
/// unchanged off-Mac literal. Both feed the same Tauri constructor below.
fn item_parts_or<'a>(
    specs: Option<&'a [MenuItemSpec]>,
    menu_id: &'a str,
    title: &'a str,
    enabled: bool,
    accelerator: Option<&'a str>,
) -> tauri::Result<(&'a str, &'a str, bool, Option<&'a str>)> {
    match specs {
        Some(specs) => native_parts(specs, menu_id),
        None => Ok((menu_id, title, enabled, accelerator)),
    }
}

pub(super) fn menu_item_or(
    app: &AppHandle<Wry>,
    specs: Option<&[MenuItemSpec]>,
    menu_id: &str,
    title: &str,
    enabled: bool,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<Wry>> {
    let (id, title, enabled, accelerator) =
        item_parts_or(specs, menu_id, title, enabled, accelerator)?;
    MenuItem::with_id(app, id, title, enabled, accelerator)
}

/// View's checked items keep their native state while consuming row properties.
pub(super) fn check_item(
    app: &AppHandle<Wry>,
    specs: &[MenuItemSpec],
    menu_id: &str,
    checked: bool,
) -> tauri::Result<CheckMenuItem<Wry>> {
    let (id, title, enabled, accelerator) = native_parts(specs, menu_id)?;
    CheckMenuItem::with_id(app, id, title, enabled, checked, accelerator)
}

fn native_accelerator(chord: &str) -> Option<String> {
    let (modifiers, key) = match chord.rsplit_once('+') {
        Some(parts) => parts,
        None => {
            // The stored grammar permits a bare key only for F1–F12.
            return matches!(
                chord,
                "F1" | "F2"
                    | "F3"
                    | "F4"
                    | "F5"
                    | "F6"
                    | "F7"
                    | "F8"
                    | "F9"
                    | "F10"
                    | "F11"
                    | "F12"
            )
            .then(|| chord.to_string());
        }
    };
    let shifted = modifiers.split('+').any(|modifier| modifier == "Shift");
    // muda 0.20 parses physical Code names, not the shifted character.
    let key = match (key, shifted) {
        ("!", true) => "Digit1",
        ("@", true) => "Digit2",
        ("#", true) => "Digit3",
        ("$", true) => "Digit4",
        ("%", true) => "Digit5",
        ("^", true) => "Digit6",
        ("&", true) => "Digit7",
        ("*", true) => "Digit8",
        ("(", true) => "Digit9",
        (")", true) => "Digit0",
        ("_", true) => "Minus",
        ("{", true) => "BracketLeft",
        ("}", true) => "BracketRight",
        ("|", true) => "Backslash",
        (":", true) => "Semicolon",
        ("\"", true) => "Quote",
        ("<", true) => "Comma",
        (">", true) => "Period",
        ("?", true) => "Slash",
        ("~", true) => "Backquote",
        (
            "!" | "@" | "#" | "$" | "%" | "^" | "&" | "*" | "(" | ")" | "_" | "{" | "}" | "|" | ":"
            | "\"" | "<" | ">" | "?" | "~",
            false,
        ) => return None,
        (other, _) => other,
    };
    Some(format!("{}+{}", modifiers.replace("Option", "Alt"), key))
}

fn log_dropped_accelerator(command_id: &str, reason: &str, log: &impl Fn(LogEntryPayload)) {
    log(LogEntryPayload {
        level: LogLevel::Warn,
        event: "ui.menu.accelerator".into(),
        status: LogStatus::Cancel,
        action_id: None,
        context: Some(json!({ "reason": reason, "command": command_id })),
        duration_ms: None,
        error: None,
    });
}

#[cfg(test)]
#[path = "menu_from_layout_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "menu_from_layout_review_tests.rs"]
mod review_tests;

#[cfg(test)]
#[path = "menu_from_layout_tree_tests.rs"]
mod tree_tests;

#[cfg(test)]
#[path = "menu_from_layout_logging_tests.rs"]
mod logging_tests;

#[cfg(test)]
#[path = "menu_from_layout_unavailable_tests.rs"]
mod unavailable_tests;
