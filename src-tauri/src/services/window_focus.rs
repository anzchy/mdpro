//! Purpose: records which window has focus: one `window.focus` /
//! `window.blur` log line, the MCP shadow store's focused window (D217) and
//! the menu's `MenuFocus`, which picks the window a menu action goes to
//! (D261). On macOS an AppKit observer records menu tracking/action
//! notifications before Tauri routes the delayed native action (D319).
//!
//! Key decisions: `main.rs` calls this from `app.run`'s
//! `RunEvent::WindowEvent`, never from `Builder::on_window_event`. Tauri
//! registers a window's `on_window_event` listener by posting a message to the
//! event loop after the window is built, and building a window makes it key.
//! A window created at runtime (⌘⇧N, an external open) can therefore have its
//! one initial focus event dispatched before that listener exists, and the
//! event is lost; the app-level callback is invoked for every window the
//! runtime knows, with no registration step.
//!
//! The two stores are fed the same event but kept apart: the shadow store's
//! copy is also cleared on the vetoable `CloseRequested`, `MenuFocus` only on
//! `Destroyed`.
//!
//! @coordinates-with main.rs (the `app.run` callback), shadow_store.rs
//! @coordinates-with menu_target.rs (`MenuFocus`)
//! @coordinates-with menu.rs (`handle_menu_event` consumes captures)

use crate::menu::MenuFocus;
use crate::models::{LogEntryPayload, LogLevel, LogStatus, SharedShadowStore};
use crate::services::{logger, shadow_store};
use serde_json::json;

/// The log event name for a focus change.
pub fn focus_event_name(focused: bool) -> &'static str {
    if focused {
        "window.focus"
    } else {
        "window.blur"
    }
}

/// Applies a focus change to the shadow store: focus makes `label` the
/// focused window; blur clears it only while `label` is still the focused
/// one, so a blur that arrives after another window's focus is harmless.
pub fn apply_focus(store: &SharedShadowStore, label: &str, focused: bool) -> Result<(), String> {
    if focused {
        shadow_store::set_focused_window(store, label)
    } else {
        shadow_store::clear_focused_window_if(store, label)
    }
}

/// Logs the focus change and applies it to the shadow store and to the
/// menu's `MenuFocus`, each when it is managed.
pub fn on_focus_event(
    store: Option<&SharedShadowStore>,
    menu_focus: Option<&MenuFocus>,
    label: &str,
    focused: bool,
) {
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: focus_event_name(focused).to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(json!({
            "windowId": label,
            "windowLabel": label
        })),
        duration_ms: None,
        error: None,
    });
    if let Some(store) = store {
        let _ = apply_focus(store, label, focused);
    }
    if let Some(menu_focus) = menu_focus {
        menu_focus.apply(label, focused);
    }
}

/// AppKit menu notifications, reduced to the fields needed by routing.
pub enum NativeMenuNotice {
    BeginTracking,
    WillSendAction { custom: bool },
    EndTracking,
}

/// Apply one native notice to the same capture state consumed by Tauri.
pub fn on_native_menu_notice(focus: &MenuFocus, notice: NativeMenuNotice) {
    match notice {
        NativeMenuNotice::BeginTracking => focus.begin_tracking(),
        NativeMenuNotice::WillSendAction { custom } => focus.will_send_action(custom),
        NativeMenuNotice::EndTracking => focus.end_tracking(),
    }
}

