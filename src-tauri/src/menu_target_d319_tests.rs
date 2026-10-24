use crate::menu::menu_target::{route, DispatchOutcome, MenuActionPayload, MenuFocus};
use crate::models::LogEntryPayload;
use serde_json::{to_value, Value};
use std::cell::RefCell;

// These fallbacks make the pre-implementation RED an assertion failure. Once
// the inherent capture methods exist, Rust resolves these calls to them.
#[allow(dead_code)]
trait RedCaptureSeam {
    fn begin_tracking(&self);
    fn end_tracking(&self);
    fn will_send_action(&self, custom: bool);
    fn discard_capture(&self);
}

impl RedCaptureSeam for MenuFocus {
    fn begin_tracking(&self) {}
    fn end_tracking(&self) {}
    fn will_send_action(&self, _custom: bool) {}
    fn discard_capture(&self) {}
}

// RED compatibility for id-aware event routing. Inherent methods take
// precedence once the production implementation exists.
#[allow(dead_code)]
trait RedIdRouting {
    fn will_send_action_id(&self, _id: &str);
    fn route_for_event<E, F, L>(
        &self, _id: &str, action: &str, value: Option<String>, live: &[String], emit: F, log: L,
    ) -> DispatchOutcome
    where F: FnOnce(&str, &MenuActionPayload) -> Result<(), E>, L: FnOnce(LogEntryPayload);
}

impl RedIdRouting for MenuFocus {
    fn will_send_action_id(&self, _id: &str) { self.will_send_action(true); }
    fn route_for_event<E, F, L>(
        &self, _id: &str, action: &str, value: Option<String>, live: &[String], emit: F, log: L,
    ) -> DispatchOutcome
    where F: FnOnce(&str, &MenuActionPayload) -> Result<(), E>, L: FnOnce(LogEntryPayload) {
        route(action, value, self, live, emit, log)
    }
}

type Emission = (String, MenuActionPayload);

fn send(
    focus: &MenuFocus,
    action: &str,
    value: Option<&str>,
    live: &[&str],
    fail: bool,
) -> (DispatchOutcome, Vec<Emission>, Vec<Value>) {
    let emitted = RefCell::new(Vec::new());
    let logs = RefCell::new(Vec::new());
    let labels = live.iter().map(|label| (*label).to_string()).collect::<Vec<_>>();
    let outcome = route(
        action,
        value.map(str::to_string),
        focus,
        &labels,
        |label, payload| {
            emitted.borrow_mut().push((label.to_string(), payload.clone()));
            if fail { Err("/private/emitter/path") } else { Ok(()) }
        },
        |entry: LogEntryPayload| logs.borrow_mut().push(to_value(entry).unwrap()),
    );
    (outcome, emitted.into_inner(), logs.into_inner())
}

fn send_id(
    focus: &MenuFocus, id: &str, action: &str, live: &[&str],
) -> (DispatchOutcome, Vec<Emission>, Vec<Value>) {
    let emitted = RefCell::new(Vec::new());
    let logs = RefCell::new(Vec::new());
    let labels = live.iter().map(|label| (*label).to_string()).collect::<Vec<_>>();
    let outcome = focus.route_for_event(
        id, action, None, &labels,
        |label, payload| { emitted.borrow_mut().push((label.to_string(), payload.clone())); Ok::<(), ()>(()) },
        |entry| logs.borrow_mut().push(to_value(entry).unwrap()),
    );
    (outcome, emitted.into_inner(), logs.into_inner())
}

fn assert_target(emitted: &[Emission], logs: &[Value], target: &str, via: &str) {
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].0, target);
    assert_eq!(emitted[0].1.target, target);
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["context"]["target"], target);
    assert_eq!(logs[0]["context"]["via"], via);
}

#[test]
fn d319_captures_tracking_owner_before_delayed_native_send() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.apply("B", true); // AppKit's delayed action arrives after focus moved.
    focus.will_send_action(true);
    focus.end_tracking();
    let (_, emitted, logs) = send(&focus, "format.highlight", None, &["A", "B"], false);
    assert_target(&emitted, &logs, "A", "click_time");
    assert_eq!(logs[0]["event"], "menu.action.dispatch");
    assert!(logs[0]["context"].get("value").is_none());
}

