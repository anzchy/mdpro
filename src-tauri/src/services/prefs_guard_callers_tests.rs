//! M1a WI-1: the six held-lock callers still finish (cases C1–C6 of
//! `.claude/tdd-guardian/tests-20261016-202016.md`).
//!
//! **Law:** each caller finishes its load → update → save on a valid config,
//! with the same observable result as before WI-1, and never blocks on its own
//! guard. A caller left on the public `load_preferences()` after the loader
//! takes the lock would hang on itself; here that is a `recv_timeout` failure,
//! not a hung test binary.
//!
//! Real command functions, real `config.json` under [`TestHome`], nothing
//! mocked. Every case seeds `autoSaveInterval: 111` (C1: `showSidebar`
//! flipped) as an unrelated-field witness that must survive the write.

use crate::commands::logging::set_logging_settings;
use crate::commands::preferences::{save_window_state, set_preferences};
use crate::commands::window::save_window_geometry;
use crate::models::{LogLevel, LogSettings, WindowGeometry, WindowState};
use crate::services::logger;
use crate::services::mcp_controller::test_support::GENEROUS;
use crate::services::preferences::{preferences_rw_lock, PartialPreferences};
use crate::services::preferences_mcp::persist_server_enabled;
use crate::services::window_restore::read_stored_geometry_in;
use crate::services::window_restore::test_home::{read_config_bytes, seed_config, TestHome};
use serde_json::{json, Value};
use std::future::Future;
use std::sync::mpsc::{self, RecvTimeoutError};

/// Runs `f` on a worker and waits at most `GENEROUS` for it.
fn bounded<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, RecvTimeoutError> {
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    let got = rx.recv_timeout(GENEROUS);
    if got.is_ok() {
        let _ = worker.join();
    }
    got
}

fn block_on<F: Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("current-thread runtime")
        .block_on(f)
}

fn on_disk(h: &TestHome) -> Value {
    serde_json::from_slice(&read_config_bytes(&h.dir)).expect("config.json is JSON")
}

fn seed_111(h: &TestHome, mutate: impl FnOnce(&mut Value)) -> Vec<u8> {
    seed_config(&h.dir, |v| {
        v["autoSaveInterval"] = json!(111);
        mutate(v);
    })
}

#[test]
fn c1_set_preferences_completes_and_writes_the_merge() {
    let h = TestHome::new("c1_set_preferences");
    let mut seeded_sidebar = Value::Null;
    seed_111(&h, |v| {
        v["showSidebar"] = json!(!v["showSidebar"].as_bool().expect("bool default"));
        seeded_sidebar = v["showSidebar"].clone();
    });
    let partial: PartialPreferences =
        serde_json::from_value(json!({ "autoSaveInterval": 222 })).expect("partial");

    let got = bounded(move || {
        block_on(set_preferences(partial))
            .map(|p| p.auto_save_interval)
            .map_err(|e| format!("{e:?}"))
    });

    assert_eq!(got, Ok(Ok(222)));
    let v = on_disk(&h);
    assert_eq!(v["autoSaveInterval"], json!(222));
    assert_eq!(v["showSidebar"], seeded_sidebar, "unrelated field lost");
}

#[test]
fn c2_save_window_state_completes_and_writes_window_state() {
    let h = TestHome::new("c2_save_window_state");
    seed_111(&h, |_| {});
    let state = WindowState {
        width: 1234,
        height: 800,
        x: 10,
        y: 20,
        is_maximized: false,
    };

    let got = bounded(move || block_on(save_window_state(state)).map_err(|e| format!("{e:?}")));

    assert_eq!(got, Ok(Ok(())));
    let v = on_disk(&h);
    assert_eq!(v["windowState"]["width"], json!(1234));
    assert_eq!(v["autoSaveInterval"], json!(111));
}

/// Restores the process-wide log settings on drop.
struct LoggerSettingsRestorer(LogSettings);
impl Drop for LoggerSettingsRestorer {
    fn drop(&mut self) {
        logger::set_log_settings(self.0.clone());
    }
}

#[test]
fn c3_set_logging_settings_completes_writes_logging_and_updates_the_logger() {
    let h = TestHome::new("c3_set_logging_settings");
    seed_111(&h, |_| {});
    let _restore = LoggerSettingsRestorer(logger::get_log_settings());

    let got = bounded(|| {
        block_on(set_logging_settings(LogSettings {
            enabled: false,
            level: LogLevel::Warn,
        }))
        .map(|s| (s.enabled, s.level))
        .map_err(|e| format!("{e:?}"))
    });
    let live = logger::get_log_settings();

    assert_eq!(got, Ok(Ok((false, LogLevel::Warn))));
    let v = on_disk(&h);
    assert_eq!(v["logging"], json!({ "enabled": false, "level": "warn" }));
    assert_eq!(v["autoSaveInterval"], json!(111));
    assert_eq!((live.enabled, live.level), (false, LogLevel::Warn));
}

