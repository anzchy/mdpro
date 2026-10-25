//! Purpose: the macOS half of `MenuFocus` (D319): the installed AppKit menu
//! tree, the active tracking session, the session whose tracking ended
//! unselected (D319-F3), and how Begin / End / WillSend move between them.
//! A child module of menu_capture_state.rs, so it shares `FocusState`.
//!
//! @coordinates-with menu_capture_state.rs (the focus state and capture queue)
//! @coordinates-with menu_target_capture_log.rs (`menu.capture` lines)
//! @coordinates-with services/window_focus.rs (AppKit notification adapter)

use super::{capture_log, discard_entry, store_entry, FocusSnapshot, FocusState, MenuFocus};
use serde_json::json;
use std::collections::{HashMap, HashSet};

/// Native AppKit object identities for the installed Tauri menu tree.
#[derive(Clone, Debug, Default)]
pub struct NativeTree {
    pub items: HashMap<usize, String>,
    pub menus: HashSet<usize>,
    pub parent_menu: HashMap<usize, usize>,
    /// Strong references to every mapped menu and item, so an address above
    /// cannot be reused by a new object while a session holds this tree.
    pub keep_alive: Vec<NativeRef>,
}

/// One retained AppKit object, held only for its retain count.
#[derive(Clone, Debug)]
pub struct NativeRef(pub objc2::rc::Retained<objc2::runtime::NSObject>);

// SAFETY: a `NativeRef` is never messaged; it only keeps an object alive, and
// -retain / -release are thread-safe for every NSObject.
unsafe impl Send for NativeRef {}
unsafe impl Sync for NativeRef {}

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

    fn same_as(&self, other: &NativeTree) -> bool {
        self.menus == other.menus
            && self.items == other.items
            && self.parent_menu == other.parent_menu
    }

    /// The Muda id of `item`, only when AppKit names it inside this tree.
    fn id_of(&self, menu: usize, item: usize) -> Option<String> {
        self.menus
            .contains(&menu)
            .then(|| self.items.get(&item).cloned())
            .flatten()
    }
}

#[derive(Debug)]
pub(super) struct NativeSession {
    pub(super) tree: NativeTree,
    open_menus: HashSet<usize>,
    selected: bool,
    generation: u64,
}

/// A tracking session that ended with nothing selected yet. Its Begin owner
/// may still be claimed by one WillSend for an item only this tree contains.
#[derive(Debug)]
pub(super) struct EndedSession {
    tree: NativeTree,
    snapshot: FocusSnapshot,
    generation: u64,
}

/// Where a WillSend found its item, as logged.
#[derive(Clone, Copy)]
enum ItemSource {
    Current,
    Active,
    Ended,
}

impl ItemSource {
    fn as_str(self) -> &'static str {
        match self {
            ItemSource::Current => "current",
            ItemSource::Active => "active",
            ItemSource::Ended => "ended",
        }
    }
}

impl MenuFocus {
    fn observe(state: &mut FocusState, tree: &NativeTree) -> u64 {
        if state.observed_menus.as_ref() != Some(&tree.menus) {
            state.generation += 1;
            state.observed_menus = Some(tree.menus.clone());
        }
        state.generation
    }

    /// Only a nested submenu can share the current tracking owner. A sibling,
    /// repeated menu or replacement tree starts a new session even if AppKit
    /// omitted the prior End notification. A Begin of a mapped menu expires an
    /// ended session; a foreign Begin (outside the installed tree) changes nothing.
    pub fn begin_native_menu(&self, menu: usize, tree: &NativeTree) {
        let mut logs = Vec::new();
        {
            let mut state = self.state();
            if !tree.menus.contains(&menu) {
                logs.push(capture_log::entry(
                    json!({ "step": "begin", "mapped": false, "restart": false }),
                ));
            } else {
                let generation = Self::observe(&mut state, tree);
                let restart = state.pending.is_some()
                    || state.native_session.as_ref().is_none_or(|active| {
                        !active.tree.same_as(tree)
                            || active.open_menus.contains(&menu)
                            || !tree.descends_from_open(menu, &active.open_menus)
                    });
                if restart {
                    if state.pending.is_some() || state.ended_session.is_some() {
                        logs.push(discard_entry("expired"));
                    }
                    state.ended_session = None;
                    state.native_session = Some(NativeSession {
                        tree: tree.clone(),
                        open_menus: HashSet::from([menu]),
                        selected: false,
                        generation,
                    });
                    state.tracking_depth = 0;
                    state.tracking_snapshot = None;
                } else if let Some(active) = state.native_session.as_mut() {
                    active.open_menus.insert(menu);
                }
                Self::begin_state(&mut state);
                logs.push(capture_log::entry(json!({
                    "step": "begin",
                    "mapped": true,
                    "restart": restart,
                    "generation": generation,
                })));
            }
        }
        capture_log::emit(logs);
    }