#[test]
fn d319_focus_switched_before_tracking_uses_new_window() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.apply("B", true);
    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    let (_, emitted, logs) = send(&focus, "format.highlight", None, &["A", "B"], false);
    assert_target(&emitted, &logs, "B", "focused");
}

#[test]
fn d319_no_focus_window_click_cancels_and_app_click_falls_back() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.apply("A", false);
    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    let (_, emitted, logs) = send(&focus, "file.save", None, &["A", "B"], false);
    assert!(emitted.is_empty());
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["error"], "no_focused_window");

    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    let (_, emitted, logs) = send(&focus, "file.new", None, &["A", "B"], false);
    assert_target(&emitted, &logs, "A", "last_focused");

    focus.forget("A");
    for live in [["C", "B"], ["B", "C"]] {
        focus.begin_tracking();
        focus.will_send_action(true);
        focus.end_tracking();
        let (_, emitted, logs) = send(&focus, "file.new", None, &live, false);
        assert_target(&emitted, &logs, "B", "any_live");
    }
}

#[test]
fn d319_destroyed_owner_never_receives_or_redirects_window_action() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    focus.forget("A");
    focus.apply("B", true);
    let (_, emitted, logs) = send(&focus, "file.save", None, &["B"], false);
    assert!(emitted.is_empty());
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["error"], "no_focused_window");
}

#[test]
fn d319_cancelled_tracking_does_not_poison_shortcut() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.end_tracking();
    focus.apply("B", true);
    focus.will_send_action(true);
    let (_, emitted, logs) = send(&focus, "file.save", None, &["A", "B"], false);
    assert_target(&emitted, &logs, "B", "focused");
}

#[test]
fn d319_f1_old_selection_expires_at_next_begin_and_ids_do_not_pair_fifo() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action_id("menu.file.open");
    focus.end_tracking();
    focus.apply("B", true);
    focus.begin_tracking();
    focus.will_send_action_id("menu.file.save");
    focus.end_tracking();
    let (_, first, first_logs) = send_id(&focus, "menu.file.open", "file.open", &["A", "B"]);
    let (_, second, second_logs) = send_id(&focus, "menu.file.save", "file.save", &["A", "B"]);
    assert_target(&first, &first_logs, "B", "focused");
    assert_target(&second, &second_logs, "B", "focused");
}

#[test]
fn d319_f1_unrelated_custom_selection_cannot_redirect_later_save() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action_id("menu.edit.copy");
    focus.end_tracking();
    focus.apply("B", true);
    let (_, emitted, logs) = send_id(&focus, "menu.file.save", "file.save", &["A", "B"]);
    assert_target(&emitted, &logs, "B", "focused");
    let (_, again, again_logs) = send_id(&focus, "menu.edit.copy", "file.save", &["A", "B"]);
    assert_target(&again, &again_logs, "B", "focused");
}

#[test]
fn d319_f1_unbalanced_begin_and_end_cannot_keep_old_owner() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action_id("menu.file.save");
    focus.apply("B", true);
    focus.begin_tracking();
    focus.will_send_action_id("menu.file.save");
    focus.end_tracking();
    focus.end_tracking();
    focus.end_tracking();
    let (_, emitted, logs) = send_id(&focus, "menu.file.save", "file.save", &["A", "B"]);
    assert_target(&emitted, &logs, "B", "focused");
}

#[test]
fn d319_f1_matching_id_is_consumed_once() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action_id("menu.file.save");
    focus.end_tracking();
    focus.apply("B", true);
    let (_, first, first_logs) = send_id(&focus, "menu.file.save", "file.save", &["A", "B"]);
    let (_, second, second_logs) = send_id(&focus, "menu.file.save", "file.save", &["A", "B"]);
    assert_target(&first, &first_logs, "A", "click_time");
    assert_target(&second, &second_logs, "B", "focused");
}

#[test]
fn d319_f1_dead_captured_owner_uses_live_app_fallback() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action_id("menu.file.new");
    focus.end_tracking();
    focus.forget("A");
    let (_, emitted, logs) = send_id(&focus, "menu.file.new", "file.new", &["C", "B"]);
    assert_target(&emitted, &logs, "B", "any_live");
}

