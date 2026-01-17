use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, Theme};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangedEvent {
    pub path: String,
    pub change_type: String,
    pub new_path: Option<String>,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeChangedEvent {
    pub theme: String,
}

pub struct FileWatcher {
    watcher: Mutex<RecommendedWatcher>,
    watched_paths: Arc<Mutex<Vec<String>>>,
}

impl FileWatcher {
    pub fn new(app_handle: AppHandle) -> Self {
        let watched_paths = Arc::new(Mutex::new(Vec::new()));
        let watcher = RecommendedWatcher::new(
            move |res| {
                if let Ok(event) = res {
                    handle_event(&app_handle, event);
                }
            },
            Config::default(),
        )
        .expect("failed to create watcher");

        let watcher = Mutex::new(watcher);
        Self {
            watcher,
            watched_paths,
        }
    }

    pub fn watch(&self, path: &Path) {
        if let Ok(mut watcher) = self.watcher.lock() {
            let _ = watcher.watch(path, RecursiveMode::NonRecursive);
        }
        if let Ok(mut list) = self.watched_paths.lock() {
            let value = path.to_string_lossy().to_string();
            if !list.contains(&value) {
                list.push(value);
            }
        }
    }

    #[allow(dead_code)]
    pub fn unwatch(&self, path: &Path) {
        if let Ok(mut watcher) = self.watcher.lock() {
            let _ = watcher.unwatch(path);
        }
        if let Ok(mut list) = self.watched_paths.lock() {
            let value = path.to_string_lossy().to_string();
            list.retain(|item| item != &value);
        }
    }
}

fn emit_file_changed(app_handle: &AppHandle, event: FileChangedEvent) {
    let _ = app_handle.emit("file:changed", event);
}

fn handle_event(app_handle: &AppHandle, event: Event) {
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    match event.kind {
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => {
            if event.paths.len() >= 2 {
                emit_file_changed(
                    app_handle,
                    FileChangedEvent {
                        path: event.paths[0].to_string_lossy().to_string(),
                        change_type: "renamed".to_string(),
                        new_path: Some(event.paths[1].to_string_lossy().to_string()),
                        timestamp,
                    },
                );
            }
        }
        EventKind::Modify(_) => {
            if let Some(path) = event.paths.get(0) {
                emit_file_changed(
                    app_handle,
                    FileChangedEvent {
                        path: path.to_string_lossy().to_string(),
                        change_type: "modified".to_string(),
                        new_path: None,
                        timestamp,
                    },
                );
            }
        }
        EventKind::Remove(_) => {
            if let Some(path) = event.paths.get(0) {
                emit_file_changed(
                    app_handle,
                    FileChangedEvent {
                        path: path.to_string_lossy().to_string(),
                        change_type: "deleted".to_string(),
                        new_path: None,
                        timestamp,
                    },
                );
            }
        }
        _ => {}
    }
}

pub fn emit_theme_changed(app_handle: &AppHandle, theme: &Theme) {
    let value = match theme {
        Theme::Dark => "dark",
        _ => "light",
    };
    let _ = app_handle.emit(
        "theme:changed",
        ThemeChangedEvent {
            theme: value.to_string(),
        },
    );
}
