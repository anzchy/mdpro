// D319-F3 WI-3: when the installed menu cannot be mapped, the next device
// run must say where and why, without a title. Included into
// `menu_capture::mapping_tests`.

use crate::menu::menu_target::capture_log::test_sink;

fn miss_of(native: &NSMenu, expected: Vec<ExpectedItem>) -> Result<(), MapMiss> {
    let mut tree = NativeTree::default();
    map_items_checked(native, expected, &mut tree, None, 0)
}

fn assert_miss(result: Result<(), MapMiss>, kind: &str, depth: usize, index: usize) {
    let miss = result.expect_err("mapping must fail");
    assert_eq!((miss.kind, miss.depth, miss.index), (kind, depth, index));
}

fn custom() -> Option<Sel> {
    Some(sel!(customAction:))
}

#[test]
fn d319_f3_map_reports_each_miss_kind() {
    let marker = unsafe { MainThreadMarker::new_unchecked() };

    // count: Tauri expects two root items, AppKit has one.
    let native = NSMenu::new(marker);
    native.addItem(&native_item("Save", custom()));
    assert_miss(
        miss_of(
            &native,
            vec![
                expected("a", Some("Save"), true, None),
                expected("b", Some("Close"), true, None),
            ],
        ),
        "count",
        0,
        2,
    );

    // custom: the second item has no Muda action.
    let native = NSMenu::new(marker);
    native.addItem(&native_item("Save", custom()));
    native.addItem(&native_item("Close", None));
    assert_miss(
        miss_of(
            &native,
            vec![
                expected("a", Some("Save"), true, None),
                expected("b", Some("Close"), true, None),
            ],
        ),
        "custom",
        0,
        1,
    );

    // submenu: a submenu was expected, a plain item is installed.
    let native = NSMenu::new(marker);
    native.addItem(&native_item("File", None));
    assert_miss(
        miss_of(
            &native,
            vec![expected(
                "menu.file",
                Some("File"),
                false,
                Some(vec![expected("s", Some("Save"), true, None)]),
            )],
        ),
        "submenu",
        0,
        0,
    );

    // title, one level down.
    let native = NSMenu::new(marker);
    let other = native_item("Other", custom());
    append_submenu(&native, "File", &[&other]);
    assert_miss(
        miss_of(
            &native,
            vec![expected(
                "menu.file",
                Some("File"),
                false,
                Some(vec![expected("s", Some("Save"), true, None)]),
            )],
        ),
        "title",
        1,
        0,
    );

    // ambiguous_submenu: duplicate custom titles beside a submenu.
    let native = NSMenu::new(marker);
    native.addItem(&native_item("README.md", custom()));
    native.addItem(&native_item("README.md", custom()));
    let inner = native_item("Inner", custom());
    append_submenu(&native, "More", &[&inner]);
    assert_miss(
        miss_of(
            &native,
            vec![
                expected("r0", Some("README.md"), true, None),
                expected("r1", Some("README.md"), true, None),
                expected(
                    "more",
                    Some("More"),
                    false,
                    Some(vec![expected("i", Some("Inner"), true, None)]),
                ),
            ],
        ),
        "ambiguous_submenu",
        0,
        2,
    );

    // surplus_custom: AppKit cannot add a Muda item after the expected ones.
    let native = NSMenu::new(marker);
    native.addItem(&native_item("Save", custom()));
    native.addItem(&native_item("Extra", custom()));
    assert_miss(
        miss_of(&native, vec![expected("a", Some("Save"), true, None)]),
        "surplus_custom",
        0,
        1,
    );

    // A matching tree maps.
    let native = NSMenu::new(marker);
    native.addItem(&native_item("Save", custom()));
    native.addItem(&native_item("Dictation", None));
    let mut tree = NativeTree::default();
    assert!(map_items_checked(
        &native,
        vec![expected("a", Some("Save"), true, None)],
        &mut tree,
        None,
        0,
    )
    .is_ok());
    let mut legacy = NativeTree::default();
    assert!(map_items(
        &native,
        vec![expected("a", Some("Save"), true, None)],
        &mut legacy,
        None
    )
    .is_some());
    assert_eq!(tree.items.values().collect::<Vec<_>>(), ["a"]);
    assert_eq!(tree.items, legacy.items);
    assert_eq!(tree.menus, legacy.menus);
    assert_eq!(tree.parent_menu, legacy.parent_menu);
}

