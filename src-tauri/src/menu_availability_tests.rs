use super::{allows_insert_table, MenuModes, ViewMode};
use crate::menu::{menu_recent_merge::RecentOp, MenuState, ModeReport};
use crate::models::{LogLevel, LogSettings};
use crate::services::{logger, window_restore::test_home::TestHome};

#[test]
fn m3a_ac1_two_windows_follow_focused_mode() {
    let mut modes = MenuModes::default();
    modes.report("A", "wysiwyg").unwrap();
    modes.report("B", "source").unwrap();
    assert!(allows_insert_table(modes.for_focused(Some("A"))));
    assert!(!allows_insert_table(modes.for_focused(Some("B"))));
    assert_eq!(modes.for_focused(Some("A")), Some(ViewMode::Wysiwyg));
}

#[test]
fn m3a_ac2_no_focus_or_report_fails_closed() {
    let mut modes = MenuModes::default();
    modes.report("A", "wysiwyg").unwrap();
    assert!(!allows_insert_table(modes.for_focused(None)));
    assert!(!allows_insert_table(modes.for_focused(Some("C"))));
}

#[test]
fn m3a_ac3_destroy_forgets_report() {
    let mut modes = MenuModes::default();
    modes.report("A", "wysiwyg").unwrap();
    modes.forget("A");
    assert!(!allows_insert_table(modes.for_focused(Some("A"))));
}

#[test]
fn m3a_ac4_late_report_does_not_retarget_availability() {
    let mut modes = MenuModes::default();
    modes.report("A", "wysiwyg").unwrap();
    modes.report("B", "source").unwrap();
    assert!(allows_insert_table(modes.for_focused(Some("A"))));
    modes.report("B", "source").unwrap();
    assert!(allows_insert_table(modes.for_focused(Some("A"))));
}

fn report(window: &str, mode: &str) -> Option<ModeReport> {
    Some(ModeReport {
        window: window.into(),
        mode: mode.into(),
    })
}

#[test]
fn m3a_installed_mode_tracks_focus_and_late_reports() {
    let _home = TestHome::new("m3a_installed_mode");
    let state = MenuState::default();
    state.set_focused(Some("A".into()));
    let mut installed = Vec::new();
    let mut install = |_: &[String], mode: Option<&str>| {
        installed.push(mode.map(str::to_string));
        Ok(())
    };
    state
        .publish_op(RecentOp::Refresh, report("A", "wysiwyg"), &mut install)
        .unwrap();
    state
        .publish_op(RecentOp::Refresh, report("B", "source"), &mut install)
        .unwrap();
    state.set_focused(Some("B".into()));
    state
        .publish_op(RecentOp::Refresh, None, &mut install)
        .unwrap();
    state.set_focused(None);
    state
        .publish_op(RecentOp::Refresh, None, &mut install)
        .unwrap();
    state.forget_window("B");
    state.set_focused(Some("B".into()));
    state
        .publish_op(RecentOp::Refresh, None, &mut install)
        .unwrap();
    assert_eq!(
        installed,
        [
            Some("wysiwyg".into()),
            Some("wysiwyg".into()),
            Some("source".into()),
            None,
            None
        ]
    );
}

#[test]
fn m3a_injected_caller_is_the_only_mode_report_label() {
    let source = include_str!("commands/menu.rs");
    assert!(source.contains("window: WebviewWindow<Wry>"));
    assert!(source.contains("window.label().to_string()"));
    assert!(!source.contains("window_label:"));
}

#[test]
fn m3a_failed_install_logs_enum_only_and_keeps_old_recent_list() {
    let home = TestHome::new("m3a_failed_install");
    let old = logger::get_log_settings();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    let state = MenuState::default();
    state.set_recent_files(vec!["/private/old.md".into()]);
    state.set_focused(Some("A".into()));
    let result = state.publish_op(
        RecentOp::Record {
            path: "/private/new.md".into(),
        },
        report("A", "wysiwyg"),
        |_, _| Err("/private/install error".into()),
    );
    logger::set_log_settings(old);
    assert!(result.is_err());
    assert_eq!(state.recent_files(), ["/private/old.md"]);
    let text = std::fs::read_to_string(home.dir.join(".mdpro/mdpro.log")).unwrap();
    let failed = text
        .lines()
        .filter(|line| line.contains("menu.recent_files.sync") && line.contains("\"fail\""))
        .last()
        .unwrap();
    assert!(failed.contains("install_failed"));
    assert!(!failed.contains("/private"), "{failed}");
}

#[test]
fn m3a_failed_install_still_changes_click_time_mode_guard() {
    let _home = TestHome::new("m3a_failed_install_guard");
    let state = MenuState::default();
    state.set_focused(Some("A".into()));
    state
        .publish_op(RecentOp::Refresh, report("A", "wysiwyg"), |_, _| Ok(()))
        .unwrap();
    assert!(allows_insert_table(state.mode_for_window("A")));
    let result = state.publish_op(RecentOp::Refresh, report("A", "source"), |_, _| {
        Err("install failed".into())
    });
    assert!(result.is_err());
    assert!(!allows_insert_table(state.mode_for_window("A")));
}

#[test]
fn m3a_every_declared_menu_id_has_exactly_one_click_route() {
    let source = include_str!("menu.rs");
    let body = source.split("pub fn handle_menu_event").nth(1).unwrap();
    let body = body.split("fn request_guarded_quit").next().unwrap();
    let mut checked = 0;
    for line in source.lines() {
        let line = line.trim();
        if let Some(rest) = line
            .strip_prefix("const MENU_")
            .or_else(|| line.strip_prefix("pub const MENU_"))
        {
            let name = format!("MENU_{}", rest.split(':').next().unwrap());
            let route = if name == "MENU_FILE_RECENT_PREFIX" {
                format!("strip_prefix({name})")
            } else {
                format!("{name} =>")
            };
            assert_eq!(body.matches(&route).count(), 1, "{name}: {route}");
            checked += 1;
        }
    }
    assert!(checked >= 19, "only {checked} ids checked");
}

#[test]
fn m3a_single_window_insert_table_is_the_only_changed_native_enabled_state() {
    assert!(allows_insert_table(Some(ViewMode::Wysiwyg)));
    assert!(!allows_insert_table(Some(ViewMode::Source)));
    assert!(!allows_insert_table(None));
    let source = include_str!("menu.rs");
    assert!(source.contains("active_view_mode == Some(\"wysiwyg\")"));
    assert_eq!(
        source
            .matches("active_view_mode == Some(\"wysiwyg\")")
            .count(),
        1
    );
}
