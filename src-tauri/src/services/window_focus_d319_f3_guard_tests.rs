// D319-F3 WI-2: nothing but the selected click rides on the capture. A
// cancelled menu, an expired capture and a different id route by arrival
// focus, and each loss names its reason. Included into
// `d319_native_item_regressions`, after the WI-1 race helpers.

/// A pending ended-path capture of `ids` for A, with B focused and M2 current.
struct Captured {
    focus: MenuFocus,
    m2: Retained<NSMenu>,
    m2_item: Retained<NSMenuItem>,
    m2_tree: NativeTree,
    _m1: (Retained<NSMenu>, Retained<NSMenuItem>),
}

fn captured_for_a(ids: (&str, &str)) -> Captured {
    let (m1, selected, old_tree) = menu_with(ids.0);
    let (m2, m2_item, m2_tree) = menu_with(ids.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
    focus.native_end_notification(Some(&tracking_note(&m1, false)));
    focus.apply("B", true);
    focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), &m2_tree);
    Captured {
        focus,
        m2,
        m2_item,
        m2_tree,
        _m1: (m1, selected),
    }
}

fn discard_reasons(lines: &[serde_json::Value]) -> Vec<String> {
    lines
        .iter()
        .filter(|line| line["context"]["step"] == "discard")
        .inspect(|line| assert_eq!(line["status"], "cancel"))
        .map(|line| line["context"]["reason"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn d319_f3_cancelled_menu_then_event_uses_arrival_focus() {
    let (m1, _, tree) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &tree);
    focus.native_end_notification(Some(&tracking_note(&m1, false)));
    focus.apply("B", true);
    let ((emitted, logs), lines) = test_sink::record(|| route_as(&focus, SAVE, &["A", "B"]));
    assert_dispatch(&emitted, &logs, "B", "focused");
    let steps = capture_steps(&lines);
    assert_eq!(steps.len(), 1);
    assert_eq!(steps[0]["capture"], "none");
    assert_eq!(steps[0]["decision"], "arrival");
}

#[test]
fn d319_f3_cancelled_menu_then_new_menu_in_b_expires_owner() {
    let (m1, _, old_tree) = menu_with(SAVE.0);
    let (m2, m2_item, new_tree) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
    focus.native_end_notification(Some(&tracking_note(&m1, false)));
    focus.apply("B", true);
    let ((), lines) = test_sink::record(|| {
        focus.native_begin_notification(Some(&tracking_note(&m2, true)), &new_tree);
        focus.native_will_send_notification(Some(&native_send_note(&m2, &m2_item)), &new_tree);
        focus.native_end_notification(Some(&tracking_note(&m2, false)));
    });
    let (emitted, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "B", "focused");
    assert_eq!(discard_reasons(&lines), ["expired"]);
    let steps = capture_steps(&lines);
    assert_eq!(step(&steps, "begin")[0]["restart"], true);
    assert_eq!(step(&steps, "will_send")[0]["item"], "current");
}

#[test]
fn d319_f3_unconsumed_capture_expires_at_next_begin() {
    let c = captured_for_a(SAVE);
    let ((), lines) = test_sink::record(|| {
        c.focus
            .native_begin_notification(Some(&tracking_note(&c.m2, true)), &c.m2_tree);
        c.focus.native_will_send_notification(
            Some(&native_send_note(&c.m2, &c.m2_item)),
            &c.m2_tree,
        );
        c.focus
            .native_end_notification(Some(&tracking_note(&c.m2, false)));
    });
    let (emitted, logs) = route_as(&c.focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "B", "focused");
    assert_eq!(discard_reasons(&lines), ["expired"]);
}

#[test]
fn d319_f3_different_id_does_not_take_capture() {
    let c = captured_for_a(SAVE);
    let ((emitted, logs), lines) =
        test_sink::record(|| route_as(&c.focus, HIGHLIGHT, &["A", "B"]));
    assert_dispatch(&emitted, &logs, "B", "focused");
    let steps = capture_steps(&lines);
    assert_eq!(steps[0]["capture"], "id_mismatch");
    assert_eq!(steps[0]["decision"], "arrival");
    let ((later, later_logs), later_lines) =
        test_sink::record(|| route_as(&c.focus, SAVE, &["A", "B"]));
    assert_dispatch(&later, &later_logs, "B", "focused");
    assert_eq!(capture_steps(&later_lines)[0]["capture"], "none");
}

#[test]
fn d319_f3_foreign_or_missing_item_discards_with_reason() {
    for missing_info in [false, true] {
        let (m1, _, tree) = menu_with(SAVE.0);
        let (_m2, _, new_tree) = menu_with(SAVE.0);
        let foreign = item(Some(sel!(customAction:)));
        let focus = MenuFocus::default();
        focus.apply("A", true);
        focus.native_begin_notification(Some(&tracking_note(&m1, true)), &tree);
        focus.native_end_notification(Some(&tracking_note(&m1, false)));
        focus.apply("B", true);
        let send = if missing_info {
            tracking_note(&m1, true)
        } else {
            native_send_note(&m1, &foreign)
        };
        let ((), lines) =
            test_sink::record(|| focus.native_will_send_notification(Some(&send), &new_tree));
        let (emitted, logs) = route_as(&focus, SAVE, &["A", "B"]);
        assert_dispatch(&emitted, &logs, "B", "focused");
        let expected = if missing_info { "no_item" } else { "unmapped" };
        assert_eq!(discard_reasons(&lines), [expected]);
    }
}

#[test]
fn d319_f3_rust_only_discard_names_not_routed() {
    let c = captured_for_a(SAVE);
    let ((), lines) = test_sink::record(|| c.focus.discard_capture());
    assert_eq!(discard_reasons(&lines), ["not_routed"]);
    let (emitted, logs) = route_as(&c.focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "B", "focused");
    // Nothing pending: a second discard has nothing to report.
    let ((), quiet) = test_sink::record(|| c.focus.discard_capture());
    assert!(quiet.is_empty());
}

#[test]
fn d319_f3_foreign_begin_is_logged_and_keeps_the_race_owner() {
    let (m1, selected, tree) = menu_with(SAVE.0);
    let (_m2, _, new_tree) = menu_with(SAVE.0);
    let foreign = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &tree);
    focus.native_end_notification(Some(&tracking_note(&m1, false)));
    let ((), lines) = test_sink::record(|| {
        focus.native_begin_notification(Some(&tracking_note(&foreign, true)), &tree);
    });
    focus.apply("B", true);
    focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), &new_tree);
    let (emitted, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "A", "click_time");
    let steps = capture_steps(&lines);
    assert_eq!(steps.len(), 1);
    assert_eq!(steps[0]["step"], "begin");
    assert_eq!(steps[0]["mapped"], false);
}