#[cfg(target_os = "macos")]
mod menu_capture {
    use super::{on_native_menu_notice, MenuFocus, NativeMenuNotice};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ClassBuilder, NSObject, Sel};
    use objc2::{msg_send, sel, ClassType};
    use objc2_app_kit::{
        NSMenuDidBeginTrackingNotification, NSMenuDidEndTrackingNotification,
        NSMenuWillSendActionNotification,
    };
    use objc2_foundation::NSNotificationCenter;
    use std::ffi::CString;
    use std::sync::OnceLock;
    use tauri::{AppHandle, Manager, Wry};

    static APP: OnceLock<AppHandle<Wry>> = OnceLock::new();
    static INSTALLED: OnceLock<()> = OnceLock::new();

    fn with_focus(f: impl FnOnce(&MenuFocus)) {
        if let Some(focus) = APP.get().and_then(|app| app.try_state::<MenuFocus>()) {
            f(&focus);
        }
    }

    extern "C-unwind" fn begin(_observer: &AnyObject, _cmd: Sel, _note: *mut AnyObject) {
        with_focus(|focus| on_native_menu_notice(focus, NativeMenuNotice::BeginTracking));
    }

    extern "C-unwind" fn end(_observer: &AnyObject, _cmd: Sel, _note: *mut AnyObject) {
        with_focus(|focus| on_native_menu_notice(focus, NativeMenuNotice::EndTracking));
    }

    pub(super) fn is_custom_action(action: Option<Sel>) -> bool {
        action == Some(sel!(customAction:))
    }

    extern "C-unwind" fn will_send(_observer: &AnyObject, _cmd: Sel, note: *mut AnyObject) {
        // AppKit's notification object is the NSMenu; its highlighted item
        // identifies Muda's customAction: selector. About and system items
        // use other selectors and must not leave a queued capture.
        let custom = if note.is_null() {
            false
        } else {
            // SAFETY: AppKit invokes this observer with a live notification.
            // Nil objects/items return null, which is checked before action.
            let menu: *mut AnyObject = unsafe { msg_send![&*note, object] };
            if menu.is_null() {
                false
            } else {
                let item: *mut AnyObject = unsafe { msg_send![&*menu, highlightedItem] };
                if item.is_null() {
                    false
                } else {
                    let action: Option<Sel> = unsafe { msg_send![&*item, action] };
                    is_custom_action(action)
                }
            }
        };
        with_focus(|focus| {
            on_native_menu_notice(focus, NativeMenuNotice::WillSendAction { custom })
        });
    }

    /// Install once after `MenuFocus` is managed and before the menu is used.
    pub fn install(app: &AppHandle<Wry>) -> Result<(), String> {
        if INSTALLED.get().is_some() {
            return Ok(());
        }
        APP.set(app.clone())
            .map_err(|_| "menu capture app already installed".to_string())?;
        let name = CString::new("MdproMenuCaptureObserver").map_err(|e| e.to_string())?;
        let mut builder = ClassBuilder::new(&name, NSObject::class())
            .ok_or_else(|| "menu capture observer class unavailable".to_string())?;
        // SAFETY: each IMP has the ObjC -(void)selector:(NSNotification *) ABI.
        unsafe {
            builder.add_method(
                sel!(mdproMenuBegin:),
                begin as extern "C-unwind" fn(_, _, _),
            );
            builder.add_method(sel!(mdproMenuEnd:), end as extern "C-unwind" fn(_, _, _));
            builder.add_method(
                sel!(mdproMenuWillSend:),
                will_send as extern "C-unwind" fn(_, _, _),
            );
        }
        let class = builder.register();
        // SAFETY: NSObject supplies +new and the class is registered above.
        let observer: Retained<AnyObject> = unsafe { msg_send![class, new] };
        let center = NSNotificationCenter::defaultCenter();
        // SAFETY: the observer implements all three selectors and is retained
        // for the app lifetime below; the notification names are AppKit statics.
        unsafe {
            center.addObserver_selector_name_object(
                &observer,
                sel!(mdproMenuBegin:),
                Some(NSMenuDidBeginTrackingNotification),
                None,
            );
            center.addObserver_selector_name_object(
                &observer,
                sel!(mdproMenuWillSend:),
                Some(NSMenuWillSendActionNotification),
                None,
            );
            center.addObserver_selector_name_object(
                &observer,
                sel!(mdproMenuEnd:),
                Some(NSMenuDidEndTrackingNotification),
                None,
            );
        }
        std::mem::forget(observer);
        let _ = INSTALLED.set(());
        Ok(())
    }
}

/// Bind macOS native menu notifications to the managed click capture state.
#[cfg(target_os = "macos")]
pub fn install_menu_capture(app: &tauri::AppHandle<tauri::Wry>) -> Result<(), String> {
    menu_capture::install(app)
}

#[cfg(test)]
#[path = "window_focus_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "window_focus_wiring_tests.rs"]
mod wiring_tests;