    /// End only the active installed menu's tracking session. A selected
    /// action remains pending until its event or the next Begin; an unselected
    /// session keeps its tree and Begin owner as the ended session.
    pub fn end_native_menu(&self, menu: usize) {
        let mut logs = Vec::new();
        {
            let mut state = self.state();
            let Some(active) = state.native_session.as_mut() else {
                return;
            };
            if !active.open_menus.remove(&menu) {
                return;
            }
            let session_ended = active.open_menus.is_empty();
            let snapshot = state.tracking_snapshot.clone();
            Self::end_state(&mut state);
            let mut kept = false;
            if session_ended {
                if let (Some(session), Some(snapshot)) = (state.native_session.take(), snapshot) {
                    if !session.selected {
                        state.ended_session = Some(EndedSession {
                            tree: session.tree,
                            snapshot,
                            generation: session.generation,
                        });
                        kept = true;
                    }
                }
                state.native_session = None;
                state.tracking_depth = 0;
                state.tracking_snapshot = None;
            }
            logs.push(capture_log::entry(json!({
                "step": "end",
                "sessionEnded": session_ended,
                "kept": kept,
            })));
        }
        capture_log::emit(logs);
    }

    /// Queue the selected NSMenuItem under its owner. A current-tree item uses
    /// the active tracking owner or current focus, and drops a session from
    /// another tree (M2's key equivalent need not post Begin). An item only in
    /// the active pre-replacement tree keeps that session's owner; an item only
    /// in the ended tree takes the ended session's Begin owner, once.
    pub fn native_will_send(&self, menu: usize, item: usize, current: &NativeTree) {
        let mut logs = Vec::new();
        {
            let mut state = self.state();
            let generation = Self::observe(&mut state, current);
            let session_generation = state
                .native_session
                .as_ref()
                .map(|s| s.generation)
                .or(state.ended_session.as_ref().map(|s| s.generation));
            let current_id = current.id_of(menu, item);
            if current_id.is_some() {
                if state
                    .native_session
                    .as_ref()
                    .is_some_and(|active| !active.tree.same_as(current))
                {
                    // M1 End may be delayed; neither its snapshot nor its
                    // selected flag belongs to M2.
                    logs.push(discard_entry("tree_replaced"));
                    Self::clear_native(&mut state);
                }
                if state.ended_session.take().is_some() {
                    logs.push(discard_entry("superseded"));
                }
            }
            let found = if let Some(id) = current_id {
                Some((id, ItemSource::Current))
            } else if let Some(id) = state
                .native_session
                .as_ref()
                .and_then(|active| active.tree.id_of(menu, item))
            {
                Some((id, ItemSource::Active))
            } else {
                state
                    .ended_session
                    .as_ref()
                    .and_then(|ended| ended.tree.id_of(menu, item))
                    .map(|id| (id, ItemSource::Ended))
            };
            let send = |item: &str| {
                capture_log::entry(json!({
                    "step": "will_send",
                    "item": item,
                    "generation": generation,
                    "sessionGeneration": session_generation,
                }))
            };
            match found {
                None => {
                    logs.push(send("unmapped"));
                    logs.push(discard_entry("unmapped"));
                    Self::clear_native(&mut state);
                }
                Some((_, source)) if state.native_session.as_ref().is_some_and(|s| s.selected) => {
                    logs.push(send(source.as_str()));
                    logs.push(discard_entry("already_selected"));
                    Self::clear_native(&mut state);
                }
                Some((id, source)) => {
                    logs.push(send(source.as_str()));
                    let snapshot = match source {
                        ItemSource::Ended => state
                            .ended_session
                            .take()
                            .map(|ended| ended.snapshot)
                            .unwrap_or_default(),
                        _ => state
                            .tracking_snapshot
                            .clone()
                            .unwrap_or_else(|| (state.focused.clone(), state.last_focused.clone())),
                    };
                    if let Some(active) = state.native_session.as_mut() {
                        active.selected = true;
                    }
                    logs.push(store_entry(source.as_str(), &snapshot, &state.focused));
                    state.pending = Some((Some(id), snapshot));
                }
            }
        }
        capture_log::emit(logs);
    }

    pub(super) fn clear_native(state: &mut FocusState) {
        state.pending = None;
        state.native_session = None;
        state.ended_session = None;
        state.tracking_depth = 0;
        state.tracking_snapshot = None;
    }
}