#[test]
fn d319_f3_missing_installed_tree_is_logged_and_drops_capture() {
    let c = captured_for_a(SAVE);
    let ((), begin_lines) = test_sink::record(|| c.focus.native_tree_unavailable(false));
    let steps = capture_steps(&begin_lines);
    assert_eq!(steps.len(), 1);
    assert_eq!(steps[0]["step"], "begin");
    assert_eq!(steps[0]["mapped"], false);
    assert_eq!(steps[0]["reason"], "no_tree");
    let ((), send_lines) = test_sink::record(|| c.focus.native_tree_unavailable(true));
    assert_eq!(discard_reasons(&send_lines), ["no_tree"]);
    let (emitted, logs) = route_as(&c.focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "B", "focused");
}

#[test]
fn d319_f3_legacy_route_logs_one_decision() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    focus.apply("B", true);
    let ((emitted, logs), lines) = test_sink::record(|| routed(&focus));
    assert_dispatch(&emitted, &logs, "A", "click_time");
    let steps = capture_steps(&lines);
    let route: Vec<_> = step(&steps, "route");
    assert_eq!(route.len(), 1);
    assert_eq!(route[0]["capture"], "consumed");
    assert_eq!(route[0]["decision"], "click_time");
    assert_content_free(&lines);
}

#[test]
fn d319_f3_active_session_on_replaced_tree_logs_tree_replaced() {
    let (m1, _, old_tree) = menu_with(SAVE.0);
    let (m2, m2_item, new_tree) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
    focus.apply("B", true);
    let ((), lines) = test_sink::record(|| {
        focus.native_will_send_notification(Some(&native_send_note(&m2, &m2_item)), &new_tree);
    });
    let (emitted, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "B", "focused");
    assert_eq!(discard_reasons(&lines), ["tree_replaced"]);
    let steps = capture_steps(&lines);
    assert_eq!(step(&steps, "will_send")[0]["item"], "current");
}

#[test]
fn d319_f3_second_send_in_one_session_logs_already_selected() {
    let (m1, save, mut tree) = menu_with(SAVE.0);
    let highlight = item(Some(sel!(customAction:)));
    m1.addItem(&highlight);
    tree.items
        .insert(Retained::as_ptr(&highlight) as usize, HIGHLIGHT.0.into());
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &tree);
    focus.native_will_send_notification(Some(&native_send_note(&m1, &save)), &tree);
    focus.apply("B", true);
    let ((), lines) = test_sink::record(|| {
        focus.native_will_send_notification(Some(&native_send_note(&m1, &highlight)), &tree);
    });
    focus.native_end_notification(Some(&tracking_note(&m1, false)));
    assert_eq!(discard_reasons(&lines), ["already_selected"]);
    let (emitted, logs) = route_as(&focus, HIGHLIGHT, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "B", "focused");
}

/// Outside `test_sink::record`, a capture line reaches the real log file.
#[test]
fn d319_f3_capture_lines_reach_the_log_file() {
    use crate::models::{LogLevel, LogSettings};
    use crate::services::{logger, window_restore::test_home::TestHome};
    let home = TestHome::new("d319_f3_capture_log_file");
    let old = logger::get_log_settings();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    let c = captured_for_a(SAVE);
    let _ = route_as(&c.focus, SAVE, &["A", "B"]);
    logger::set_log_settings(old);
    let log = std::fs::read_to_string(home.dir.join(".mdpro/mdpro.log")).unwrap_or_default();
    let steps: Vec<serde_json::Value> = log
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|line| line["event"] == "menu.capture")
        .collect();
    assert!(steps.iter().any(|l| l["context"]["step"] == "store"
        && l["context"]["source"] == "ended"));
    assert!(steps.iter().any(|l| l["context"]["step"] == "route"
        && l["context"]["decision"] == "click_time"));
}
