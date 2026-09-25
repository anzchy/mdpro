//! Unit tests for `menu.rs` and `menu_recent.rs`, split out of `menu.rs`.

use super::menu_recent::recent_label;
use super::*;

#[test]
fn test_recent_label_uses_file_name_only() {
    assert_eq!(recent_label("/Users/me/notes/todo.md"), "todo.md");
}

#[test]
fn test_recent_label_falls_back_to_full_path_when_no_file_name() {
    // A trailing-slash or root path has no file_name → return the input.
    assert_eq!(recent_label("/"), "/");
}

#[test]
fn test_recent_label_handles_name_with_spaces_and_emoji() {
    assert_eq!(recent_label("/a/b/my 📝 note.md"), "my 📝 note.md");
}

#[test]
fn test_menu_state_set_and_read_recent_files() {
    let state = MenuState::default();
    assert!(state.recent_files().is_empty(), "starts empty");
    state.set_recent_files(vec!["/a.md".to_string(), "/b.md".to_string()]);
    assert_eq!(
        state.recent_files(),
        vec!["/a.md".to_string(), "/b.md".to_string()]
    );
}

#[test]
fn test_menu_state_set_replaces_previous_list() {
    let state = MenuState::default();
    state.set_recent_files(vec!["/old.md".to_string()]);
    state.set_recent_files(vec!["/new.md".to_string()]);
    assert_eq!(state.recent_files(), vec!["/new.md".to_string()]);
}

#[test]
fn test_recent_prefix_index_parsing_contract() {
    // handle_menu_event resolves "menu.file.recent.{idx}" by stripping the
    // prefix and parsing the index. Guard that contract here (the handler
    // itself needs an AppHandle, but the id math is what matters).
    let id = format!("{}{}", MENU_FILE_RECENT_PREFIX, 2);
    let stripped = id.strip_prefix(MENU_FILE_RECENT_PREFIX).unwrap();
    assert_eq!(stripped.parse::<usize>().unwrap(), 2);
}

// ---- WI-4: "Stop Waiting and Quit…" (ADR-0036) ----

/// `menu.rs` with every whitespace run collapsed to one space, so rustfmt
/// line-wrapping does not change what the source-contract checks see.
fn normalized_menu_source() -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/menu.rs");
    let source = std::fs::read_to_string(path).expect("menu.rs is readable");
    source.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// mn1: the escape id has its fixed value, collides with no other menu id,
/// and cannot be claimed by the recent-files `_ =>` arm.
#[test]
fn test_escape_id_value_and_distinct_from_every_menu_id() {
    assert_eq!(MENU_APP_STOP_WAITING_QUIT, "menu.app.stop_waiting_quit");
    let others = [
        MENU_FILE_NEW,
        MENU_FILE_NEW_WINDOW,
        MENU_FILE_OPEN,
        MENU_FILE_SAVE,
        MENU_FILE_CLOSE,
        MENU_FILE_EXPORT_HTML,
        MENU_FILE_RECENT_PREFIX,
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
        "menu.help.placeholder",
    ];
    assert!(
        !others.contains(&MENU_APP_STOP_WAITING_QUIT),
        "escape id must be distinct from every other menu id"
    );
    assert!(
        !MENU_APP_STOP_WAITING_QUIT.starts_with(MENU_FILE_RECENT_PREFIX),
        "escape id must not fall under the recent-files prefix"
    );
    let recent_index = MENU_APP_STOP_WAITING_QUIT
        .strip_prefix(MENU_FILE_RECENT_PREFIX)
        .and_then(|rest| rest.parse::<usize>().ok());
    assert_eq!(
        recent_index, None,
        "the recent-files arm must not resolve the escape id"
    );
}

