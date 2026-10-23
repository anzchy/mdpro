//! D255: tab-count reports drive Switch Documents availability per window.
use super::{switch_documents_enabled, ViewMode};
use crate::menu::{menu_recent_merge::RecentOp, MenuState, ModeReport};

#[test]
fn d255_switch_documents_uses_the_focused_windows_tab_count() {
    let state = MenuState::default();
    for (label, count) in [("A", 1), ("B", 2)] {
        state
            .publish_op(
                RecentOp::Refresh,
                Some(ModeReport {
                    window: label.into(),
                    mode: "wysiwyg".into(),
                    tab_count: Some(count),
                }),
                |_, _| Ok(()),
            )
            .unwrap();
    }
    assert!(!switch_documents_enabled(state.tab_count_for_window("A")));
    assert!(switch_documents_enabled(state.tab_count_for_window("B")));
    assert!(!switch_documents_enabled(state.tab_count_for_window("C")));
    state.forget_window("B");
    assert!(!switch_documents_enabled(state.tab_count_for_window("B")));

    let error = state.publish_op(
        RecentOp::Refresh,
        Some(ModeReport {
            window: "A".into(),
            mode: "source".into(),
            tab_count: Some(10_001),
        }),
        |_, _| Ok(()),
    );
    assert_eq!(error.unwrap_err(), "invalid_tab_count");
    assert_eq!(state.mode_for_window("A"), Some(ViewMode::Wysiwyg));
    assert_eq!(state.tab_count_for_window("A"), Some(1));
}
