use chrono::Local;
use serde_json::{json, Value};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::models::{LogEntry, LogEntryPayload, LogLevel, LogSettings, LogStatus};
use crate::services::preferences::load_preferences;

fn log_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home).join(".mdpro");
    if !dir.exists() {
        let _ = create_dir_all(&dir);
    }
    Some(dir.join("mdpro.log"))
}

fn settings_cache() -> &'static Mutex<LogSettings> {
    static CACHE: OnceLock<Mutex<LogSettings>> = OnceLock::new();
    CACHE.get_or_init(|| {
        let initial = load_preferences()
            .map(|prefs| prefs.logging)
            .unwrap_or_default();
        Mutex::new(initial)
    })
}

pub fn get_log_settings() -> LogSettings {
    if let Ok(guard) = settings_cache().lock() {
        return guard.clone();
    }
    LogSettings::default()
}

pub fn set_log_settings(settings: LogSettings) {
    if let Ok(mut guard) = settings_cache().lock() {
        *guard = settings;
    }
}

pub fn should_log(level: LogLevel) -> bool {
    let settings = get_log_settings();
    settings.enabled && level.rank() >= settings.level.rank()
}

fn sanitize_value(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.remove("content");
            for (_, child) in map.iter_mut() {
                sanitize_value(child);
            }
        }
        Value::Array(items) => {
            for item in items.iter_mut() {
                sanitize_value(item);
            }
        }
        _ => {}
    }
}

pub fn log_structured_event(mut entry: LogEntry) {
    if !should_log(entry.level) {
        return;
    }
    if let Some(context) = entry.context.as_mut() {
        sanitize_value(context);
    }
    let Some(path) = log_path() else {
        return;
    };
    if let Ok(line) = serde_json::to_string(&entry) {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = file.write_all(line.as_bytes());
            let _ = file.write_all(b"\n");
        }
        if cfg!(debug_assertions) {
            eprintln!("{}", line);
        }
    }
}

pub fn log_event(payload: LogEntryPayload) {
    let entry = LogEntry {
        ts: Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        level: payload.level,
        event: payload.event,
        status: payload.status,
        action_id: payload.action_id,
        context: payload.context,
        duration_ms: payload.duration_ms,
        error: payload.error,
    };
    log_structured_event(entry);
}

pub fn log_line(message: &str) {
    log_event(LogEntryPayload {
        level: LogLevel::Debug,
        event: "legacy.log".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(json!({ "message": message })),
        duration_ms: None,
        error: None,
    });
}
