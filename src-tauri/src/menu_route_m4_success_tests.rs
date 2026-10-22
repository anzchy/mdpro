//! Amendment 11: successful D261 menu-event seam payloads for M4 route classes.

use super::menu_target::{route, MenuActionPayload, MenuFocus};
use std::cell::RefCell;

#[test]
fn m4_successful_route_classes_emit_exact_payload_and_one_owner_log() {
    let focus = MenuFocus::new();
    focus.apply("editor-a", true);
    let live = vec!["editor-a".to_string(), "editor-b".to_string()];
    for (action, value) in [
        ("editor.paragraph.heading1", None),
        ("paragraph.table", None),
        ("file.preferences", Some("keyboard-shortcuts".to_string())),
        ("theme.dark", None),
        ("file.open_recent", Some("/tmp/recent-文档.md".to_string())),
    ] {
        let emissions = RefCell::new(Vec::new());
        let logs = RefCell::new(Vec::new());
        route(
            action,
            value.clone(),
            &focus,
            &live,
            |label, payload| {
                emissions
                    .borrow_mut()
                    .push((label.to_string(), payload.clone()));
                Ok::<(), ()>(())
            },
            |entry| logs.borrow_mut().push(entry),
        );
        assert_eq!(
            emissions.into_inner(),
            vec![(
                "editor-a".to_string(),
                MenuActionPayload {
                    action: action.to_string(),
                    value,
                    target: "editor-a".to_string(),
                }
            )]
        );
        let logs = logs.into_inner();
        assert_eq!(logs.len(), 1, "{action} has one Rust route-owner log");
        assert_eq!(logs[0].event, "menu.action.dispatch");
        assert_eq!(logs[0].context.as_ref().unwrap()["target"], "editor-a");
    }
}
