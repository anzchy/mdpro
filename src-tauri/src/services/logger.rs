use chrono::Local;
use serde_json::{json, Value};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::models::{LogEntry, LogEntryPayload, LogLevel, LogSettings, LogStatus};
use crate::services::preferences::load_preferences;

fn log_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let dir = home.join(".mdpro");
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
            // One record, one write. Issuing the JSON and its newline as two
            // separate appends lets a concurrent writer land between them,
            // yielding `{a}{b}` plus a stray blank line — a record that is
            // silently unparseable rather than merely missing.
            let mut buf = String::with_capacity(line.len() + 1);
            buf.push_str(&line);
            buf.push('\n');
            let _ = file.write_all(buf.as_bytes());
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

#[cfg(test)]
mod tests {
    use super::*;
    // Use the crate-level HOME_LOCK so this test cannot race with the draft /
    // file / preferences tests, which also mutate the process-wide HOME.
    use crate::HOME_LOCK;
    use std::fs;

    struct HomeRestorer(Option<String>);
    impl Drop for HomeRestorer {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => unsafe { std::env::set_var("HOME", v) },
                None => unsafe { std::env::remove_var("HOME") },
            }
        }
    }

    /// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
    fn set_home(path: &std::path::Path) -> HomeRestorer {
        let prev = std::env::var("HOME").ok();
        unsafe { std::env::set_var("HOME", path.to_str().expect("temp dir path is non-UTF-8")) };
        HomeRestorer(prev)
    }

    /// Regression test for the interleaved-write defect.
    ///
    /// The writer used to issue `write_all(line)` and `write_all(b"\n")` as two
    /// separate appends. Two threads could land between them, producing a line
    /// like `{a}{b}` followed by a bare blank line — 35 such records were found
    /// in the real ~/.mdpro/mdpro.log, every one of them containing `}{` and
    /// none truncated. A corrupt record is silently unparseable, which is worse
    /// than a lost one: it makes the log lie about what happened.
    ///
    /// Asserting on this event's own count (rather than total line count) keeps
    /// the test honest if another test in the same process logs concurrently —
    /// HOME is process-wide, so foreign records can legitimately appear.
    #[test]
    fn concurrent_writes_never_interleave() {
        const THREADS: usize = 8;
        const PER_THREAD: usize = 250;
        const EVENT: &str = "test.atomic.write";

        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = std::env::temp_dir()
            .join("mdpro_test")
            .join("logger_atomic");
        fs::create_dir_all(&home).expect("temp home is creatable");
        let _home_guard = set_home(&home);

        // Start from a clean file so counts refer to this run only.
        let path = log_path().expect("log path resolves under temp HOME");
        let _ = fs::remove_file(&path);

        // Pin settings: the cache is a process-wide OnceLock that an earlier
        // test may have left disabled, which would vacuously pass this test.
        set_log_settings(LogSettings {
            enabled: true,
            level: LogLevel::Info,
        });

        let handles: Vec<_> = (0..THREADS)
            .map(|t| {
                std::thread::spawn(move || {
                    for i in 0..PER_THREAD {
                        log_event(LogEntryPayload {
                            level: LogLevel::Info,
                            event: EVENT.to_string(),
                            status: LogStatus::Success,
                            action_id: Some(format!("{t}-{i}")),
                            // Padding widens the window between the two writes,
                            // so the defect reproduces instead of hiding.
                            context: Some(json!({ "thread": t, "seq": i, "pad": "x".repeat(256) })),
                            duration_ms: None,
                            error: None,
                        });
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().expect("logging thread must not panic");
        }

        let raw = fs::read_to_string(&path).expect("log file exists after writing");
        let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();

        let mut corrupt = Vec::new();
        let mut mine = 0usize;
        for line in &lines {
            match serde_json::from_str::<Value>(line) {
                Ok(v) => {
                    if v.get("event").and_then(Value::as_str) == Some(EVENT) {
                        mine += 1;
                    }
                }
                Err(_) => corrupt.push(*line),
            }
        }

        assert!(
            corrupt.is_empty(),
            "{} of {} lines are not valid JSON — records interleaved. First: {}",
            corrupt.len(),
            lines.len(),
            corrupt[0].chars().take(160).collect::<String>()
        );
        assert_eq!(
            mine,
            THREADS * PER_THREAD,
            "every emitted record must appear exactly once"
        );
    }
}
