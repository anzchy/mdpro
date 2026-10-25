//! Purpose: stores the focus and one pending native menu selection for D319.
//! A selected action survives its own End, expires at the next Begin or a
//! mismatched Tauri event, and is consumed at most once by matching Muda id.
//! On macOS an active menu tree authorizes its selected item through a rebuild,
//! and so does a tree whose tracking ended unselected (D319-F3): AppKit ends
//! tracking before ⌘` can switch windows, the switch rebuilds the menu, and
//! only then does the selected item post WillSend.
//!
//! @coordinates-with menu_target.rs (routing and dispatch)
//! @coordinates-with menu_target_native_session.rs (the macOS session half)
//! @coordinates-with menu_target_capture_log.rs (`menu.capture` lines)
//! @coordinates-with services/window_focus.rs (AppKit notification adapter)

use super::capture_log;
use crate::models::LogEntryPayload;
use serde_json::json;
use std::sync::{Mutex, MutexGuard};

#[cfg(target_os = "macos")]
#[path = "menu_target_native_session.rs"]
mod native;
#[cfg(target_os = "macos")]
use native::{EndedSession, NativeSession};
#[cfg(target_os = "macos")]
pub use native::{NativeRef, NativeTree};

/// `(focused, last_focused)` as read under the lock.
pub type FocusSnapshot = (Option<String>, Option<String>);

#[derive(Debug, Default)]
struct FocusState {
    focused: Option<String>,
    last_focused: Option<String>,
    tracking_depth: usize,
    tracking_snapshot: Option<FocusSnapshot>,
    pending: Option<(Option<String>, FocusSnapshot)>,
    #[cfg(target_os = "macos")]
    native_session: Option<NativeSession>,
    #[cfg(target_os = "macos")]
    ended_session: Option<EndedSession>,
    /// Distinct installed trees seen by Begin/WillSend, for the logs.
    #[cfg(target_os = "macos")]
    generation: u64,
    #[cfg(target_os = "macos")]
    observed_menus: Option<std::collections::HashSet<usize>>,
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
            tracking_depth: 0,
            tracking_snapshot: None,
            pending: None,
            #[cfg(target_os = "macos")]
            native_session: None,
            #[cfg(target_os = "macos")]
            ended_session: None,
            #[cfg(target_os = "macos")]
            generation: 0,
            #[cfg(target_os = "macos")]
            observed_menus: None,
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

    /// A fixed focus view for the synchronous availability recheck.
    pub fn from_snapshot(snapshot: FocusSnapshot) -> Self {
        Self(Mutex::new(FocusState {
            focused: snapshot.0,
            last_focused: snapshot.1,
            ..FocusState::default()
        }))
    }

    /// Save the first focus snapshot of a native menu tracking session.
    pub fn begin_tracking(&self) {
        let mut state = self.state();
        Self::begin_state(&mut state);
    }

    fn begin_state(state: &mut FocusState) {
        if state.tracking_depth == 0 || state.pending.is_some() {
            state.tracking_snapshot = Some((state.focused.clone(), state.last_focused.clone()));
            state.tracking_depth = 0;
        }
        state.pending = None;
        state.tracking_depth += 1;
    }

    /// End tracking without discarding a selection already queued for Tauri.
    pub fn end_tracking(&self) {
        let mut state = self.state();
        Self::end_state(&mut state);
    }

    fn end_state(state: &mut FocusState) {
        state.tracking_depth = state.tracking_depth.saturating_sub(1);
        if state.tracking_depth == 0 {
            state.tracking_snapshot = None;
        }
    }

    /// Legacy test seam for a custom action without a native item id.
    pub fn will_send_action(&self, custom: bool) {
        if !custom {
            return;
        }
        self.queue_action(None);
    }

    /// Queue the selected Muda item id and focus for only its matching event.
    pub fn will_send_action_id(&self, id: &str) {
        self.queue_action(Some(id.to_string()));
    }

