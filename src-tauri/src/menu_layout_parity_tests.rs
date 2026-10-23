//! M1A-WI-7/M4: every native custom id in the layout has one declared route.
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
        MENU_HELP_KEYBOARD_SHORTCUTS,
        "menu.file.save_as",
        "menu.edit.copy_as_markdown",
        "menu.edit.paste_as_plain_text",
        "menu.edit.select_line",
        "menu.edit.select_word",
        "menu.edit.delete_word",
        "menu.edit.find",
        "menu.edit.replace",
        "menu.edit.find_next",
        "menu.edit.find_previous",
        "menu.paragraph.heading1",
        "menu.paragraph.heading2",
        "menu.paragraph.heading3",
        "menu.paragraph.heading4",
        "menu.paragraph.heading5",
        "menu.paragraph.heading6",
        "menu.paragraph.paragraph",
        "menu.paragraph.increase_heading",
        "menu.paragraph.decrease_heading",
        "menu.paragraph.code_fences",
        "menu.paragraph.math_block",
        "menu.paragraph.quote",
        "menu.paragraph.ordered_list",
        "menu.paragraph.unordered_list",
        "menu.paragraph.indent",
        "menu.paragraph.outdent",
        "menu.format.strong",
        "menu.format.emphasis",
        "menu.format.underline",
        "menu.format.code",
        "menu.format.strike",
        "menu.format.hyperlink",
        "menu.format.image",
        "menu.format.clear_format",
        "menu.view.switch_documents",
        "menu.view.toggle_fullscreen",
    ]
    .into_iter()
    .collect();
    assert_eq!(expected.len(), 55);

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
