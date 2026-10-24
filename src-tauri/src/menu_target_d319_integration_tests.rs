use super::*;

#[test]
fn d319_captured_owner_is_checked_against_its_current_mode() {
    use crate::menu::menu_availability::emit_to_window;
    use crate::menu::menu_recent_merge::RecentOp;
    use crate::menu::{MenuState, ModeReport};
    use crate::menu_layout::menu_layout;
    use crate::models::{LogLevel, LogSettings};
    use crate::services::{logger, window_restore::test_home::TestHome};
    use std::cell::Cell;

    let home = TestHome::new("d319_guarded_capture");
    let old_settings = logger::get_log_settings();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    let layout = menu_layout().unwrap();
    let modes = MenuState::default();
    let report = |mode: &str| {
        modes
            .publish_op(
                RecentOp::Refresh,
                Some(ModeReport {
                    window: "A".into(),
                    mode: mode.into(),
                    tab_count: None,
                }),
                |_, _| Ok(()),
            )
            .unwrap();
    };
    report("wysiwyg");
    let focus = MenuFocus::default();
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    focus.apply("B", true);
    let emitted = RefCell::new(Vec::<String>::new());
    let dispatch_logs = RefCell::new(Vec::<Value>::new());
    let guarded = |action: &str| {
        let availability_cancelled = Cell::new(false);
        let attempted_emit = Cell::new(false);
        let selected = focus.peek_capture().map(MenuFocus::from_snapshot);
        let guard_focus = selected.as_ref().unwrap_or(&focus);
        route(
            action,
            None,
            &focus,
            &["A".into(), "B".into()],
            |label, _| {
                let result = emit_to_window(layout, action, label, guard_focus, Some(&modes), |target| {
                    attempted_emit.set(true);
                    emitted.borrow_mut().push(target.to_string());
                    Ok(())
                });
                if result.is_err() && !attempted_emit.get() {
                    availability_cancelled.set(true);
                }
                result
            },
            |entry: LogEntryPayload| {
                if !availability_cancelled.get() {
                    dispatch_logs.borrow_mut().push(to_value(entry).unwrap());
                }
            },
        )
    };
    let first = guarded("paragraph.table");
    assert!(matches!(first, DispatchOutcome::Success { label, .. } if label == "A"));
    assert_eq!(*emitted.borrow(), vec!["A"]);
    assert_eq!(dispatch_logs.borrow().len(), 1);
    assert_eq!(dispatch_logs.borrow()[0]["context"]["target"], "A");
    assert_eq!(dispatch_logs.borrow()[0]["context"]["via"], "click_time");

    report("source");
    focus.apply("A", true);
    focus.begin_tracking();
    focus.will_send_action(true);
    focus.end_tracking();
    focus.apply("B", true);
    let second = guarded("paragraph.table");
    assert!(matches!(second, DispatchOutcome::Fail { label, .. } if label == "A"));
    assert_eq!(*emitted.borrow(), vec!["A"]);
    assert_eq!(dispatch_logs.borrow().len(), 1);
    logger::set_log_settings(old_settings);
    let log = std::fs::read_to_string(home.dir.join(".mdpro/mdpro.log")).unwrap();
    let refusals: Vec<Value> = log
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry["event"] == "ui.menu.availability"
            && entry["context"]["action"] == "paragraph.table")
        .collect();
    assert_eq!(refusals.len(), 1);
    assert_eq!(refusals[0]["status"], "cancel");
    assert_eq!(refusals[0]["context"]["reason"], "wrong_mode");

    let menu_source = include_str!("menu.rs");
    assert!(menu_source.contains("focus.peek_capture()"));
    assert!(menu_source.contains("guard_focus"));
}

#[test]
fn d319_appkit_observer_is_installed_for_native_selection() {
    use crate::services::window_focus::{on_native_menu_notice, NativeMenuNotice};

    let focus = MenuFocus::default();
    focus.apply("A", true);
    on_native_menu_notice(&focus, NativeMenuNotice::BeginTracking);
    focus.apply("B", true);
    on_native_menu_notice(
        &focus,
        NativeMenuNotice::WillSendAction { custom: true },
    );
    on_native_menu_notice(&focus, NativeMenuNotice::EndTracking);
    let (_, emitted, logs) = send(&focus, "format.highlight", None, &["A", "B"], false);
    assert_target(&emitted, &logs, "A", "click_time");

    let main_source = include_str!("main.rs");
    let bridge_source = include_str!("services/window_focus.rs");
    assert!(main_source.contains("install_menu_capture(app.handle())"));
    for notification in [
        "NSMenuDidBeginTrackingNotification",
        "NSMenuWillSendActionNotification",
        "NSMenuDidEndTrackingNotification",
    ] {
        assert!(bridge_source.contains(notification), "{notification}");
    }
    assert!(bridge_source.contains("customAction:"));
}
