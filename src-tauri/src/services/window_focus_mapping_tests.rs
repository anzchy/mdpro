use super::*;
use crate::menu::menu_target::MenuActionPayload;
use objc2::MainThreadOnly;
use objc2_app_kit::NSMenuItem;
use objc2_foundation::{NSDictionary, NSNotification, NSString};

fn expected(
    id: &str,
    title: Option<&str>,
    custom: bool,
    children: Option<Vec<ExpectedItem>>,
) -> ExpectedItem {
    ExpectedItem {
        id: id.into(),
        title: title.map(str::to_string),
        custom,
        children,
    }
}

fn native_item(title: &str, action: Option<Sel>) -> Retained<NSMenuItem> {
    let marker = unsafe { MainThreadMarker::new_unchecked() };
    unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(marker),
            &NSString::from_str(title),
            action,
            &NSString::from_str(""),
        )
    }
}

fn append_submenu(root: &NSMenu, title: &str, children: &[&NSMenuItem]) -> Retained<NSMenu> {
    let submenu = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    for child in children {
        submenu.addItem(child);
    }
    let parent = native_item(title, None);
    parent.setSubmenu(Some(&submenu));
    root.addItem(&parent);
    submenu
}

fn tracking_note(menu: &NSMenu) -> Retained<NSNotification> {
    unsafe {
        NSNotification::notificationWithName_object(NSMenuDidBeginTrackingNotification, Some(menu))
    }
}

fn send_note(menu: &NSMenu, item: &NSMenuItem) -> Retained<NSNotification> {
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

#[test]
fn d319_f2_appkit_native_tree_maps_save_after_edit_additions() {
    let expected = vec![
        expected(
            "menu.file",
            Some("File"),
            false,
            Some(vec![expected("menu.file.save", Some("Save"), true, None)]),
        ),
        expected(
            "menu.edit",
            Some("Edit"),
            false,
            Some(vec![
                expected("menu.edit.copy", None, false, None),
                expected("menu.edit.find_next", Some("Find Next"), true, None),
            ]),
        ),
    ];

    let marker = unsafe { MainThreadMarker::new_unchecked() };
    let native = NSMenu::new(marker);
    let native_save = native_item("Save", Some(sel!(customAction:)));
    let file_native = append_submenu(&native, "File", &[&native_save]);
    let native_copy = native_item("Copy", Some(sel!(copy:)));
    let native_find = native_item("Find Next", Some(sel!(customAction:)));
    let edit_native = append_submenu(&native, "Edit", &[&native_copy, &native_find]);
    let before = expected[1].children.as_ref().unwrap().len();
    for suffix in ["AutoFill", "Start Dictation", "Emoji & Symbols"] {
        edit_native.addItem(&native_item(suffix, Some(sel!(copy:))));
    }
    assert!(edit_native.numberOfItems() as usize > before);

    let mut tree = NativeTree::default();
    let mapped = map_items(&native, expected, &mut tree, None);
    assert!(
        mapped.is_some(),
        "Edit suffix must not reject the whole menu"
    );
    assert_eq!(
        tree.items
            .get(&(Retained::as_ptr(&native_save) as usize))
            .map(String::as_str),
        Some("menu.file.save")
    );

    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&file_native)), &tree);
    focus.apply("B", true);
    focus.native_will_send_notification(Some(&send_note(&file_native, &native_save)), &tree);
    let mut targets = Vec::new();
    let mut logs = Vec::new();
    focus.route_for_event(
        "menu.file.save",
        "file.save",
        None,
        &["A".into(), "B".into()],
        |label, _: &MenuActionPayload| {
            targets.push(label.to_string());
            Ok::<(), ()>(())
        },
        |entry| logs.push(serde_json::to_value(entry).unwrap()),
    );
    assert_eq!(targets, ["A"]);
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["event"], "menu.action.dispatch");
    assert_eq!(logs[0]["context"]["via"], "click_time");
    assert!(logs[0]["context"].get("value").is_none());
}

