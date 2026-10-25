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
    on_focus_event(Some(&store), None, "mdpro-b", true);
    assert_eq!(focused(&store).as_deref(), Some("mdpro-b"));
    on_focus_event(Some(&store), None, "mdpro-b", false);
    assert_eq!(focused(&store), None);
}

#[test]
fn d217_on_focus_event_without_a_store_does_not_panic() {
    on_focus_event(None, None, "main", true);
    on_focus_event(None, None, "main", false);
}

#[cfg(target_os = "macos")]
#[test]
fn d319_only_muda_custom_action_is_queued() {
    use objc2::sel;

    assert!(super::menu_capture::is_custom_action(Some(
        sel!(customAction:)
    )));
    assert!(!super::menu_capture::is_custom_action(Some(
        sel!(customShowAboutPanel:)
    )));
    assert!(!super::menu_capture::is_custom_action(None));
}

#[cfg(target_os = "macos")]
mod d319_native_item_regressions {
    use super::*;
    use crate::menu::menu_target::{route, MenuActionPayload, NativeTree};
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel, ClassType, MainThreadOnly};
    use objc2_app_kit::{
        NSMenu, NSMenuDidBeginTrackingNotification, NSMenuDidEndTrackingNotification, NSMenuItem,
        NSMenuWillSendActionNotification,
    };
    use objc2_foundation::{MainThreadMarker, NSDictionary, NSNotification, NSString};
    use std::collections::HashMap;

    // RED compatibility: the production inherent method takes precedence once added.
    #[allow(dead_code)]
    trait RedNativeAdapter {
        fn capture_will_send(
            &self,
            _note: Option<&NSNotification>,
            _items: &HashMap<usize, String>,
        );
    }
    impl RedNativeAdapter for MenuFocus {
        fn capture_will_send(
            &self,
            _note: Option<&NSNotification>,
            _items: &HashMap<usize, String>,
        ) {
        }
    }

    #[allow(dead_code)]
    trait RedNativeLifecycle {
        fn native_begin_notification(&self, _note: Option<&NSNotification>, _tree: &NativeTree);
        fn native_end_notification(&self, _note: Option<&NSNotification>);
        fn native_will_send_notification(&self, note: Option<&NSNotification>, tree: &NativeTree);
    }
    impl RedNativeLifecycle for MenuFocus {
        fn native_begin_notification(&self, _note: Option<&NSNotification>, _tree: &NativeTree) {
            self.begin_tracking();
        }
        fn native_end_notification(&self, _note: Option<&NSNotification>) {
            self.end_tracking();
        }
        fn native_will_send_notification(&self, note: Option<&NSNotification>, tree: &NativeTree) {
            self.capture_will_send(note, &tree.items);
        }
    }

    fn item(action: Option<objc2::runtime::Sel>) -> Retained<NSMenuItem> {
        let title = NSString::from_str("Action");
        let key = NSString::from_str("");
        unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(MainThreadMarker::new_unchecked()),
                &title,
                action,
                &key,
            )
        }
    }

    fn note(item: Option<&NSMenuItem>, with_info: bool) -> Retained<NSNotification> {
        let info: Option<Retained<NSDictionary>> = if with_info {
            item.map(|selected| {
                let key = NSString::from_str("MenuItem");
                unsafe {
                    msg_send![NSDictionary::<AnyObject, AnyObject>::class(), dictionaryWithObject: selected, forKey: &*key]
                }
            })
        } else {
            None
        };
        unsafe {
            NSNotification::notificationWithName_object_userInfo(
                NSMenuWillSendActionNotification,
                None,
                info.as_deref(),
            )
        }
    }

    fn note_without_menu_item(item: &NSMenuItem) -> Retained<NSNotification> {
        let key = NSString::from_str("OtherItem");
        let info: Retained<NSDictionary> = unsafe {
            msg_send![NSDictionary::<AnyObject, AnyObject>::class(), dictionaryWithObject: item, forKey: &*key]
        };
        unsafe {
            NSNotification::notificationWithName_object_userInfo(
                NSMenuWillSendActionNotification,
                None,
                Some(&info),
            )
        }
    }

    fn tracking_note(menu: &NSMenu, begin: bool) -> Retained<NSNotification> {
        unsafe {
            NSNotification::notificationWithName_object(
                if begin {
                    NSMenuDidBeginTrackingNotification
                } else {
                    NSMenuDidEndTrackingNotification
                },
                Some(menu),
            )
        }
    }

    fn menu_with_save() -> (Retained<NSMenu>, Retained<NSMenuItem>, NativeTree) {
        let marker = unsafe { MainThreadMarker::new_unchecked() };
        let menu = NSMenu::new(marker);
        let save = item(Some(sel!(customAction:)));
        menu.addItem(&save);
        let mut tree = NativeTree::default();
        tree.menus.insert(Retained::as_ptr(&menu) as usize);
        tree.items
            .insert(Retained::as_ptr(&save) as usize, "menu.file.save".into());
        (menu, save, tree)
    }

    fn native_send_note(menu: &NSMenu, item: &NSMenuItem) -> Retained<NSNotification> {
        let key = NSString::from_str("MenuItem");
        let info: Retained<NSDictionary> = unsafe {
            msg_send![NSDictionary::<AnyObject, AnyObject>::class(), dictionaryWithObject: item, forKey: &*key]
        };
        unsafe {
            NSNotification::notificationWithName_object_userInfo(
                NSMenuWillSendActionNotification,
                Some(menu),
                Some(&info),
            )
        }
    }

    fn routed_id(focus: &MenuFocus) -> (Vec<String>, Vec<serde_json::Value>) {
        let mut emitted = Vec::new();
        let mut logs = Vec::new();
        focus.route_for_event(
            "menu.file.save",
            "file.save",
            None,
            &["A".into(), "B".into()],
            |label, _: &MenuActionPayload| {
                emitted.push(label.to_string());
                Ok::<(), ()>(())
            },
            |entry| logs.push(serde_json::to_value(entry).unwrap()),
        );
        (emitted, logs)
    }

    fn routed(focus: &MenuFocus) -> (Vec<String>, Vec<serde_json::Value>) {
        let mut emitted = Vec::new();
        let mut logs = Vec::new();
        route(
            "file.save",
            None,
            focus,
            &["A".into(), "B".into()],
            |label, _: &MenuActionPayload| {
                emitted.push(label.to_string());
                Ok::<(), ()>(())
            },
            |entry| logs.push(serde_json::to_value(entry).unwrap()),
        );
        (emitted, logs)
    }

    #[test]
    fn d319_f1_native_will_send_uses_menu_item_without_highlight() {
        let focus = MenuFocus::default();
        focus.apply("A", true);
        focus.begin_tracking();
        focus.apply("B", true);
        let selected = item(Some(sel!(customAction:)));
        let items = HashMap::from([(
            Retained::as_ptr(&selected) as usize,
            "menu.file.save".into(),
        )]);
        focus.capture_will_send(Some(&note(Some(&selected), true)), &items);
        focus.end_tracking();
        let (emitted, logs) = routed(&focus);
        assert_eq!(emitted, ["A"]);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["context"]["via"], "click_time");
    }

    #[test]
    fn d319_f1_noncustom_sent_item_cannot_inherit_highlight() {
        let focus = MenuFocus::default();
        focus.apply("A", true);
        focus.begin_tracking();
        let copy = item(Some(sel!(copy:)));
        let items = HashMap::from([(Retained::as_ptr(&copy) as usize, "menu.edit.copy".into())]);
        focus.capture_will_send(Some(&note(Some(&copy), true)), &items);
        focus.end_tracking();
        focus.apply("B", true);
        let (emitted, _) = routed(&focus);
        assert_eq!(emitted, ["B"]);
    }

    #[test]
    fn d319_f1_missing_or_foreign_native_item_does_not_capture() {
        for supplied in 0..5 {
            let focus = MenuFocus::default();
            focus.apply("A", true);
            focus.begin_tracking();
            let foreign = item(Some(sel!(customAction:)));
            let installed = item(Some(sel!(customAction:)));
            let items = HashMap::from([(
                Retained::as_ptr(&installed) as usize,
                "menu.file.save".into(),
            )]);
            let event = match supplied {
                0 => None,
                1 => Some(note(None, false)),
                2 => Some(note(None, true)),
                3 => Some(note_without_menu_item(&installed)),
                _ => Some(note(Some(&foreign), true)),
            };
            focus.capture_will_send(event.as_deref(), &items);
            focus.end_tracking();
            focus.apply("B", true);
            let (emitted, logs) = routed(&focus);
            assert_eq!(emitted, ["B"], "case {supplied}");
            assert_eq!(logs.len(), 1);
            assert_eq!(logs[0]["context"]["target"], "B");
        }
    }

    #[test]
    fn d319_f1_foreign_tracking_notices_do_not_change_main_selection() {
        let (menu, save, tree) = menu_with_save();
        let foreign = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
        let focus = MenuFocus::default();
        focus.apply("A", true);
        focus.native_begin_notification(Some(&tracking_note(&foreign, true)), &tree);
        focus.native_begin_notification(Some(&tracking_note(&menu, true)), &tree);
        focus.apply("B", true);
        focus.native_begin_notification(Some(&tracking_note(&foreign, true)), &tree);
        focus.native_end_notification(Some(&tracking_note(&foreign, false)));
        focus.native_will_send_notification(Some(&native_send_note(&menu, &save)), &tree);
        focus.native_end_notification(Some(&tracking_note(&menu, false)));
        let (emitted, logs) = routed_id(&focus);
        assert_eq!(emitted, ["A"]);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["context"]["via"], "click_time");
    }

    #[test]
    fn d319_f1_replaced_menu_keeps_active_selection_but_rejects_detached_notices() {
        let (m1, old_save, old_tree) = menu_with_save();
        let (m2, new_save, new_tree) = menu_with_save();
        let focus = MenuFocus::default();
        focus.apply("A", true);
        focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
        focus.apply("B", true);
        focus.native_will_send_notification(Some(&native_send_note(&m1, &old_save)), &new_tree);
        focus.native_end_notification(Some(&tracking_note(&m1, false)));
        let (emitted, logs) = routed_id(&focus);
        assert_eq!(emitted, ["A"]);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["context"]["via"], "click_time");

        focus.native_will_send_notification(Some(&native_send_note(&m1, &old_save)), &new_tree);
        let (later, _) = routed_id(&focus);
        assert_eq!(later, ["B"]);

        focus.native_begin_notification(Some(&tracking_note(&m2, true)), &new_tree);
        focus.apply("A", true);
        focus.native_will_send_notification(Some(&native_send_note(&m2, &new_save)), &new_tree);
        focus.native_end_notification(Some(&tracking_note(&m2, false)));
        let (newer, newer_logs) = routed_id(&focus);
        assert_eq!(newer, ["B"]);
        assert_eq!(newer_logs[0]["context"]["via"], "click_time");
    }

    #[test]
    fn d319_f1_unbalanced_begin_without_selection_uses_new_owner() {
        for replace_menu in [false, true] {
            let (m1, old_save, old_tree) = menu_with_save();
            let (m2, new_save, new_tree) = menu_with_save();
            let focus = MenuFocus::default();
            focus.apply("A", true);
            focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
            focus.apply("B", true);
            let (menu, save, tree) = if replace_menu {
                (&m2, &new_save, &new_tree)
            } else {
                (&m1, &old_save, &old_tree)
            };
            focus.native_begin_notification(Some(&tracking_note(menu, true)), tree);
            focus.native_will_send_notification(Some(&native_send_note(menu, save)), tree);
            focus.native_end_notification(Some(&tracking_note(menu, false)));
            let (emitted, logs) = routed_id(&focus);
            assert_eq!(emitted, ["B"]);
            assert_eq!(logs[0]["context"]["via"], "focused");
        }
    }

    #[test]
    fn d319_f1_sibling_begin_after_lost_end_uses_new_owner() {
        let (file, _, mut tree) = menu_with_save();
        let (format, highlight, format_tree) = menu_with_save();
        tree.menus.extend(format_tree.menus);
        tree.items.extend(format_tree.items);
        let focus = MenuFocus::default();
        focus.apply("A", true);
        focus.native_begin_notification(Some(&tracking_note(&file, true)), &tree);
        focus.apply("B", true);
        focus.native_begin_notification(Some(&tracking_note(&format, true)), &tree);
        focus.native_will_send_notification(Some(&native_send_note(&format, &highlight)), &tree);
        focus.native_end_notification(Some(&tracking_note(&format, false)));
        let (emitted, logs) = routed_id(&focus);
        assert_eq!(emitted, ["B"]);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["context"]["via"], "focused");
    }

    #[test]
    fn d319_f1_nested_begin_keeps_original_tracking_owner() {
        let (parent, _, mut tree) = menu_with_save();
        let (child, selected, child_tree) = menu_with_save();
        tree.menus.extend(child_tree.menus);
        tree.items.extend(child_tree.items);
        tree.parent_menu.insert(
            Retained::as_ptr(&child) as usize,
            Retained::as_ptr(&parent) as usize,
        );
        let focus = MenuFocus::default();
        focus.apply("A", true);
        focus.native_begin_notification(Some(&tracking_note(&parent, true)), &tree);
        focus.apply("B", true);
        focus.native_begin_notification(Some(&tracking_note(&child, true)), &tree);
        focus.native_will_send_notification(Some(&native_send_note(&child, &selected)), &tree);
        focus.native_end_notification(Some(&tracking_note(&child, false)));
        focus.native_end_notification(Some(&tracking_note(&parent, false)));
        let (emitted, logs) = routed_id(&focus);
        assert_eq!(emitted, ["A"]);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["context"]["via"], "click_time");
    }

    fn routed_id_with_c(focus: &MenuFocus) -> (Vec<String>, Vec<serde_json::Value>) {
        let mut emitted = Vec::new();
        let mut logs = Vec::new();
        focus.route_for_event(
            "menu.file.save",
            "file.save",
            None,
            &["A".into(), "B".into(), "C".into()],
            |label, _: &MenuActionPayload| {
                emitted.push(label.to_string());
                Ok::<(), ()>(())
            },
            |entry| logs.push(serde_json::to_value(entry).unwrap()),
        );
        (emitted, logs)
    }

    #[test]
    fn d319_f2_replacement_shortcut_without_begin_uses_m2_selection_focus() {
        for delayed_m1_end in [false, true] {
            let (m1, _, old_tree) = menu_with_save();
            let (m2, new_save, new_tree) = menu_with_save();
            let focus = MenuFocus::default();
            focus.apply("A", true);
            focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
            focus.apply("B", true);
            focus.native_will_send_notification(Some(&native_send_note(&m2, &new_save)), &new_tree);
            if delayed_m1_end {
                focus.native_end_notification(Some(&tracking_note(&m1, false)));
            }
            let (emitted, logs) = routed_id(&focus);
            assert_eq!(emitted, ["B"]);
            assert_eq!(logs.len(), 1);
            assert_eq!(logs[0]["event"], "menu.action.dispatch");
            assert_eq!(logs[0]["context"]["target"], "B");
            assert_eq!(logs[0]["context"]["via"], "focused");
            assert!(logs[0]["context"].get("value").is_none());
        }
    }

    #[test]
    fn d319_f2_replacement_selection_survives_focus_change_and_consumes_once() {
        for old_selection_consumed in [false, true] {
            for delayed_m1_end in [false, true] {
                let (m1, old_save, old_tree) = menu_with_save();
                let (m2, new_save, new_tree) = menu_with_save();
                let focus = MenuFocus::default();
                focus.apply("A", true);
                focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
                if old_selection_consumed {
                    focus.native_will_send_notification(
                        Some(&native_send_note(&m1, &old_save)),
                        &old_tree,
                    );
                    let (old, _) = routed_id_with_c(&focus);
                    assert_eq!(old, ["A"]);
                }
                focus.apply("B", true);
                focus.native_will_send_notification(
                    Some(&native_send_note(&m2, &new_save)),
                    &new_tree,
                );
                if delayed_m1_end {
                    focus.native_end_notification(Some(&tracking_note(&m1, false)));
                }
                focus.apply("C", true);
                let (first, first_logs) = routed_id_with_c(&focus);
                let (second, second_logs) = routed_id_with_c(&focus);
                assert_eq!(first, ["B"]);
                assert_eq!(second, ["C"]);
                assert_eq!(first_logs.len(), 1);
                assert_eq!(second_logs.len(), 1);
                assert_eq!(first_logs[0]["context"]["via"], "click_time");
                assert_eq!(second_logs[0]["context"]["via"], "focused");
                assert!(first_logs[0]["context"].get("value").is_none());
                assert!(second_logs[0]["context"].get("value").is_none());
            }
        }
    }
}
