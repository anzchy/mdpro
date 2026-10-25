//! Purpose: stores the focus and one pending native menu selection for D319.
//! A selected action survives its own End, expires at the next Begin or a
//! mismatched Tauri event, and is consumed at most once by matching Muda id.
//! On macOS an active menu tree authorizes its selected item through a rebuild.
//!
//! @coordinates-with menu_target.rs (routing and dispatch)
//! @coordinates-with services/window_focus.rs (AppKit notification adapter)

#[cfg(target_os = "macos")]
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};

/// `(focused, last_focused)` as read under the lock.
pub type FocusSnapshot = (Option<String>, Option<String>);

/// Native AppKit object identities for the installed Tauri menu tree.
#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Default)]
pub struct NativeTree {
    pub items: HashMap<usize, String>,
    pub menus: HashSet<usize>,
    pub parent_menu: HashMap<usize, usize>,
}

#[cfg(target_os = "macos")]
impl NativeTree {
    fn descends_from_open(&self, menu: usize, open: &HashSet<usize>) -> bool {
        let mut cursor = menu;
        let mut seen = HashSet::new();
        while seen.insert(cursor) {
            let Some(parent) = self.parent_menu.get(&cursor).copied() else {
                break;
            };
            if open.contains(&parent) {
                return true;
            }
            cursor = parent;
        }
        false
    }
}

#[cfg(target_os = "macos")]
#[derive(Debug)]
struct NativeSession {
    tree: NativeTree,
    open_menus: HashSet<usize>,
    selected: bool,
}

#[derive(Debug, Default)]
struct FocusState {
    focused: Option<String>,
    last_focused: Option<String>,
    tracking_depth: usize,
    tracking_snapshot: Option<FocusSnapshot>,
    pending: Option<(Option<String>, FocusSnapshot)>,
    #[cfg(target_os = "macos")]
    native_session: Option<NativeSession>,
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

    /// Only a nested submenu can share the current tracking owner. A sibling,
    /// repeated menu or replacement tree starts a new session even if AppKit
    /// omitted the prior End notification.
    #[cfg(target_os = "macos")]
    pub fn begin_native_menu(&self, menu: usize, tree: &NativeTree) {
        if !tree.menus.contains(&menu) {
            return;
        }
        let mut state = self.state();
        let restart = state.pending.is_some()
            || state.native_session.as_ref().is_none_or(|active| {
                active.tree.menus != tree.menus
                    || active.tree.items != tree.items
                    || active.tree.parent_menu != tree.parent_menu
                    || active.open_menus.contains(&menu)
                    || !tree.descends_from_open(menu, &active.open_menus)
            });
        if restart {
            state.native_session = Some(NativeSession {
                tree: tree.clone(),
                open_menus: HashSet::from([menu]),
                selected: false,
            });
            state.tracking_depth = 0;
            state.tracking_snapshot = None;
        } else if let Some(active) = state.native_session.as_mut() {
            active.open_menus.insert(menu);
        }
        Self::begin_state(&mut state);
    }

    /// End only the active installed menu's tracking session. A selected
    /// action remains pending until its event or the next Begin.
    #[cfg(target_os = "macos")]
    pub fn end_native_menu(&self, menu: usize) {
        let mut state = self.state();
        let Some(active) = state.native_session.as_mut() else {
            return;
        };
        if !active.open_menus.remove(&menu) {
            return;
        }
        let session_ended = active.open_menus.is_empty();
        Self::end_state(&mut state);
        if session_ended {
            state.native_session = None;
            state.tracking_depth = 0;
            state.tracking_snapshot = None;
        }
    }

    /// Map a selected NSMenuItem to the matching Tauri id. A retained M1 item
    /// keeps M1's owner through replacement; a current M2 item without Begin
    /// drops M1's tracking owner and captures M2's selection-time focus.
    #[cfg(target_os = "macos")]
    pub fn native_selection_id(
        &self,
        menu: usize,
        item: usize,
        current: &NativeTree,
    ) -> Option<String> {
        let mut state = self.state();
        let current_id = current
            .menus
            .contains(&menu)
            .then(|| current.items.get(&item).cloned())
            .flatten();
        if current_id.is_some()
            && state.native_session.as_ref().is_some_and(|active| {
                active.tree.menus != current.menus
                    || active.tree.items != current.items
                    || active.tree.parent_menu != current.parent_menu
            })
        {
            // M2's key equivalent need not post Begin. M1 End may be delayed;
            // neither its snapshot nor its selected flag belongs to M2.
            state.native_session = None;
            state.tracking_depth = 0;
            state.tracking_snapshot = None;
            state.pending = None;
        }
        if state.native_session.as_ref().is_some_and(|s| s.selected) {
            return None;
        }
        let id = current_id.or_else(|| {
            state.native_session.as_ref().and_then(|active| {
                active
                    .tree
                    .menus
                    .contains(&menu)
                    .then(|| active.tree.items.get(&item).cloned())
                    .flatten()
            })
        })?;
        if let Some(active) = state.native_session.as_mut() {
            active.selected = true;
        }
        Some(id)
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
        let mut state = self.state();
        let snapshot = state
            .tracking_snapshot
            .clone()
            .unwrap_or_else(|| (state.focused.clone(), state.last_focused.clone()));
        state.pending = Some((id, snapshot));
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
        let mut state = self.state();
        state.pending = None;
        #[cfg(target_os = "macos")]
        {
            state.native_session = None;
            state.tracking_depth = 0;
            state.tracking_snapshot = None;
        }
    }

    pub(super) fn take_capture(&self, id: Option<&str>) -> Option<FocusSnapshot> {
        self.state()
            .pending
            .take()
            .and_then(|(selected, snapshot)| {
                (id.is_none() || selected.as_deref() == id).then_some(snapshot)
            })
    }
}

/// Read when no `MenuFocus` is managed (setup never finished): nothing is
/// focused, so only any_live can answer.
pub static UNMANAGED_FOCUS: MenuFocus = MenuFocus::new();
