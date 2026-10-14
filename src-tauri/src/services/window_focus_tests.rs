//! D217 / ADR47-WI004-1: the focus record that `app.run` drives.
use super::*;
use crate::services::shadow_store::{create_shadow_store, is_any_window_focused};

fn focused(store: &SharedShadowStore) -> Option<String> {
    store.lock().unwrap().focused_window.clone()
}

#[test]
fn d217_focus_names_the_log_events() {
    assert_eq!(focus_event_name(true), "window.focus");
    assert_eq!(focus_event_name(false), "window.blur");
}

#[test]
fn d217_focus_sets_the_focused_window() {
    let store = create_shadow_store();
    apply_focus(&store, "main", true).unwrap();
    assert_eq!(focused(&store).as_deref(), Some("main"));
}

#[test]
fn d217_blur_of_the_focused_window_clears_it() {
    let store = create_shadow_store();
    apply_focus(&store, "main", true).unwrap();
    apply_focus(&store, "main", false).unwrap();
    assert_eq!(focused(&store), None);
    assert!(!is_any_window_focused(&store).unwrap());
}

#[test]
fn d217_blur_of_another_window_keeps_the_focus() {
    let store = create_shadow_store();
    apply_focus(&store, "mdpro-b", true).unwrap();
    apply_focus(&store, "main", false).unwrap();
    assert_eq!(focused(&store).as_deref(), Some("mdpro-b"));
}

/// The F2 sequence seen on the mini: main is focused, ⌘⇧N blurs it, and the
/// new window's focus must land even though it arrives after main's blur.
#[test]
fn d217_a_new_window_focus_after_main_blur_is_recorded() {
    let store = create_shadow_store();
    apply_focus(&store, "main", true).unwrap();
    apply_focus(&store, "main", false).unwrap();
    apply_focus(&store, "mdpro-b", true).unwrap();
    assert_eq!(focused(&store).as_deref(), Some("mdpro-b"));
}

/// Either order of main's blur and B's focus ends with B focused.
#[test]
fn d217_a_late_main_blur_does_not_clear_the_new_window() {
    let store = create_shadow_store();
    apply_focus(&store, "main", true).unwrap();
    apply_focus(&store, "mdpro-b", true).unwrap();
    apply_focus(&store, "main", false).unwrap();
    assert_eq!(focused(&store).as_deref(), Some("mdpro-b"));
}

#[test]
fn d217_on_focus_event_applies_to_a_managed_store() {
    let store = create_shadow_store();
    on_focus_event(Some(&store), "mdpro-b", true);
    assert_eq!(focused(&store).as_deref(), Some("mdpro-b"));
    on_focus_event(Some(&store), "mdpro-b", false);
    assert_eq!(focused(&store), None);
}

#[test]
fn d217_on_focus_event_without_a_store_does_not_panic() {
    on_focus_event(None, "main", true);
    on_focus_event(None, "main", false);
}
