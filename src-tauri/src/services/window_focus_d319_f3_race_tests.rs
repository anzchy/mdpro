// D319-F3 WI-1: the B8 device order. AppKit ends menu tracking before ⌘`
// can switch windows, the switch rebuilds the menu, and only then does the
// selected M1 item post WillSend. Included into `d319_native_item_regressions`.

use crate::menu::menu_target::capture_log::test_sink;

const SAVE: (&str, &str) = ("menu.file.save", "file.save");
const HIGHLIGHT: (&str, &str) = ("menu.format.highlight", "format.highlight");

fn menu_with(id: &str) -> (Retained<NSMenu>, Retained<NSMenuItem>, NativeTree) {
    let marker = unsafe { MainThreadMarker::new_unchecked() };
    let menu = NSMenu::new(marker);
    let selected = item(Some(sel!(customAction:)));
    menu.addItem(&selected);
    let mut tree = NativeTree::default();
    tree.menus.insert(Retained::as_ptr(&menu) as usize);
    tree.items
        .insert(Retained::as_ptr(&selected) as usize, id.to_string());
    (menu, selected, tree)
}

fn route_as(
    focus: &MenuFocus,
    (id, action): (&str, &str),
    live: &[&str],
) -> (Vec<String>, Vec<serde_json::Value>) {
    let live: Vec<String> = live.iter().map(|label| label.to_string()).collect();
    let mut emitted = Vec::new();
    let mut logs = Vec::new();
    focus.route_for_event(
        id,
        action,
        None,
        &live,
        |label, _: &MenuActionPayload| {
            emitted.push(label.to_string());
            Ok::<(), ()>(())
        },
        |entry| logs.push(serde_json::to_value(entry).unwrap()),
    );
    (emitted, logs)
}

/// The `menu.capture` contexts, in order.
fn capture_steps(lines: &[serde_json::Value]) -> Vec<serde_json::Value> {
    lines
        .iter()
        .inspect(|line| assert_eq!(line["event"], "menu.capture"))
        .map(|line| line["context"].clone())
        .collect()
}

fn step<'a>(steps: &'a [serde_json::Value], name: &str) -> Vec<&'a serde_json::Value> {
    steps.iter().filter(|s| s["step"] == name).collect()
}

fn assert_dispatch(emitted: &[String], logs: &[serde_json::Value], target: &str, via: &str) {
    assert_eq!(emitted, [target]);
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["event"], "menu.action.dispatch");
    assert_eq!(logs[0]["context"]["target"], target);
    assert_eq!(logs[0]["context"]["via"], via);
    assert!(logs[0]["context"].get("value").is_none());
}

const ALLOWED_KEYS: [&str; 12] = [
    "step",
    "mapped",
    "restart",
    "generation",
    "sessionGeneration",
    "item",
    "source",
    "ownerIsFocused",
    "sessionEnded",
    "kept",
    "reason",
    "capture",
];

fn assert_content_free(lines: &[serde_json::Value]) {
    for line in lines {
        let context = line["context"].as_object().expect("context object");
        for key in context.keys() {
            assert!(
                ALLOWED_KEYS.contains(&key.as_str()) || key == "decision",
                "unexpected key {key}"
            );
        }
        let text = line.to_string();
        assert!(!text.contains("menu.file") && !text.contains("menu.format"));
        assert!(!text.contains("Action") && !text.contains('/'));
        assert!(line.get("error").is_none_or(|e| e.is_null()));
    }
}

/// Begin M1 with A focused, End M1, A blurs, B focuses, the menu is rebuilt
/// `rebuilds` times, then M1's item posts WillSend against the newest tree.
fn b8_race(ids: (&str, &str), rebuilds: usize) -> (MenuFocus, Vec<serde_json::Value>) {
    let (m1, selected, old_tree) = menu_with(ids.0);
    let rebuilt: Vec<_> = (0..rebuilds).map(|_| menu_with(ids.0)).collect();
    let focus = MenuFocus::default();
    focus.apply("A", true);
    let ((), lines) = test_sink::record(|| {
        focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
        focus.native_end_notification(Some(&tracking_note(&m1, false)));
        focus.apply("A", false);
        focus.apply("B", true);
        let current = &rebuilt.last().expect("at least one rebuild").2;
        focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), current);
    });
    // menu.rs's availability guard reads the same capture the router takes.
    assert_eq!(
        focus.peek_capture(),
        Some((Some("A".to_string()), Some("A".to_string())))
    );
    assert!(focus.capture_matches(ids.0));
    assert!(!focus.capture_matches("menu.edit.copy"));
    (focus, lines)
}

