//! Composes the production availability guard with D261's route and real mode/focus state.

use super::{dispatch_if_allowed, emit_to_window, ViewMode};
use crate::menu::menu_from_layout::menu_layout_for;
use crate::menu::menu_target::{route, MenuActionPayload, MenuFocus};
use crate::menu::{menu_recent_merge::RecentOp, MenuState, ModeReport};
use crate::menu_layout::menu_layout;
use crate::models::{KeyboardShortcuts, LogEntryPayload, LogLevel, LogSettings};
use crate::services::applied_shortcuts::{resolve_applied, AppliedShortcuts, AppliedSource};
use crate::services::{logger, window_restore::test_home::TestHome};
use std::cell::{Cell, RefCell};

#[test]
fn m4_wi3_guarded_route_emits_only_to_the_current_allowed_window() {
    let home = TestHome::new("m4_guarded_route");
    let old = logger::get_log_settings();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    let layout = menu_layout().unwrap();
    let focus = MenuFocus::new();
    let modes = MenuState::default();
    let report = |label: &str, mode: &str| {
        modes
            .publish_op(
                RecentOp::Refresh,
                Some(ModeReport {
                    window: label.into(),
                    mode: mode.into(),
                    tab_count: None,
                }),
                |_, _| Ok(()),
            )
            .unwrap();
    };
    report("A", "wysiwyg");
    report("B", "source");
    let live = vec!["A".to_string(), "B".to_string()];
    let emitted = RefCell::new(Vec::<(String, MenuActionPayload)>::new());
    let dispatch_logs = RefCell::new(Vec::<LogEntryPayload>::new());

    let click = |action: &str| {
        let availability_cancelled = Cell::new(false);
        let attempted_native_emit = Cell::new(false);
        let emit = |label: &str, payload: &MenuActionPayload| {
            let result = emit_to_window(layout, action, label, &focus, Some(&modes), |target| {
                attempted_native_emit.set(true);
                emitted
                    .borrow_mut()
                    .push((target.to_string(), payload.clone()));
                Ok(())
            });
            if result.is_err() && !attempted_native_emit.get() {
                availability_cancelled.set(true);
            }
            result
        };
        let log = |entry| {
            if !availability_cancelled.get() {
                dispatch_logs.borrow_mut().push(entry);
            }
        };
        route(action, None, &focus, &live, emit, log)
    };

    focus.apply("A", true);
    click("paragraph.table");
    report("A", "source");
    click("paragraph.table");
    focus.apply("B", true);
    click("editor.edit.findNext");
    report("B", "wysiwyg");
    click("editor.edit.findNext");
    focus.apply("A", true);
    report("A", "wysiwyg");
    click("paragraph.table");
    logger::set_log_settings(old);

    assert_eq!(
        *emitted.borrow(),
        [
            (
                "A".into(),
                MenuActionPayload {
                    action: "paragraph.table".into(),
                    value: None,
                    target: "A".into()
                }
            ),
            (
                "B".into(),
                MenuActionPayload {
                    action: "editor.edit.findNext".into(),
                    value: None,
                    target: "B".into()
                }
            ),
            (
                "B".into(),
                MenuActionPayload {
                    action: "editor.edit.findNext".into(),
                    value: None,
                    target: "B".into()
                }
            ),
            (
                "A".into(),
                MenuActionPayload {
                    action: "paragraph.table".into(),
                    value: None,
                    target: "A".into()
                }
            ),
        ]
    );
    assert_eq!(dispatch_logs.borrow().len(), 4);
    let log_text = std::fs::read_to_string(home.dir.join(".mdpro/mdpro.log")).unwrap();
    let cancels: Vec<_> = log_text
        .lines()
        .filter(|line| line.contains("ui.menu.availability") && line.contains("wrong_mode"))
        .collect();
    assert_eq!(cancels.len(), 1);
    let source = include_str!("menu.rs");
    assert!(source.contains("emit_to_window("));
    assert!(source.contains("menus.as_deref()"));
    assert!(source.contains("route(action, value, focus, &live, emit, log_event)"));
}