    fn queue_action(&self, id: Option<String>) {
        let entry = {
            let mut state = self.state();
            let snapshot = state
                .tracking_snapshot
                .clone()
                .unwrap_or_else(|| (state.focused.clone(), state.last_focused.clone()));
            let entry = store_entry("direct", &snapshot, &state.focused);
            state.pending = Some((id, snapshot));
            entry
        };
        capture_log::emit(vec![entry]);
    }

    /// The selected focus used by the availability guard before `route` pops it.
    pub fn peek_capture(&self) -> Option<FocusSnapshot> {
        self.state()
            .pending
            .as_ref()
            .map(|(_, snapshot)| snapshot.clone())
    }

    /// Whether the queued native selection belongs to this Tauri event.
    pub fn capture_matches(&self, id: &str) -> bool {
        self.state()
            .pending
            .as_ref()
            .is_some_and(|(selected, _)| selected.as_deref() == Some(id))
    }

    /// Reject a native selection or consume an action handled entirely in
    /// Rust. Neither a pending id nor its old tracking owner may carry into
    /// the next selection without a new Begin.
    pub fn discard_capture(&self) {
        self.discard_because("not_routed", false);
    }

    /// AppKit posted a menu notice but the installed tree could not be
    /// mapped. A Begin is logged as unmapped and changes nothing; a WillSend
    /// drops every capture, since its item cannot be identified.
    #[cfg(all(target_os = "macos", test))]
    pub fn native_tree_unavailable(&self, will_send: bool) {
        self.native_tree_unavailable_with(will_send, "unknown", 0, 0);
    }

    /// `native_tree_unavailable` naming the failed mapping check (`miss`, a
    /// fixed kind) and where it failed (submenu depth, item index).
    #[cfg(target_os = "macos")]
    pub fn native_tree_unavailable_with(
        &self,
        will_send: bool,
        miss: &'static str,
        depth: usize,
        index: usize,
    ) {
        let entry = if will_send {
            self.discard_because_quiet();
            json!({ "step": "discard", "reason": "no_tree" })
        } else {
            json!({ "step": "begin", "mapped": false, "restart": false, "reason": "no_tree" })
        };
        let mut entry = entry;
        entry["miss"] = json!(miss);
        entry["depth"] = json!(depth);
        entry["index"] = json!(index);
        capture_log::emit(vec![capture_log::entry(entry)]);
    }

    /// Drop every capture without logging; the caller logs why.
    #[cfg(target_os = "macos")]
    fn discard_because_quiet(&self) {
        Self::clear_native(&mut self.state());
    }

    /// Drop every capture; log `reason` when something was held, or always.
    pub(crate) fn discard_because(&self, reason: &'static str, always: bool) {
        let held = {
            let mut state = self.state();
            #[allow(unused_mut)]
            let mut held = state.pending.take().is_some();
            #[cfg(target_os = "macos")]
            {
                held |= state.native_session.is_some() || state.ended_session.is_some();
                Self::clear_native(&mut state);
            }
            held
        };
        if held || always {
            capture_log::emit(vec![discard_entry(reason)]);
        }
    }

    /// Take the capture for `id`: `consumed`, `id_mismatch` (the capture is
    /// dropped) or `none`.
    pub(super) fn take_capture(&self, id: Option<&str>) -> (Option<FocusSnapshot>, &'static str) {
        match self.state().pending.take() {
            None => (None, "none"),
            Some((selected, snapshot)) if id.is_none() || selected.as_deref() == id => {
                (Some(snapshot), "consumed")
            }
            Some(_) => (None, "id_mismatch"),
        }
    }
}

fn discard_entry(reason: &'static str) -> LogEntryPayload {
    capture_log::entry(json!({ "step": "discard", "reason": reason }))
}

fn store_entry(
    source: &str,
    snapshot: &FocusSnapshot,
    focused: &Option<String>,
) -> LogEntryPayload {
    capture_log::entry(json!({
        "step": "store",
        "source": source,
        "ownerIsFocused": &snapshot.0 == focused,
    }))
}

/// Read when no `MenuFocus` is managed (setup never finished): nothing is
/// focused, so only any_live can answer.
pub static UNMANAGED_FOCUS: MenuFocus = MenuFocus::new();