/// The AppKit observers cannot run under libtest (no `AppHandle`), so their
/// bodies are pinned by source: each delegates the checked tree, and the
/// top-level failures are named.
#[test]
fn d319_f3_observers_delegate_the_checked_tree() {
    let adapter = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/services/window_focus.rs"
    ));
    let mapping = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/services/window_focus_mapping.rs"
    ));
    let body = |name: &str| {
        let start = adapter
            .find(&format!("extern \"C-unwind\" fn {name}("))
            .unwrap_or_else(|| panic!("no extern {name}"));
        let rest = &adapter[start..];
        &rest[..rest.find("\n    }\n").expect("end of extern")]
    };
    assert!(body("begin").contains("on_begin(&focus, note, installed_items(app))"));
    assert!(body("will_send").contains("on_will_send(&focus, note, installed_items(app))"));
    for name in ["begin", "will_send"] {
        assert!(!body(name).contains("let Some(tree) = installed_items"));
        assert!(!body(name).contains("let Some(items) = installed_items"));
    }
    let installed = &mapping[mapping
        .find("fn installed_items(")
        .expect("installed_items")..];
    let installed = &installed[..installed.find("\n}\n").expect("end")];
    for kind in [
        "no_main_thread",
        "no_main_menu",
        "no_app_menu",
        "items_unreadable",
    ] {
        assert!(installed.contains(kind), "installed_items must name {kind}");
    }
}

#[test]
fn d319_f3_unmappable_tree_is_logged_at_begin_and_send() {
    let marker = unsafe { MainThreadMarker::new_unchecked() };
    let native = NSMenu::new(marker);
    let save = native_item("Save", custom());
    let file = append_submenu(&native, "File", &[&save]);
    let mut tree = NativeTree::default();
    assert!(map_items(
        &native,
        vec![expected(
            "menu.file",
            Some("File"),
            false,
            Some(vec![expected("menu.file.save", Some("Save"), true, None)]),
        )],
        &mut tree,
        None,
    )
    .is_some());
    let miss = || {
        Err(MapMiss {
            kind: "title",
            depth: 1,
            index: 3,
        })
    };

    let focus = MenuFocus::default();
    focus.apply("A", true);
    // A mapped Begin and a queued selection, then an unmappable tree.
    on_begin(&focus, Some(&tracking_note(&native)), Ok(tree.clone()));
    on_will_send(&focus, Some(&send_note(&file, &save)), Ok(tree.clone()));
    assert!(focus.capture_matches("menu.file.save"));

    let ((), begin_lines) =
        test_sink::record(|| on_begin(&focus, Some(&tracking_note(&native)), miss()));
    assert_eq!(begin_lines.len(), 1);
    let begin = &begin_lines[0]["context"];
    assert_eq!(begin["step"], "begin");
    assert_eq!(begin["mapped"], false);
    assert_eq!(begin["reason"], "no_tree");
    assert_eq!(begin["miss"], "title");
    assert_eq!(begin["depth"], 1);
    assert_eq!(begin["index"], 3);

    let ((), send_lines) =
        test_sink::record(|| on_will_send(&focus, Some(&send_note(&file, &save)), miss()));
    let discard: Vec<_> = send_lines
        .iter()
        .filter(|line| line["context"]["step"] == "discard")
        .collect();
    assert_eq!(discard.len(), 1);
    assert_eq!(discard[0]["status"], "cancel");
    assert_eq!(discard[0]["context"]["reason"], "no_tree");
    assert_eq!(discard[0]["context"]["miss"], "title");
    assert!(!focus.capture_matches("menu.file.save"));
    for line in begin_lines.iter().chain(&send_lines) {
        assert!(!line.to_string().contains("Save") && !line.to_string().contains("File"));
    }
}

/// A session can outlive the installed menu it mapped (the ended session
/// survives a rebuild), so the tree must keep its AppKit objects alive:
/// otherwise a later object can reuse an address it names.
#[test]
fn d319_f3_mapped_tree_keeps_its_native_objects_alive() {
    let marker = unsafe { MainThreadMarker::new_unchecked() };
    let native = NSMenu::new(marker);
    let save = native_item("Save", custom());
    append_submenu(&native, "File", &[&save]);
    native.addItem(&native_item("Dictation", None));
    let mut tree = NativeTree::default();
    map_items_checked(
        &native,
        vec![expected(
            "menu.file",
            Some("File"),
            false,
            Some(vec![expected("menu.file.save", Some("Save"), true, None)]),
        )],
        &mut tree,
        None,
        0,
    )
    .expect("maps");
    let kept: std::collections::HashSet<usize> = tree
        .keep_alive
        .iter()
        .map(|object| Retained::as_ptr(&object.0) as usize)
        .collect();
    assert_eq!(tree.menus.len(), 2);
    assert_eq!(tree.items.len(), 2);
    for address in tree.menus.iter().chain(tree.items.keys()) {
        assert!(kept.contains(address), "unretained mapped object");
    }
    assert_eq!(kept.len(), tree.menus.len() + tree.items.len());
}