#[test]
fn d319_f3_b8_order_routes_to_click_owner_once() {
    for ids in [HIGHLIGHT, SAVE] {
        for rebuilds in [1, 2] {
            let (focus, race_lines) = b8_race(ids, rebuilds);
            let ((emitted, logs), route_lines) =
                test_sink::record(|| route_as(&focus, ids, &["A", "B"]));
            assert_dispatch(&emitted, &logs, "A", "click_time");
            let ((again, again_logs), again_lines) =
                test_sink::record(|| route_as(&focus, ids, &["A", "B"]));
            assert_dispatch(&again, &again_logs, "B", "focused");

            let steps = capture_steps(&race_lines);
            let names: Vec<&str> = steps.iter().map(|s| s["step"].as_str().unwrap()).collect();
            assert_eq!(names, ["begin", "end", "will_send", "store"], "{ids:?} {rebuilds}");
            assert_eq!(steps[0]["mapped"], true);
            assert_eq!(steps[0]["restart"], true);
            assert_eq!(steps[1]["sessionEnded"], true);
            assert_eq!(steps[1]["kept"], true);
            assert_eq!(steps[2]["item"], "ended");
            // Generations count the distinct installed trees MenuFocus has seen.
            assert_eq!(steps[0]["generation"], 1);
            assert_eq!(steps[2]["sessionGeneration"], 1);
            assert_eq!(steps[2]["generation"], 2);
            assert_eq!(steps[3]["source"], "ended");
            assert_eq!(steps[3]["ownerIsFocused"], false);

            let route = capture_steps(&route_lines);
            assert_eq!(route.len(), 1);
            assert_eq!(route[0]["step"], "route");
            assert_eq!(route[0]["capture"], "consumed");
            assert_eq!(route[0]["decision"], "click_time");
            let again = capture_steps(&again_lines);
            assert_eq!(again.len(), 1);
            assert_eq!(again[0]["capture"], "none");
            assert_eq!(again[0]["decision"], "arrival");
            assert_content_free(&race_lines);
            assert_content_free(&route_lines);
        }
    }
}

#[test]
fn d319_f3_end_before_send_without_rebuild_uses_unchanged_focus() {
    let (m1, selected, tree) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    let ((), lines) = test_sink::record(|| {
        focus.native_begin_notification(Some(&tracking_note(&m1, true)), &tree);
        focus.native_end_notification(Some(&tracking_note(&m1, false)));
        focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), &tree);
    });
    let ((emitted, logs), route_lines) = test_sink::record(|| route_as(&focus, SAVE, &["A", "B"]));
    assert_dispatch(&emitted, &logs, "A", "focused");
    let steps = capture_steps(&lines);
    let send = step(&steps, "will_send");
    assert_eq!(send.len(), 1);
    assert_eq!(send[0]["item"], "current");
    assert_eq!(send[0]["generation"], 1);
    assert_eq!(send[0]["sessionGeneration"], 1);
    assert_eq!(step(&steps, "store")[0]["ownerIsFocused"], true);
    let route = capture_steps(&route_lines);
    assert_eq!(route[0]["capture"], "consumed");
    assert_eq!(route[0]["decision"], "arrival");
}

#[test]
fn d319_f3_send_before_end_after_rebuild_keeps_active_owner() {
    let (m1, selected, old_tree) = menu_with(SAVE.0);
    let (_m2, _, new_tree) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    let ((), lines) = test_sink::record(|| {
        focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
        focus.apply("B", true);
        focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), &new_tree);
        focus.native_end_notification(Some(&tracking_note(&m1, false)));
    });
    let (emitted, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "A", "click_time");
    let steps = capture_steps(&lines);
    assert_eq!(step(&steps, "will_send")[0]["item"], "active");
    assert_eq!(step(&steps, "store")[0]["source"], "active");
    let end = step(&steps, "end");
    assert_eq!(end.len(), 1);
    assert_eq!(end[0]["sessionEnded"], true);
    assert_eq!(end[0]["kept"], false);
}

