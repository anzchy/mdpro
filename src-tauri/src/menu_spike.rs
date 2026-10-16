//! Purpose: M2 spike only (menu plan § 6, branch `spike/menu-m2`, never landed).
//! A keyless Hide mdpro on macOS (C2), a Spike submenu of clipboard probes (C10,
//! § 5.7), and K3's keyed item that can be greyed and re-enabled (K3, D3).
//! Every click logs `spike.m2.*`.
//!
//! @coordinates-with src/spike/m2Probe.ts — runs the `spike.clip.*` actions

use std::sync::Mutex;

use serde_json::json;
use tauri::menu::{MenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Wry};

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;

pub(super) const SPIKE_HIDE: &str = "spike.hide";
const SPIKE_K3: &str = "spike.k3";
const SPIKE_K3_TOGGLE: &str = "spike.k3.toggle";
/// K3's keyed item: Ctrl+Shift+0 is the chord Windows may own for input switching (M2 (d)).
const SPIKE_K3_ACCEL: &str = "CmdOrCtrl+Shift+0";

/// Clipboard probe ids; each is emitted as a `menu:action` of the same name.
const CLIP_ACTIONS: [(&str, &str); 6] = [
    ("spike.clip.async_write_text", "Clip: async writeText"),
    (
        "spike.clip.async_write_item",
        "Clip: async write (html + text)",
    ),
    ("spike.clip.async_read", "Clip: async read / readText"),
    ("spike.clip.exec_copy", "Clip: execCommand copy"),
    ("spike.clip.exec_cut", "Clip: execCommand cut"),
    ("spike.clip.exec_paste", "Clip: execCommand paste"),
];

/// The K3 item's handle, so the toggle can grey it. A menu rebuild (recent files)
/// replaces it with a fresh, enabled item; the brief says so.
static K3_ITEM: Mutex<Option<MenuItem<Wry>>> = Mutex::new(None);

pub(super) fn log_spike(event: &str, context: serde_json::Value) {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: event.to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error: None,
    });
}

/// Hide mdpro with no accelerator, replacing the predefined Hide (⌘H).
pub(super) fn hide_item(app: &AppHandle<Wry>) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, SPIKE_HIDE, "Hide mdpro", true, None::<&str>)
}

pub(super) fn spike_menu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    let k3 = MenuItem::with_id(
        app,
        SPIKE_K3,
        "K3: Ctrl+Shift+0 item",
        true,
        Some(SPIKE_K3_ACCEL),
    )?;
    let toggle = MenuItem::with_id(
        app,
        SPIKE_K3_TOGGLE,
        "K3: grey / enable the item above",
        true,
        None::<&str>,
    )?;
    let mut builder = SubmenuBuilder::new(app, "Spike");
    for (id, label) in CLIP_ACTIONS {
        builder = builder.item(&MenuItem::with_id(app, id, label, true, None::<&str>)?);
    }
    let submenu = builder.separator().item(&k3).item(&toggle).build()?;
    if let Ok(mut slot) = K3_ITEM.lock() {
        *slot = Some(k3);
    }
    Ok(submenu)
}

/// Handles a spike id. Returns `false` when `id` is not a spike id.
pub(super) fn handle(app: &AppHandle<Wry>, id: &str, emit: impl Fn(&str)) -> bool {
    match id {
        SPIKE_HIDE => {
            let result = app.hide();
            log_spike("spike.m2.hide", json!({ "ok": result.is_ok() }));
        }
        SPIKE_K3 => log_spike("spike.m2.k3.fired", json!({ "accel": SPIKE_K3_ACCEL })),
        SPIKE_K3_TOGGLE => {
            let state = K3_ITEM.lock().ok().and_then(|slot| {
                slot.as_ref().map(|item| {
                    let next = !item.is_enabled().unwrap_or(true);
                    (next, item.set_enabled(next).is_ok())
                })
            });
            let context = match state {
                Some((enabled, ok)) => json!({ "enabled": enabled, "ok": ok }),
                None => json!({ "enabled": null, "ok": false }),
            };
            log_spike("spike.m2.k3.toggle", context);
        }
        _ if CLIP_ACTIONS.iter().any(|(clip, _)| *clip == id) => {
            log_spike("spike.m2.clip.menu_click", json!({ "action": id }));
            emit(id);
        }
        _ => return false,
    }
    true
}
