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
//! @coordinates-with window_focus_mapping.rs (native installed-menu identity)

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
    use super::MenuFocus;
    use crate::menu::menu_target::{NativeRef, NativeTree};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ClassBuilder, NSObject, Sel};
    use objc2::{msg_send, sel, ClassType, Message};
    use objc2_app_kit::{
        NSApplication, NSMenu, NSMenuDidBeginTrackingNotification,
        NSMenuDidEndTrackingNotification, NSMenuWillSendActionNotification,
    };
    use objc2_foundation::{MainThreadMarker, NSNotification, NSNotificationCenter, NSString};
    #[cfg(test)]
    use std::collections::HashMap;
    use std::ffi::CString;
    use std::sync::OnceLock;
    use tauri::menu::MenuItemKind;
    use tauri::{AppHandle, Manager, Wry};

    static APP: OnceLock<AppHandle<Wry>> = OnceLock::new();
    static INSTALLED: OnceLock<()> = OnceLock::new();

    include!("window_focus_mapping.rs");

    extern "C-unwind" fn begin(_observer: &AnyObject, _cmd: Sel, note: *mut AnyObject) {
        let Some(app) = APP.get() else { return };
        let Some(focus) = app.try_state::<MenuFocus>() else {
            return;
        };
        // SAFETY: AppKit supplies a live NSNotification during this callback.
        let note = unsafe { (note as *const NSNotification).as_ref() };
        on_begin(&focus, note, installed_items(app));
    }

    extern "C-unwind" fn end(_observer: &AnyObject, _cmd: Sel, note: *mut AnyObject) {
        let Some(app) = APP.get() else { return };
        let Some(focus) = app.try_state::<MenuFocus>() else {
            return;
        };
        // SAFETY: AppKit supplies a live NSNotification during this callback.
        let note = unsafe { (note as *const NSNotification).as_ref() };
        focus.native_end_notification(note);
    }

    #[cfg(test)]
    mod mapping_tests {
        include!("window_focus_mapping_tests.rs");
        include!("window_focus_d319_f3_map_tests.rs");
    }

    fn note_menu(note: Option<&NSNotification>) -> Option<usize> {
        let note = note?;
        let menu: *mut AnyObject = unsafe { msg_send![note, object] };
        (!menu.is_null()).then_some(menu as usize)
    }

    fn selected_item(note: Option<&NSNotification>) -> Option<usize> {
        let note = note?;
        let user_info: *mut AnyObject = unsafe { msg_send![note, userInfo] };
        if user_info.is_null() {
            return None;
        }
        let key = NSString::from_str("MenuItem");
        let item: *mut AnyObject = unsafe { msg_send![&*user_info, objectForKey: &*key] };
        if item.is_null() {
            return None;
        }
        let action: Option<Sel> = unsafe { msg_send![&*item, action] };
        is_custom_action(action).then_some(item as usize)
    }

    impl MenuFocus {
        /// Decode AppKit's actual selected item; a highlighted neighbor never
        /// identifies the action. Only an installed Muda custom item can queue.
        /// Production queues through `native_will_send`; this is the F1 seam.
        #[cfg(test)]
        pub(super) fn capture_will_send(
            &self,
            note: Option<&NSNotification>,
            items: &HashMap<usize, String>,
        ) {
            if let Some(item) = selected_item(note) {
                if let Some(id) = items.get(&item) {
                    self.will_send_action_id(id);
                }
            }
        }

        /// Ignore Begin notices from menus outside the installed tree.
        pub(super) fn native_begin_notification(
            &self,
            note: Option<&NSNotification>,
            tree: &NativeTree,
        ) {
            if let Some(menu) = note_menu(note) {
                self.begin_native_menu(menu, tree);
            }
        }

        /// Ignore End notices outside the active tracking tree.
        pub(super) fn native_end_notification(&self, note: Option<&NSNotification>) {
            if let Some(menu) = note_menu(note) {
                self.end_native_menu(menu);
            }
        }

        /// Queue the selected item under its owner (current, active or
        /// ended tree); an item we cannot identify drops every capture.
        pub(super) fn native_will_send_notification(
            &self,
            note: Option<&NSNotification>,
            current: &NativeTree,
        ) {
            let (Some(menu), Some(item)) = (note_menu(note), selected_item(note)) else {
                // A selection we cannot identify must not inherit an older
                // pending id, even when menu generations reuse that id.
                self.discard_because("no_item", true);
                return;
            };
            self.native_will_send(menu, item, current);
        }
    }

    extern "C-unwind" fn will_send(_observer: &AnyObject, _cmd: Sel, note: *mut AnyObject) {
        let Some(app) = APP.get() else { return };
        let Some(focus) = app.try_state::<MenuFocus>() else {
            return;
        };
        // SAFETY: AppKit supplies a live NSNotification during this callback.
        let note = unsafe { (note as *const NSNotification).as_ref() };
        on_will_send(&focus, note, installed_items(app));
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
