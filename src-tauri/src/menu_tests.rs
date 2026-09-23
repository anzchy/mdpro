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
