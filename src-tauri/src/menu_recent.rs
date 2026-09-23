//! Recent-files state and the "Open Recent" submenu, split out of `menu.rs`.
//!
//! Purpose: hold the published recent-files list (`MenuState`) and build the
//! submenu from it. `publish_after` publishes a new list only once the menu
//! built from it has installed, so the state never names a menu that failed
//! (D16F row 18). Caller: `commands/menu.rs` `set_recent_files_menu`.
//!
//! `MENU_FILE_RECENT_PREFIX` stays in `menu.rs` with the other `MENU_*` ids.

use super::MENU_FILE_RECENT_PREFIX;
use std::path::Path;
use std::sync::Mutex;
use tauri::menu::{MenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Wry};

#[derive(Default)]
pub struct MenuState {
    recent_files: Mutex<Vec<String>>,
}

impl MenuState {
    pub fn set_recent_files(&self, recent_files: Vec<String>) {
        if let Ok(mut data) = self.recent_files.lock() {
            *data = recent_files;
        }
    }

    pub fn recent_files(&self) -> Vec<String> {
        self.recent_files
            .lock()
            .map(|data| data.clone())
            .unwrap_or_default()
    }
}

/// Install a menu built from `list`, then publish `list` as the recent files.
///
/// `install` receives the **new** list and runs exactly once while the old list
/// is still published. The state changes only when `install` returns `Ok`, so a
/// failed build or `set_menu` never lets an old menu item index resolve against
/// a list it was not built from (audit row 18).
pub fn publish_after(
    state: &MenuState,
    list: Vec<String>,
    install: impl FnOnce(&[String]) -> Result<(), String>,
) -> Result<(), String> {
    install(&list)?;
    state.set_recent_files(list);
    Ok(())
}

pub(super) fn recent_label(path: &str) -> String {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path);
    file_name.to_string()
}

pub(super) fn build_recent_submenu(
    app: &AppHandle<Wry>,
    recent_files: &[String],
) -> tauri::Result<Submenu<Wry>> {
    let mut builder = SubmenuBuilder::new(app, "Open Recent");
    if recent_files.is_empty() {
        let empty_item = MenuItem::with_id(
            app,
            "menu.file.recent.empty",
            "No Recent Files",
            false,
            None::<&str>,
        )?;
        builder = builder.item(&empty_item);
    } else {
        for (index, path) in recent_files.iter().enumerate() {
            let id = format!("{}{}", MENU_FILE_RECENT_PREFIX, index);
            let label = recent_label(path);
            let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;
            builder = builder.item(&item);
        }
    }
    builder.build()
}

#[cfg(test)]
#[path = "menu_recent_tests.rs"]
mod tests;