#[test]
fn d319_f2_noncustom_suffix_length_and_location_preserve_mapping() {
    for (submenu_name, extra_count) in [("File", 0), ("File", 1), ("File", 9), ("Edit", 12)] {
        let native = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
        let save = native_item("Save", Some(sel!(customAction:)));
        let file = append_submenu(&native, "File", &[&save]);
        let copy = native_item("Copy", Some(sel!(copy:)));
        let edit = append_submenu(&native, "Edit", &[&copy]);
        let chosen = if submenu_name == "File" { &file } else { &edit };
        for number in 0..extra_count {
            chosen.addItem(&native_item(&format!("System {number}"), Some(sel!(copy:))));
        }
        let expected = vec![
            expected(
                "menu.file",
                Some("File"),
                false,
                Some(vec![expected("menu.file.save", Some("Save"), true, None)]),
            ),
            expected(
                "menu.edit",
                Some("Edit"),
                false,
                Some(vec![expected("menu.edit.copy", None, false, None)]),
            ),
        ];
        let mut tree = NativeTree::default();
        assert!(
            map_items(&native, expected, &mut tree, None).is_some(),
            "{submenu_name} {extra_count}"
        );
        assert_eq!(
            tree.items
                .get(&(Retained::as_ptr(&save) as usize))
                .map(String::as_str),
            Some("menu.file.save")
        );
    }
}

#[test]
fn d319_f2_custom_surplus_or_reordered_custom_items_fail_closed() {
    for custom_at_start in [false, true] {
        let native = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
        let save = native_item("Save", Some(sel!(customAction:)));
        let extra = native_item("Extra", Some(sel!(customAction:)));
        let ordered = if custom_at_start {
            [&*extra, &*save]
        } else {
            [&*save, &*extra]
        };
        let file = append_submenu(&native, "File", &ordered);
        let expected = vec![expected(
            "menu.file",
            Some("File"),
            false,
            Some(vec![expected("menu.file.save", Some("Save"), true, None)]),
        )];
        let mut tree = NativeTree::default();
        assert!(map_items(&native, expected, &mut tree, None).is_none());
        assert_eq!(file.numberOfItems(), 2);
    }
    let native = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    let open = native_item("Open", Some(sel!(customAction:)));
    let save = native_item("Save", Some(sel!(customAction:)));
    append_submenu(&native, "File", &[&open, &save]);
    let expected = vec![expected(
        "menu.file",
        Some("File"),
        false,
        Some(vec![
            expected("menu.file.save", Some("Save"), true, None),
            expected("menu.file.open", Some("Open"), true, None),
        ]),
    )];
    let mut tree = NativeTree::default();
    assert!(map_items(&native, expected, &mut tree, None).is_none());
}

#[test]
fn d319_f2_noncustom_item_and_unmatched_event_do_not_borrow_capture() {
    let native = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    let save = native_item("Save", Some(sel!(customAction:)));
    let extra = native_item("System", Some(sel!(copy:)));
    let file = append_submenu(&native, "File", &[&save, &extra]);
    let expected = vec![expected(
        "menu.file",
        Some("File"),
        false,
        Some(vec![expected("menu.file.save", Some("Save"), true, None)]),
    )];
    let mut tree = NativeTree::default();
    assert!(map_items(&native, expected, &mut tree, None).is_some());

    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&file)), &tree);
    focus.apply("B", true);
    focus.native_will_send_notification(Some(&send_note(&file, &extra)), &tree);
    assert!(focus.peek_capture().is_none());
    focus.native_will_send_notification(Some(&send_note(&file, &save)), &tree);
    let mut first = Vec::new();
    focus.route_for_event(
        "menu.file.open",
        "file.open",
        None,
        &["A".into(), "B".into()],
        |label, _: &MenuActionPayload| {
            first.push(label.to_string());
            Ok::<(), ()>(())
        },
        |_| {},
    );
    let mut second = Vec::new();
    let mut logs = Vec::new();
    focus.route_for_event(
        "menu.file.save",
        "file.save",
        None,
        &["A".into(), "B".into()],
        |label, _: &MenuActionPayload| {
            second.push(label.to_string());
            Ok::<(), ()>(())
        },
        |entry| logs.push(serde_json::to_value(entry).unwrap()),
    );
    assert_eq!(first, ["B"]);
    assert_eq!(second, ["B"]);
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["context"]["via"], "focused");
}

