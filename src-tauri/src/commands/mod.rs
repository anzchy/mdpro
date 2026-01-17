pub mod export;
pub mod file;
pub mod preferences;
pub mod draft;

pub fn handlers() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool {
    tauri::generate_handler![
        export::render_markdown,
        export::export_html,
        export::preview_html,
        file::create_document,
        file::open_file,
        file::open_file_dialog,
        file::save_file,
        file::save_file_dialog,
        file::close_document,
        file::check_file_modified,
        file::reload_file,
        preferences::get_preferences,
        preferences::set_preferences,
        preferences::get_system_theme,
        preferences::save_window_state,
        draft::save_draft,
        draft::get_draft,
        draft::list_drafts,
        draft::recover_draft,
        draft::delete_draft,
        draft::cleanup_old_drafts
    ]
}
