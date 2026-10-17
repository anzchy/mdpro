//! M1A-WI-7: the layout's menu ids are exactly today's `MENU_*` constants.
//! Matrix: .claude/tdd-guardian/tests-20261016-223726.md § M1A-WI-7,
//! "Unit: menu_layout_parity_tests.rs". A child of `menu.rs`, so it names
//! the constants themselves rather than their string values.

use super::*;
use crate::menu_layout::{menu_layout, MenuPath};
use std::collections::BTreeSet;

/// Help's disabled placeholder item. Its id is a literal in
/// `menu_submenus.rs`, not a `MENU_*` constant, so it is excluded by name
/// (and the test checks it is really there, so the exclusion is not vacuous).
const HELP_PLACEHOLDER_ID: &str = "menu.help.placeholder";

#[test]
fn layout_menu_ids_with_a_menu_path_equal_the_menu_constants() {
    let expected: BTreeSet<&str> = [
        MENU_FILE_NEW,
        MENU_FILE_NEW_WINDOW,
        MENU_FILE_OPEN,
        MENU_FILE_SAVE,
        MENU_FILE_CLOSE,
        MENU_FILE_EXPORT_HTML,
        MENU_FILE_PREFERENCES,
        MENU_VIEW_CYCLE,
        MENU_VIEW_SOURCE,
        MENU_VIEW_WYSIWYG,
        MENU_VIEW_TOGGLE_SIDEBAR,
        MENU_FORMAT_HIGHLIGHT,
        MENU_FORMAT_INSERT_TABLE,
        MENU_THEME_LIGHT,
        MENU_THEME_DARK,
        MENU_THEME_SYSTEM,
        MENU_APP_STOP_WAITING_QUIT,
        MENU_APP_QUIT,
    ]
    .into_iter()
    .collect();
    assert_eq!(expected.len(), 18);

    let layout = menu_layout().expect("the committed menu_layout.json parses");
    let with_path: BTreeSet<&str> = layout
        .rows
        .iter()
        .filter(|r| {
            [&r.menu.macos, &r.menu.windows, &r.menu.linux]
                .iter()
                .any(|m| matches!(m, MenuPath::Path(_)))
        })
        .filter_map(|r| r.menu_id.as_deref())
        .collect();

    // The recent-files items are built at runtime under this prefix; no
    // command row carries one.
    assert!(with_path
        .iter()
        .all(|id| !id.starts_with(MENU_FILE_RECENT_PREFIX)));
    assert!(with_path.contains(HELP_PLACEHOLDER_ID));
    assert!(include_str!("menu_submenus.rs").contains(&format!("\"{HELP_PLACEHOLDER_ID}\"")));

    let compared: BTreeSet<&str> = with_path
        .into_iter()
        .filter(|id| *id != HELP_PLACEHOLDER_ID)
        .collect();
    assert_eq!(compared, expected);
}
