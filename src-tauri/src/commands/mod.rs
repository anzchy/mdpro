pub mod draft;
pub mod draft_recovery;
pub mod export;
pub mod file;
pub mod image;
pub mod launch;
pub mod logging;
pub mod mcp;
pub mod menu;
pub mod preferences;
pub mod quit_guard;
pub mod toc;
pub mod updater;
pub mod window;

pub fn handlers() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool {
    tauri::generate_handler![
        export::render_markdown,
        export::export_html,
        export::export_rendered_html,
        export::preview_html,
        file::create_document,
        file::open_file,
        file::open_file_dialog,
        file::save_file,
        file::save_file_dialog,
        file::close_document,
        file::check_file_modified,
        file::reload_file,
        logging::log_event,
        logging::get_logging_settings,
        logging::set_logging_settings,
        preferences::get_preferences,
        preferences::set_preferences,
        preferences::get_system_theme,
        preferences::save_window_state,
        preferences::pick_export_folder,
        launch::get_launch_paths,
        menu::set_recent_files_menu,
        draft::save_draft,
        draft::get_draft,
        draft::delete_draft,
        draft_recovery::list_drafts,
        draft_recovery::recover_draft,
        draft_recovery::discard_recovery_draft,
        draft_recovery::cleanup_old_drafts,
        window::create_window,
        window::save_window_geometry,
        window::get_window_geometry,
        // TOC commands
        toc::get_document_headings,
        // Image commands
        image::resolve_image_path,
        image::upload_image,
        image::upload_images_batch,
        image::copy_external_image,
        image::get_image_config,
        image::set_image_config,
        // MCP commands
        mcp::mcp_sync_documents,
        mcp::mcp_get_server_info,
        mcp::mcp_get_status,
        mcp::mcp_get_installations,
        mcp::mcp_install_config,
        mcp::mcp_remove_config,
        // Updater commands
        updater::get_app_version,
        // Quit guard
        quit_guard::quit_guard_reply
    ]
}

#[cfg(test)]
#[path = "draft_gate_tests.rs"]
mod draft_gate_tests;

#[cfg(test)]
#[path = "draft_backstop_tests.rs"]
mod draft_backstop_tests;

#[cfg(test)]
#[path = "draft_backstop_order_tests.rs"]
mod draft_backstop_order_tests;

#[cfg(test)]
#[path = "draft_backstop_undiscard_tests.rs"]
mod draft_backstop_undiscard_tests;

#[cfg(test)]
#[path = "draft_owner_gate_tests.rs"]
mod draft_owner_gate_tests;

#[cfg(all(test, unix))]
#[path = "draft_ctx_under_lock_tests.rs"]
mod draft_ctx_under_lock_tests;

#[cfg(all(test, unix))]
#[path = "draft_log_redaction_tests.rs"]
mod draft_log_redaction_tests;

#[cfg(all(test, unix))]
#[path = "draft_log_redaction_failure_tests.rs"]
mod draft_log_redaction_failure_tests;
