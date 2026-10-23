//! M4-WI-7: enum-only, single-line refusals at the click-time guard.

use super::*;
use crate::menu_layout::{menu_layout, Availability};
use crate::models::{LogLevel, LogSettings};
use crate::services::window_restore::test_home::TestHome;

#[test]
fn m4_refusal_classes_each_log_once_without_an_emit() {
    let home = TestHome::new("m4_unique_refusal_classes");
    let old = logger::get_log_settings();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    let mut layout = menu_layout().unwrap().clone();
    let mut row = layout
        .rows
        .iter()
        .find(|row| row.id == "paragraph.table")
        .unwrap()
        .clone();
    row.id = "m4.unique.guard".into();
    layout.rows = vec![row];
    let action = "editor.m4.unique.guard";
    let mut emitted = 0;
    for (focused, mode) in [
        (None, Some(ViewMode::Wysiwyg)),
        (Some("A"), Some(ViewMode::Source)),
    ] {
        let result = dispatch_if_allowed(&layout, action, "A", focused, mode, |_| {
            emitted += 1;
            Ok(())
        });
        assert!(result.is_err());
    }
    layout.rows[0].availability.macos.v2 = Availability::None;
    let result = dispatch_if_allowed(
        &layout,
        action,
        "A",
        Some("A"),
        Some(ViewMode::Wysiwyg),
        |_| {
            emitted += 1;
            Ok(())
        },
    );
    logger::set_log_settings(old);
    assert!(result.is_err());
    assert_eq!(emitted, 0);
    let log = std::fs::read_to_string(home.dir.join(".mdpro/mdpro.log")).unwrap();
    let reasons: Vec<String> = log
        .lines()
        .filter(|line| line.contains("m4.unique.guard"))
        .map(|line| {
            let entry: serde_json::Value = serde_json::from_str(line).unwrap();
            assert_eq!(entry["event"], "ui.menu.availability");
            assert_eq!(entry["status"], "cancel");
            assert!(!line.contains("/private/"));
            entry["context"]["reason"].as_str().unwrap().to_string()
        })
        .collect();
    assert_eq!(reasons, ["no_focus", "wrong_mode", "unavailable"]);
}