#[test]
fn d319_f3_current_shortcut_expires_ended_session() {
    let (m1, old_item, old_tree) = menu_with(SAVE.0);
    let (m2, new_item, new_tree) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
    focus.native_end_notification(Some(&tracking_note(&m1, false)));
    focus.apply("B", true);
    let ((), lines) = test_sink::record(|| {
        focus.native_will_send_notification(Some(&native_send_note(&m2, &new_item)), &new_tree);
    });
    let (emitted, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "B", "focused");
    let steps = capture_steps(&lines);
    assert_eq!(step(&steps, "will_send")[0]["item"], "current");
    let discards = step(&steps, "discard");
    assert_eq!(discards.len(), 1);
    assert_eq!(discards[0]["reason"], "superseded");
    let discard_line = lines.iter().find(|l| l["context"]["step"] == "discard");
    assert_eq!(discard_line.unwrap()["status"], "cancel");

    let ((), detached) = test_sink::record(|| {
        focus.native_will_send_notification(Some(&native_send_note(&m1, &old_item)), &new_tree);
    });
    let (later, later_logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&later, &later_logs, "B", "focused");
    let steps = capture_steps(&detached);
    assert_eq!(step(&steps, "will_send")[0]["item"], "unmapped");
    assert_eq!(step(&steps, "discard")[0]["reason"], "unmapped");
    assert!(step(&steps, "store").is_empty());
}

#[test]
fn d319_f3_ended_tree_item_after_consumption_does_not_transfer() {
    let (m1, selected, old_tree) = menu_with(SAVE.0);
    let (_m2, _, new_tree) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
    focus.native_end_notification(Some(&tracking_note(&m1, false)));
    focus.apply("B", true);
    focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), &new_tree);
    let (first, _) = route_as(&focus, SAVE, &["A", "B"]);
    assert_eq!(first, ["A"]);
    let ((), lines) = test_sink::record(|| {
        focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), &new_tree);
    });
    let (second, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&second, &logs, "B", "focused");
    let steps = capture_steps(&lines);
    assert_eq!(step(&steps, "will_send")[0]["item"], "unmapped");
    assert_eq!(step(&steps, "discard")[0]["reason"], "unmapped");
}

#[test]
fn d319_f3_selected_session_never_becomes_ended() {
    let (m1, selected, old_tree) = menu_with(SAVE.0);
    let (_m2, _, new_tree) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
    focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), &old_tree);
    let (first, _) = route_as(&focus, SAVE, &["A", "B"]);
    assert_eq!(first, ["A"]);
    let ((), lines) = test_sink::record(|| {
        focus.native_end_notification(Some(&tracking_note(&m1, false)));
    });
    focus.apply("B", true);
    focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), &new_tree);
    let (second, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&second, &logs, "B", "focused");
    let steps = capture_steps(&lines);
    assert_eq!(steps.len(), 1);
    assert_eq!(steps[0]["step"], "end");
    assert_eq!(steps[0]["kept"], false);
}

#[test]
fn d319_f3_nested_menus_end_before_send_keep_owner() {
    let (parent, _, mut tree) = menu_with("menu.file.open");
    let (child, selected, child_tree) = menu_with(SAVE.0);
    tree.menus.extend(child_tree.menus);
    tree.items.extend(child_tree.items);
    tree.parent_menu.insert(
        Retained::as_ptr(&child) as usize,
        Retained::as_ptr(&parent) as usize,
    );
    let (_m2, _, new_tree) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&parent, true)), &tree);
    focus.native_begin_notification(Some(&tracking_note(&child, true)), &tree);
    let ((), ends) = test_sink::record(|| {
        focus.native_end_notification(Some(&tracking_note(&child, false)));
        focus.native_end_notification(Some(&tracking_note(&parent, false)));
    });
    focus.apply("B", true);
    focus.native_will_send_notification(Some(&native_send_note(&child, &selected)), &new_tree);
    let (emitted, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "A", "click_time");
    let steps = capture_steps(&ends);
    assert_eq!(steps.len(), 2);
    assert_eq!(steps[0]["sessionEnded"], false);
    assert_eq!(steps[1]["sessionEnded"], true);
    assert_eq!(steps[1]["kept"], true);
}