fn recent_menu(
    titles: [&str; 2],
) -> (
    Retained<NSMenu>,
    Retained<NSMenu>,
    Retained<NSMenu>,
    Retained<NSMenuItem>,
    Retained<NSMenuItem>,
    Vec<ExpectedItem>,
) {
    let native = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    let save = native_item("Save", Some(sel!(customAction:)));
    let first = native_item(titles[0], Some(sel!(customAction:)));
    let second = native_item(titles[1], Some(sel!(customAction:)));
    let recent = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    recent.addItem(&first);
    recent.addItem(&second);
    let recent_parent = native_item("Open Recent", None);
    recent_parent.setSubmenu(Some(&recent));
    let file = append_submenu(&native, "File", &[&save, &recent_parent]);
    let expected = vec![expected(
        "menu.file",
        Some("File"),
        false,
        Some(vec![
            expected("menu.file.save", Some("Save"), true, None),
            expected(
                "menu.file.recent",
                Some("Open Recent"),
                false,
                Some(vec![
                    expected("menu.file.recent.0", Some(titles[0]), true, None),
                    expected("menu.file.recent.1", Some(titles[1]), true, None),
                ]),
            ),
        ]),
    )];
    (native, file, recent, save, first, expected)
}

fn route_id(focus: &MenuFocus, id: &str, action: &str) -> (Vec<String>, Vec<serde_json::Value>) {
    let mut targets = Vec::new();
    let mut logs = Vec::new();
    focus.route_for_event(
        id,
        action,
        None,
        &["A".into(), "B".into()],
        |label, _: &MenuActionPayload| {
            targets.push(label.to_string());
            Ok::<(), ()>(())
        },
        |entry| logs.push(serde_json::to_value(entry).unwrap()),
    );
    (targets, logs)
}

#[test]
fn d319_f2_duplicate_recent_names_keep_unique_save_capture() {
    let (native, file, _recent, save, _first, expected) =
        recent_menu(["README.md", "README.md"]);
    let mut tree = NativeTree::default();
    assert!(map_items(&native, expected, &mut tree, None).is_some());

    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&file)), &tree);
    focus.native_will_send_notification(Some(&send_note(&file, &save)), &tree);
    focus.apply("B", true);
    let (targets, logs) = route_id(&focus, "menu.file.save", "file.save");
    assert_eq!(targets, ["A"]);
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["event"], "menu.action.dispatch");
    assert_eq!(logs[0]["context"]["via"], "click_time");
    assert!(logs[0]["context"].get("value").is_none());
}

#[test]
fn d319_f2_duplicate_recent_items_do_not_guess_an_id() {
    let (native, _file, recent, _save, first, expected) =
        recent_menu(["README.md", "README.md"]);
    let mut tree = NativeTree::default();
    assert!(map_items(&native, expected, &mut tree, None).is_some());
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&recent)), &tree);
    focus.native_will_send_notification(Some(&send_note(&recent, &first)), &tree);
    focus.apply("B", true);
    let (targets, logs) = route_id(&focus, "menu.file.recent.0", "file.open_recent");
    assert_eq!(targets, ["B"]);
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["context"]["via"], "focused");
}

