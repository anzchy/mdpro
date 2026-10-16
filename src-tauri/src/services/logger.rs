use chrono::Local;
use serde_json::{json, Value};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::models::{LogEntry, LogEntryPayload, LogLevel, LogSettings, LogStatus};
pub(crate) use crate::services::logger_settings_read::initial_settings;
#[cfg(test)]
use crate::services::logger_settings_read::resolve_initial_settings;
// Only tests name it through `logger`; the lib reaches it via `initial_settings`.
#[cfg(test)]
pub(crate) use crate::services::logger_settings_read::read_initial_logging;

/// `~/.mdpro/mdpro.log`, creating `~/.mdpro` when missing. `pub(crate)` so
/// the run-isolation test (ADR-0047 WI-002 WI-8) can resolve it under a temp HOME.
pub(crate) fn log_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let dir = home.join(".mdpro");
    if !dir.exists() {
        let _ = create_dir_all(&dir);
    }
    Some(dir.join("mdpro.log"))
}

/// Read the cached settings, recovering the stored value if the mutex is
/// poisoned.
///
/// Takes the cache by reference so a test can poison a local `Mutex` instead
/// of the process-wide one — poisoning the global cache would leak into every
/// later test in the same binary.
fn read_settings(cache: &Mutex<LogSettings>) -> LogSettings {
    // A poisoned mutex means some other thread panicked while holding it. The
    // settings behind the lock are untouched by that, so `into_inner` returns
    // the user's real value. Returning `LogSettings::default()` here was the
    // same fail-open as the one `FAIL_CLOSED_SETTINGS` (logger_settings_read.rs)
    // closes, reached by a different trigger.
    match cache.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

/// Write the cached settings, recovering the guard if the mutex is poisoned.
fn write_settings(cache: &Mutex<LogSettings>, settings: LogSettings) {
    // Dropping the write on a poisoned lock leaves the user looking at a
    // preference that never took effect.
    match cache.lock() {
        Ok(mut guard) => *guard = settings,
        Err(poisoned) => *poisoned.into_inner() = settings,
    }
}

fn settings_cache() -> &'static Mutex<LogSettings> {
    static CACHE: OnceLock<Mutex<LogSettings>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(initial_settings()))
}

pub fn get_log_settings() -> LogSettings {
    read_settings(settings_cache())
}

pub fn set_log_settings(settings: LogSettings) {
    write_settings(settings_cache(), settings);
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
#[path = "logger_settings_read_tests.rs"]
mod logger_settings_read_tests;

#[cfg(test)]
#[path = "logger_corrupt_config_tests.rs"]
mod logger_corrupt_config_tests;

#[cfg(test)]
mod tests {
    use super::*;
    // Use the crate-level HOME_LOCK so this test cannot race with the draft /
    // file / preferences tests, which also mutate the process-wide HOME.
    use crate::HOME_LOCK;
    use std::fs;

    // ---- A second fail-open the D7 record did not name --------------------
    //
    // `get_log_settings` used to return `LogSettings::default()` when the mutex
    // was poisoned — the same silent re-enable, different trigger. Fixing only
    // the `unwrap_or_default()` would leave the defect class alive.
    //
    // A poisoned mutex is not a reason to discard the user's setting: the value
    // behind the lock is still intact, and `PoisonError::into_inner` hands it
    // over. So this is a correctness fix, not a choice of fallback.
    //
    // Both cases poison a LOCAL mutex. Poisoning the process-wide cache would
    // leak into every later test in this binary.

    fn poisoned_cache(settings: LogSettings) -> Mutex<LogSettings> {
        let cache = Mutex::new(settings);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = cache.lock().unwrap();
            panic!("poison the mutex on purpose");
        }));
        assert!(cache.is_poisoned(), "the cache must actually be poisoned");
        cache
    }

    #[test]
    fn r6_reading_a_poisoned_cache_returns_the_stored_settings_not_the_default() {
        let cache = poisoned_cache(LogSettings {
            enabled: false,
            level: LogLevel::Error,
        });

        let read = read_settings(&cache);

        assert!(
            !read.enabled,
            "a poisoned mutex must not resurrect logging the user turned off"
        );
        assert_eq!(
            read.level.rank(),
            LogLevel::Error.rank(),
            "the stored level survives the poison; it was never lost"
        );
    }

    #[test]
    fn r7_writing_through_a_poisoned_cache_still_takes_effect() {
        // The write half of the same defect. Silently dropping a settings write
        // leaves the user looking at a preference that does not apply.
        let cache = poisoned_cache(LogSettings::default());

        write_settings(
            &cache,
            LogSettings {
                enabled: false,
                level: LogLevel::Warn,
            },
        );

        let read = read_settings(&cache);
        assert!(!read.enabled, "the write must not be silently dropped");
        assert_eq!(read.level.rank(), LogLevel::Warn.rank());
    }

    #[test]
    fn r8_an_unpoisoned_cache_round_trips_normally() {
        // Guards against "fixing" the poison path by ignoring the lock entirely.
        let cache = Mutex::new(LogSettings::default());

        write_settings(
            &cache,
            LogSettings {
                enabled: true,
                level: LogLevel::Debug,
            },
        );

        let read = read_settings(&cache);
        assert!(read.enabled);
        assert_eq!(read.level.rank(), LogLevel::Debug.rank());
    }

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