#[test]
fn d319_f1_dead_captured_owner_uses_live_last_focused_or_cancels_window() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action_id("menu.file.new");
    focus.end_tracking();
    focus.forget("A");
    focus.apply("C", true);
    focus.apply("C", false);
    let (_, emitted, logs) = send_id(&focus, "menu.file.new", "file.new", &["B", "C"]);
    assert_target(&emitted, &logs, "C", "last_focused");

    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action_id("menu.file.save");
    focus.end_tracking();
    focus.forget("A");
    let (outcome, emitted, logs) = send_id(&focus, "menu.file.save", "file.save", &["B", "C"]);
    assert_eq!(outcome, DispatchOutcome::Cancel { reason: crate::menu::menu_target::CancelReason::NoFocusedWindow });
    assert!(emitted.is_empty());
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["error"], "no_focused_window");
}

#[test]
fn d319_f1_dead_captured_owner_with_no_live_window_cancels_app_action() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action_id("menu.file.new");
    focus.end_tracking();
    focus.forget("A");
    let (outcome, emitted, logs) = send_id(&focus, "menu.file.new", "file.new", &[]);
    assert_eq!(
        outcome,
        DispatchOutcome::Cancel {
            reason: crate::menu::menu_target::CancelReason::NoLiveWindow
        }
    );
    assert!(emitted.is_empty());
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["error"], "no_live_window");
}

#[test]
fn d319_private_value_reaches_target_but_not_dispatch_log() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    focus.apply("B", true);
    let (_, emitted, logs) = send(&focus, "file.open_recent", Some("/tmp/秘密.md"), &["A", "B"], false);
    assert_target(&emitted, &logs, "A", "click_time");
    assert_eq!(emitted[0].1.value.as_deref(), Some("/tmp/秘密.md"));
    assert!(!logs[0].to_string().contains("/tmp/秘密.md"));
    assert!(!logs[0].to_string().contains("value"));
}

#[test]
fn d319_rust_only_action_and_about_do_not_poison_next_event() {
    let with_hide = |hide: bool| {
        let focus = MenuFocus::default();
        focus.apply("A", true);
        if hide {
            focus.begin_tracking();
            focus.will_send_action(true);
            focus.end_tracking();
            crate::menu::discard_native_only_capture(&focus, "menu.app.hide");
        }
        focus.begin_tracking();
        focus.will_send_action(false); // About uses customShowAboutPanel:.
        focus.end_tracking();
        focus.apply("B", true);
        focus.begin_tracking();
        focus.will_send_action(true);
        focus.end_tracking();
        send(&focus, "file.save", None, &["A", "B"], false)
    };
    let (_, with_emit, with_logs) = with_hide(true);
    let (_, without_emit, without_logs) = with_hide(false);
    assert_eq!(with_emit, without_emit);
    assert_eq!(with_logs, without_logs);
    assert_target(&with_emit, &with_logs, "B", "focused");
    assert!(include_str!("menu.rs").contains("discard_native_only_capture(&focus, id)"));
}

#[test]
fn d319_failed_emit_keeps_click_provenance_and_redacts_paths() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    focus.apply("B", true);
    let (_, emitted, logs) = send(&focus, "file.open_recent", Some("/tmp/秘密.md"), &["A", "B"], true);
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].0, "A");
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["context"]["target"], "A");
    assert_eq!(logs[0]["context"]["via"], "click_time");
    assert_eq!(logs[0]["error"], "emit_failed");
    assert!(!logs[0].to_string().contains("/tmp/秘密.md"));
    assert!(!logs[0].to_string().contains("/private/emitter/path"));
}

#[test]
fn d319_captured_empty_focus_never_resamples_later_focus() {
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.apply("A", false);
    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    focus.apply("B", true);
    let (_, emitted, logs) = send(&focus, "file.save", None, &["A", "B"], false);
    assert!(emitted.is_empty());
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["error"], "no_focused_window");

    focus.apply("A", true);
    focus.apply("A", false);
    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    focus.apply("B", true);
    let (_, emitted, logs) = send(&focus, "file.new", None, &["A", "B"], false);
    assert_target(&emitted, &logs, "A", "click_time");
}

mod integration {
    include!("menu_target_d319_integration_tests.rs");
}