#[test]
fn d319_f2_excluded_m2_recent_expires_same_id_m1_capture() {
    let (m1, _file1, recent1, _save1, first1, expected1) =
        recent_menu(["first.md", "second.md"]);
    let (m2, _file2, recent2, _save2, first2, expected2) =
        recent_menu(["README.md", "README.md"]);
    let mut tree1 = NativeTree::default();
    let mut tree2 = NativeTree::default();
    assert!(map_items(&m1, expected1, &mut tree1, None).is_some());
    assert!(map_items(&m2, expected2, &mut tree2, None).is_some());
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&recent1)), &tree1);
    focus.native_will_send_notification(Some(&send_note(&recent1, &first1)), &tree1);
    focus.apply("B", true);
    focus.native_will_send_notification(Some(&send_note(&recent2, &first2)), &tree2);
    let (first_targets, first_logs) =
        route_id(&focus, "menu.file.recent.0", "file.open_recent");
    let (second_targets, second_logs) =
        route_id(&focus, "menu.file.recent.0", "file.open_recent");
    assert_eq!(first_targets, ["B"]);
    assert_eq!(second_targets, ["B"]);
    assert_eq!(first_logs.len(), 1);
    assert_eq!(second_logs.len(), 1);
    assert_eq!(first_logs[0]["context"]["via"], "focused");
    assert!(first_logs[0]["context"].get("value").is_none());
    assert!(second_logs[0]["context"].get("value").is_none());
}

#[test]
fn d319_f2_ambiguous_menu_shapes_reject_without_stale_dispatch() {
    fn rejected_case(native: &NSMenu, expected: Vec<ExpectedItem>, file: &NSMenu, save: &NSMenuItem) {
        let mut tree = NativeTree::default();
        assert!(map_items(native, expected, &mut tree, None).is_none());
        let focus = MenuFocus::default();
        focus.apply("A", true);
        focus.will_send_action_id("menu.file.save");
        focus.apply("B", true);
        focus.native_will_send_notification(Some(&send_note(file, save)), &NativeTree::default());
        let (targets, logs) = route_id(&focus, "menu.file.save", "file.save");
        assert_eq!(targets, ["B"]);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["context"]["via"], "focused");
        assert!(logs[0]["context"].get("value").is_none());
    }

    // A custom insertion between two expected children must not be mistaken
    // for the second id.
    let native = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    let save = native_item("Save", Some(sel!(customAction:)));
    let inserted = native_item("Inserted", Some(sel!(customAction:)));
    let open = native_item("Open", Some(sel!(customAction:)));
    let file = append_submenu(&native, "File", &[&save, &inserted, &open]);
    rejected_case(
        &native,
        vec![expected(
            "menu.file",
            Some("File"),
            false,
            Some(vec![
                expected("menu.file.save", Some("Save"), true, None),
                expected("menu.file.open", Some("Open"), true, None),
            ]),
        )],
        &file,
        &save,
    );

    // The same child count does not legitimize a custom/noncustom swap.
    let native = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    let save = native_item("Save", Some(sel!(customAction:)));
    let copy = native_item("Copy", Some(sel!(copy:)));
    let file = append_submenu(&native, "File", &[&save, &copy]);
    rejected_case(
        &native,
        vec![expected(
            "menu.file",
            Some("File"),
            false,
            Some(vec![
                expected("menu.file.copy", Some("Copy"), false, None),
                expected("menu.file.save", Some("Save"), true, None),
            ]),
        )],
        &file,
        &save,
    );

    // A native leaf cannot stand in for an expected submenu.
    let native = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    let save = native_item("Save", Some(sel!(customAction:)));
    let recent_leaf = native_item("Open Recent", None);
    let file = append_submenu(&native, "File", &[&save, &recent_leaf]);
    rejected_case(
        &native,
        vec![expected(
            "menu.file",
            Some("File"),
            false,
            Some(vec![
                expected("menu.file.save", Some("Save"), true, None),
                expected(
                    "menu.file.recent",
                    Some("Open Recent"),
                    false,
                    Some(vec![expected("menu.file.recent.0", Some("A"), true, None)]),
                ),
            ]),
        )],
        &file,
        &save,
    );

    // A surplus submenu can hide a custom descendant even with no custom
    // selector on its own parent item.
    let native = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    let save = native_item("Save", Some(sel!(customAction:)));
    let file = append_submenu(&native, "File", &[&save]);
    let nested = native_item("Nested", Some(sel!(customAction:)));
    append_submenu(&file, "System", &[&nested]);
    rejected_case(
        &native,
        vec![expected(
            "menu.file",
            Some("File"),
            false,
            Some(vec![expected("menu.file.save", Some("Save"), true, None)]),
        )],
        &file,
        &save,
    );
}