#[test]
fn c4_save_window_geometry_completes_and_stores_the_entry() {
    let h = TestHome::new("c4_save_window_geometry");
    seed_111(&h, |_| {});
    let geometry = WindowGeometry {
        x: 5,
        y: 6,
        width: 700,
        height: 500,
        last_accessed: 0,
    };

    let got = bounded(move || block_on(save_window_geometry("/tmp/c4.md".into(), geometry)));

    assert_eq!(got, Ok(Ok(())));
    let v = on_disk(&h);
    let entry = &v["windowStates"]["/tmp/c4.md"];
    assert_eq!(
        (&entry["x"], &entry["y"], &entry["width"], &entry["height"]),
        (&json!(5), &json!(6), &json!(700), &json!(500)),
        "entry: {entry}"
    );
    assert_eq!(v["autoSaveInterval"], json!(111));
}

#[test]
fn c5_read_stored_geometry_in_completes_and_returns_the_entry() {
    let h = TestHome::new("c5_read_stored_geometry");
    let before = seed_111(&h, |v| {
        v["windowStates"] = json!({
            "/tmp/c5.md": { "x": 7, "y": 8, "width": 640, "height": 480, "lastAccessed": 9 }
        });
    });

    let got = bounded(|| {
        read_stored_geometry_in(preferences_rw_lock(), "/tmp/c5.md")
            .map(|g| g.map(|g| (g.x, g.y, g.width, g.height, g.last_accessed)))
            .map_err(|e| format!("{e:?}"))
    });

    assert_eq!(got, Ok(Ok(Some((7, 8, 640, 480, 9)))));
    assert_eq!(read_config_bytes(&h.dir), before, "bytes unchanged");
}

#[test]
fn c6_persist_server_enabled_completes_and_flips_the_flag() {
    let h = TestHome::new("c6_persist_server_enabled");
    seed_111(&h, |v| v["mcp"]["serverEnabled"] = json!(true));

    let got = bounded(|| persist_server_enabled(false));

    assert_eq!(got, Ok(Ok(())));
    let v = on_disk(&h);
    assert_eq!(v["mcp"]["serverEnabled"], json!(false));
    assert_eq!(v["autoSaveInterval"], json!(111));
}

// ---- M11 (M1a WI-2): the six callers on the migration path ----------------
//
// The same six callers on a seed without `keyboardShortcutsVersion`, i.e. the
// path a v0.3.5 file takes. Each still finishes within `GENEROUS`; a writer
// stamps version 1 (the production plan never moves it), and the reader
// leaves the bytes, and so the missing key, alone.

fn seed_unversioned(h: &TestHome) -> Vec<u8> {
    seed_111(h, |v| {
        v.as_object_mut()
            .expect("object")
            .remove("keyboardShortcutsVersion");
    })
}

fn m11_writer(label: &str, call: impl FnOnce() -> Result<(), String> + Send + 'static) {
    let h = TestHome::new(label);
    // Read and restored under `HOME_LOCK`: bound after `h`, so it drops first.
    let _restore = LoggerSettingsRestorer(logger::get_log_settings());
    seed_unversioned(&h);
    let got = bounded(call);
    assert_eq!(got, Ok(Ok(())), "{label}");
    let v = on_disk(&h);
    assert_eq!(v["keyboardShortcutsVersion"], json!(1), "{label}");
    assert_eq!(v["autoSaveInterval"], json!(111), "{label}");
}

#[test]
fn m11_the_five_writers_finish_and_stamp_version_one() {
    m11_writer("m11_c1", || {
        let partial: PartialPreferences =
            serde_json::from_value(json!({ "showSidebar": false })).expect("partial");
        block_on(set_preferences(partial))
            .map(|_| ())
            .map_err(|e| format!("{e:?}"))
    });
    m11_writer("m11_c2", || {
        let state = WindowState {
            width: 1234,
            height: 800,
            x: 10,
            y: 20,
            is_maximized: false,
        };
        block_on(save_window_state(state)).map_err(|e| format!("{e:?}"))
    });
    m11_writer("m11_c3", || {
        block_on(set_logging_settings(LogSettings {
            enabled: false,
            level: LogLevel::Warn,
        }))
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
    });
    m11_writer("m11_c4", || {
        let geometry = WindowGeometry {
            x: 5,
            y: 6,
            width: 700,
            height: 500,
            last_accessed: 0,
        };
        block_on(save_window_geometry("/tmp/m11.md".into(), geometry))
    });
    m11_writer("m11_c6", || {
        persist_server_enabled(false).map_err(|e| format!("{e:?}"))
    });
}

#[test]
fn m11_the_reader_finishes_and_leaves_the_key_absent() {
    let h = TestHome::new("m11_c5");
    let before = seed_unversioned(&h);
    let got = bounded(|| {
        read_stored_geometry_in(preferences_rw_lock(), "/tmp/absent.md")
            .map(|g| g.is_none())
            .map_err(|e| format!("{e:?}"))
    });
    assert_eq!(got, Ok(Ok(true)));
    assert_eq!(read_config_bytes(&h.dir), before, "bytes unchanged");
    assert!(on_disk(&h).get("keyboardShortcutsVersion").is_none());
}