#[test]
fn d319_f3_closed_owner_cancels_window_action() {
    let (focus, _) = b8_race(SAVE, 1);
    focus.forget("A");
    let ((emitted, logs), lines) = test_sink::record(|| route_as(&focus, SAVE, &["B"]));
    assert!(emitted.is_empty());
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["status"], "cancel");
    assert_eq!(logs[0]["error"], "no_focused_window");
    let route = capture_steps(&lines);
    assert_eq!(route[0]["capture"], "consumed");
    assert_eq!(route[0]["decision"], "owner_closed");
}

#[test]
fn d319_f3_end_after_switch_keeps_begin_owner() {
    let (m1, selected, old_tree) = menu_with(SAVE.0);
    let (_m2, _, _) = menu_with(SAVE.0);
    let (_m3, _, current) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    let ((), lines) = test_sink::record(|| {
        focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
        focus.apply("A", false);
        focus.apply("B", true);
        focus.native_end_notification(Some(&tracking_note(&m1, false)));
        focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), &current);
    });
    let (emitted, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "A", "click_time");
    let steps = capture_steps(&lines);
    let end = step(&steps, "end");
    assert_eq!(end[0]["sessionEnded"], true);
    assert_eq!(end[0]["kept"], true);
    assert_eq!(step(&steps, "will_send")[0]["item"], "ended");
}

#[test]
fn d319_f3_ended_item_from_another_menu_is_unmapped() {
    let (m1, selected, old_tree) = menu_with(SAVE.0);
    let (_m2, _, current) = menu_with(SAVE.0);
    let foreign = NSMenu::new(unsafe { MainThreadMarker::new_unchecked() });
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &old_tree);
    focus.native_end_notification(Some(&tracking_note(&m1, false)));
    focus.apply("B", true);
    let ((), lines) = test_sink::record(|| {
        focus.native_will_send_notification(Some(&native_send_note(&foreign, &selected)), &current);
    });
    let (emitted, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "B", "focused");
    let steps = capture_steps(&lines);
    assert_eq!(step(&steps, "will_send")[0]["item"], "unmapped");
    assert_eq!(step(&steps, "discard")[0]["reason"], "unmapped");
}

/// Gap 7, pinned pending a ruling: with no rebuild after the switch, the M1
/// item is current, which a key equivalent in B also is. Arrival focus wins.
#[test]
fn d319_f3_switch_without_rebuild_uses_arrival_focus() {
    let (m1, selected, tree) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &tree);
    focus.native_end_notification(Some(&tracking_note(&m1, false)));
    focus.apply("B", true);
    let ((), lines) = test_sink::record(|| {
        focus.native_will_send_notification(Some(&native_send_note(&m1, &selected)), &tree);
    });
    let (emitted, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&emitted, &logs, "B", "focused");
    let steps = capture_steps(&lines);
    assert_eq!(step(&steps, "will_send")[0]["item"], "current");
    assert_eq!(step(&steps, "discard")[0]["reason"], "superseded");
}

#[test]
fn d319_f3_generation_counts_distinct_trees_across_races() {
    let (m1, m1_item, t1) = menu_with(SAVE.0);
    let (m2, m2_item, t2) = menu_with(SAVE.0);
    let (_m3, _, t3) = menu_with(SAVE.0);
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.native_begin_notification(Some(&tracking_note(&m1, true)), &t1);
    focus.native_end_notification(Some(&tracking_note(&m1, false)));
    focus.apply("B", true);
    focus.native_will_send_notification(Some(&native_send_note(&m1, &m1_item)), &t2);
    let (first, _) = route_as(&focus, SAVE, &["A", "B"]);
    assert_eq!(first, ["A"]);
    let ((), lines) = test_sink::record(|| {
        focus.native_begin_notification(Some(&tracking_note(&m2, true)), &t2);
        focus.native_end_notification(Some(&tracking_note(&m2, false)));
        focus.apply("A", true);
        focus.native_will_send_notification(Some(&native_send_note(&m2, &m2_item)), &t3);
    });
    let (second, logs) = route_as(&focus, SAVE, &["A", "B"]);
    assert_dispatch(&second, &logs, "B", "click_time");
    let steps = capture_steps(&lines);
    assert_eq!(step(&steps, "begin")[0]["generation"], 2);
    let send = step(&steps, "will_send");
    assert_eq!(send[0]["item"], "ended");
    assert_eq!(send[0]["generation"], 3);
    assert_eq!(send[0]["sessionGeneration"], 2);
}