#[test]
fn d319_f2_either_duplicate_recent_item_routes_by_arrival_focus() {
    let (native, _file, recent, _save, first, expected) =
        recent_menu(["README.md", "README.md"]);
    let second = recent.itemAtIndex(1).unwrap();
    let mut tree = NativeTree::default();
    assert!(map_items(&native, expected, &mut tree, None).is_some());
    for (item, id) in [(&*first, "menu.file.recent.0"), (&*second, "menu.file.recent.1")] {
        let focus = MenuFocus::default();
        focus.apply("A", true);
        focus.native_begin_notification(Some(&tracking_note(&recent)), &tree);
        focus.native_will_send_notification(Some(&send_note(&recent, item)), &tree);
        focus.apply("B", true);
        let (targets, logs) = route_id(&focus, id, "file.open_recent");
        assert_eq!(targets, ["B"]);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["context"]["via"], "focused");
        assert!(logs[0]["context"].get("value").is_none());
    }
}

#[test]
fn d319_f2_duplicate_recent_save_capture_is_consumed_once() {
    let (native, file, _recent, save, _first, expected) =
        recent_menu(["README.md", "README.md"]);
    let mut tree = NativeTree::default();
    assert!(map_items(&native, expected, &mut tree, None).is_some());
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&file)), &tree);
    focus.native_will_send_notification(Some(&send_note(&file, &save)), &tree);
    focus.apply("B", true);
    let (first, first_logs) = route_id(&focus, "menu.file.save", "file.save");
    let (second, second_logs) = route_id(&focus, "menu.file.save", "file.save");
    assert_eq!(first, ["A"]);
    assert_eq!(second, ["B"]);
    assert_eq!(first_logs.len(), 1);
    assert_eq!(second_logs.len(), 1);
    assert_eq!(first_logs[0]["context"]["via"], "click_time");
    assert_eq!(second_logs[0]["context"]["via"], "focused");
    assert!(first_logs[0]["context"].get("value").is_none());
    assert!(second_logs[0]["context"].get("value").is_none());
}

#[test]
fn d319_f2_rejected_recent_selection_retires_same_tree_tracking_owner() {
    let (native, file, recent, save, first, expected) =
        recent_menu(["README.md", "README.md"]);
    let mut tree = NativeTree::default();
    assert!(map_items(&native, expected, &mut tree, None).is_some());
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&recent)), &tree);
    focus.native_will_send_notification(Some(&send_note(&recent, &first)), &tree);
    focus.apply("B", true);
    // A key equivalent may select Save without another Begin or an End for
    // the rejected Recent selection. It belongs to B, not Recent's owner A.
    focus.native_will_send_notification(Some(&send_note(&file, &save)), &tree);
    let (first_targets, first_logs) = route_id(&focus, "menu.file.save", "file.save");
    let (second_targets, second_logs) = route_id(&focus, "menu.file.save", "file.save");
    assert_eq!(first_targets, ["B"]);
    assert_eq!(second_targets, ["B"]);
    assert_eq!(first_logs.len(), 1);
    assert_eq!(second_logs.len(), 1);
    assert_eq!(first_logs[0]["context"]["via"], "focused");
    assert_eq!(second_logs[0]["context"]["via"], "focused");
    assert!(first_logs[0]["context"].get("value").is_none());
    assert!(second_logs[0]["context"].get("value").is_none());
}
