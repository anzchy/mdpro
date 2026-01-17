pub mod export;
pub mod file;
pub mod preferences;

pub fn handlers() -> impl Fn(tauri::ipc::Invoke) {
    tauri::generate_handler![
        export::render_markdown,
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
        preferences::get_system_theme
    ]
}