/// mn2: source contract for the escape item. The handler and builder need a
/// live `AppHandle`, so their wiring is pinned on the (normalized) source.
#[test]
fn test_menu_source_contract_for_escape_item() {
    let src = normalized_menu_source();

    // (1) every `const MENU_*: &str = "…";` value is unique, and the escape
    // constant is one of them on a single line (ledger MENU_ID_RE shape).
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/menu.rs"))
        .expect("menu.rs is readable");
    assert!(
        raw.lines().any(|l| l.trim()
            == "pub const MENU_APP_STOP_WAITING_QUIT: &str = \"menu.app.stop_waiting_quit\";"),
        "(1) escape constant must be declared on one line for the ledger gate"
    );
    let mut values: Vec<&str> = Vec::new();
    for line in raw.lines() {
        let line = line.trim().trim_start_matches("pub ");
        if let Some(rest) = line.strip_prefix("const MENU_") {
            let value = rest
                .split('"')
                .nth(1)
                .expect("(1) MENU_* const has a literal");
            assert!(!values.contains(&value), "(1) duplicate menu id {value}");
            values.push(value);
        }
    }
    assert!(
        values.contains(&"menu.app.stop_waiting_quit"),
        "(1) escape id is among the MENU_* consts"
    );

    // (2) the handler arm calls deliver_escape on the managed guard and
    // emits nothing to any webview.
    let arm_marker = "MENU_APP_STOP_WAITING_QUIT =>";
    assert_eq!(
        src.matches(arm_marker).count(),
        1,
        "(2) exactly one escape arm"
    );
    let arm_start = src.find(arm_marker).unwrap() + arm_marker.len();
    let arm_rest = &src[arm_start..];
    let arm = &arm_rest[..arm_rest.find(" =>").expect("(2) a following arm exists")];
    assert!(
        arm.contains("deliver_escape("),
        "(2) arm calls deliver_escape: {arm}"
    );
    assert!(
        arm.contains("try_state::<AppQuitGuard>()"),
        "(2) arm reads the managed AppQuitGuard: {arm}"
    );
    assert!(!arm.contains("emit"), "(2) arm must not emit: {arm}");
    assert!(
        !arm.contains("emit_menu_action"),
        "(2) arm must not emit menu:action"
    );

    // (3) the builder: U+2026 label, enabled, no accelerator.
    let builder_marker = "MenuItem::with_id( app, MENU_APP_STOP_WAITING_QUIT,";
    let alt_marker = "MenuItem::with_id(app, MENU_APP_STOP_WAITING_QUIT,";
    let builder_pos = src
        .find(builder_marker)
        .or_else(|| src.find(alt_marker))
        .expect("(3) escape item is built with MenuItem::with_id");
    assert!(
        !src[..builder_pos].ends_with("Predefined"),
        "(3) escape item must be a custom MenuItem"
    );
    let builder = &src[builder_pos..];
    let builder = &builder[..builder.find(")?").expect("(3) builder call ends")];
    let label_ok = builder.contains(
        "MENU_APP_STOP_WAITING_QUIT, \"Stop Waiting and Quit\u{2026}\", true, None::<&str>",
    ) || builder.contains(
        "MENU_APP_STOP_WAITING_QUIT, \"Stop Waiting and Quit\\u{2026}\", true, None::<&str>",
    );
    assert!(label_ok, "(3) label/enabled/accelerator wrong: {builder}");
    assert!(
        !builder.contains("..."),
        "(3) label must use U+2026, not three dots"
    );

    // (4) placed directly after Quit in the app menu, before its build().
    let quit_marker = "PredefinedMenuItem::quit(";
    assert_eq!(src.matches(quit_marker).count(), 1, "(4) one Quit item");
    let after_quit = &src[src.find(quit_marker).unwrap()..];
    let next_item = after_quit.find(".item(").expect("(4) an item follows Quit");
    let build_end = after_quit.find(".build()").expect("(4) app menu builds");
    assert!(
        next_item < build_end,
        "(4) escape item is inside the app menu"
    );
    assert!(
        !after_quit[..next_item].contains(".separator()"),
        "(4) no separator between Quit and the escape item"
    );
    let next = &after_quit[next_item..];
    let next = &next[..next.find(")?)").expect("(4) item call ends")];
    assert!(
        next.contains("MENU_APP_STOP_WAITING_QUIT"),
        "(4) the item right after Quit is the escape item: {next}"
    );

    // (5) always enabled: never toggled.
    assert!(
        !src.contains("set_enabled"),
        "(5) escape item is never set_enabled"
    );
}