#[test]
fn m4_wi3_installation_switches_enabled_state_without_a_click() {
    let _home = TestHome::new("m4_mode_install");
    let state = MenuState::default();
    let applied = AppliedShortcuts {
        keyboard_shortcuts_version: crate::models::CURRENT_KEYBOARD_SHORTCUTS_VERSION,
        source: AppliedSource::Loaded,
        bindings: resolve_applied(&KeyboardShortcuts::default()),
    };
    let layout = menu_layout().unwrap();
    let mut installed = Vec::new();
    let mut install = |_: &[String], mode: Option<&str>| {
        let mode = mode.and_then(|value| ViewMode::parse(value).ok());
        let specs = menu_layout_for(layout, &applied, mode);
        let table = specs
            .iter()
            .find(|spec| spec.command_id == "paragraph.table")
            .unwrap();
        installed.push((table.enabled, table.accelerator.clone()));
        Ok(())
    };
    state.set_focused(Some("A".into()));
    state
        .publish_op(
            RecentOp::Refresh,
            Some(ModeReport {
                window: "A".into(),
                mode: "source".into(),
                tab_count: None,
            }),
            &mut install,
        )
        .unwrap();
    state
        .publish_op(
            RecentOp::Refresh,
            Some(ModeReport {
                window: "A".into(),
                mode: "wysiwyg".into(),
                tab_count: None,
            }),
            &mut install,
        )
        .unwrap();
    state
        .publish_op(
            RecentOp::Refresh,
            Some(ModeReport {
                window: "B".into(),
                mode: "source".into(),
                tab_count: None,
            }),
            &mut install,
        )
        .unwrap();
    state.set_focused(Some("B".into()));
    state
        .publish_op(RecentOp::Refresh, None, &mut install)
        .unwrap();
    state.set_focused(Some("A".into()));
    state
        .publish_op(RecentOp::Refresh, None, &mut install)
        .unwrap();
    state.forget_window("A");
    state
        .publish_op(RecentOp::Refresh, None, &mut install)
        .unwrap();
    assert_eq!(
        installed,
        [
            (false, None),
            (true, Some("Cmd+Shift+T".into())),
            (true, Some("Cmd+Shift+T".into())),
            (false, None),
            (true, Some("Cmd+Shift+T".into())),
            (false, None),
        ]
    );
}

#[test]
fn m4_wi3_production_emit_seam_reads_focus_and_mode_at_click_time() {
    let _home = TestHome::new("m4_emit_seam");
    let layout = menu_layout().unwrap();
    let focus = MenuFocus::new();
    let menus = MenuState::default();
    menus
        .publish_op(
            RecentOp::Refresh,
            Some(ModeReport {
                window: "A".into(),
                mode: "wysiwyg".into(),
                tab_count: None,
            }),
            |_, _| Ok(()),
        )
        .unwrap();
    let emitted = Cell::new(0);
    let click = || {
        emit_to_window(layout, "paragraph.table", "A", &focus, Some(&menus), |_| {
            emitted.set(emitted.get() + 1);
            Ok(())
        })
    };
    assert!(click().is_err());
    focus.apply("A", true);
    assert!(click().is_ok());
    menus
        .publish_op(
            RecentOp::Refresh,
            Some(ModeReport {
                window: "A".into(),
                mode: "source".into(),
                tab_count: None,
            }),
            |_, _| Ok(()),
        )
        .unwrap();
    assert!(click().is_err());
    menus.forget_window("A");
    assert!(click().is_err());
    assert_eq!(emitted.get(), 1);
}

#[test]
fn m4_wi3_refused_click_logs_once_and_accepted_click_does_not_log_cancel() {
    let home = TestHome::new("m4_availability_log");
    let old = logger::get_log_settings();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    let layout = menu_layout().unwrap();
    let refused = dispatch_if_allowed(
        layout,
        "paragraph.table",
        "A",
        Some("A"),
        Some(ViewMode::Source),
        |_| Ok(()),
    );
    let accepted = dispatch_if_allowed(
        layout,
        "editor.edit.findNext",
        "A",
        Some("A"),
        Some(ViewMode::Wysiwyg),
        |_| Ok(()),
    );
    logger::set_log_settings(old);
    assert!(refused.is_err());
    assert!(accepted.is_ok());
    let log = std::fs::read_to_string(home.dir.join(".mdpro/mdpro.log")).unwrap();
    let lines: Vec<_> = log
        .lines()
        .filter(|line| line.contains("ui.menu.availability") && line.contains("paragraph.table"))
        .collect();
    assert_eq!(lines.len(), 1);
    assert!(lines[0].contains("wrong_mode"));
}
