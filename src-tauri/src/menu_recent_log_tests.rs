//! D43 WI-3: `menu.recent_files.sync` records emitted by `MenuState::publish_op`
//! (SL-01..SL-06 of `.claude/tdd-guardian/tests-20261007-143049.md`).
//!
//! **Law**: path redaction. No record, for any op and any outcome, contains a
//! path from the op; context keys are only `op`, `count` and `outcome`.
//!
//! Real logger, real file: `TestHome` (holds `HOME_LOCK`, temp `$HOME`) plus
//! the `LoggerSettingsRestorer` / `force_logger_on` pair duplicated from
//! `commands/preferences_log_redaction_tests.rs:49-67`. Only `install` (the
//! `AppHandle` boundary) is a test closure.

use super::MenuState;
use crate::menu::menu_recent_merge::{RecentOp, MAX_RECENT_PATH_BYTES};
use crate::models::{LogLevel, LogSettings};
use crate::services::logger;
use crate::services::window_restore::test_home::TestHome;
use serde_json::{json, Value};
use std::collections::BTreeSet;

const EVENT: &str = "menu.recent_files.sync";

struct LoggerSettingsRestorer(LogSettings);
impl Drop for LoggerSettingsRestorer {
    fn drop(&mut self) {
        logger::set_log_settings(self.0.clone());
    }
}

/// Call after the `TestHome` exists, so nothing reaches the real log.
fn force_logger_on() -> LoggerSettingsRestorer {
    let restorer = LoggerSettingsRestorer(logger::get_log_settings());
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    restorer
}

/// Field order matters: the logger is restored before `$HOME` and the lock.
struct Harness {
    _logger: LoggerSettingsRestorer,
    home: TestHome,
}

fn harness(label: &str) -> Harness {
    let home = TestHome::new(label);
    Harness {
        _logger: force_logger_on(),
        home,
    }
}

impl Harness {
    fn log_text(&self) -> String {
        std::fs::read_to_string(self.home.dir.join(".mdpro").join("mdpro.log")).unwrap_or_default()
    }

    fn records(&self) -> Vec<Value> {
        self.log_text()
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter(|r| r["event"] == EVENT)
            .collect()
    }
}

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn state_with(items: &[&str]) -> MenuState {
    let state = MenuState::default();
    state.set_recent_files(v(items));
    state
}

fn record(p: &str) -> RecentOp {
    RecentOp::Record {
        path: p.to_string(),
    }
}

fn ok(_: &[String], _: Option<&str>) -> Result<(), String> {
    Ok(())
}

fn status_context(records: &[Value]) -> Vec<(Value, Value)> {
    records
        .iter()
        .map(|r| (r["status"].clone(), r["context"].clone()))
        .collect()
}

#[test]
fn sl01_record_success_logs_start_then_success_with_op_and_count() {
    let h = harness("sl01");
    let state = state_with(&["/a.md"]);
    let result = state.publish_op(record("/b.md"), None, ok);
    assert_eq!(result, Ok(v(&["/b.md", "/a.md"])));
    let records = h.records();
    assert_eq!(
        status_context(&records),
        vec![
            (json!("start"), json!({ "op": "record" })),
            (json!("success"), json!({ "op": "record", "count": 2 })),
        ]
    );
    assert_eq!(records[1]["level"], "info");
}

#[test]
fn sl02_seed_with_stored_none_logs_a_hydration_failed_warn() {
    let h = harness("sl02");
    let state = MenuState::default();
    let op = RecentOp::Seed {
        stored: None,
        pending_newest_first: v(&["/a.md"]),
    };
    assert_eq!(state.publish_op(op, None, ok), Ok(v(&["/a.md"])));
    let records = h.records();
    let warns: Vec<&Value> = records.iter().filter(|r| r["level"] == "warn").collect();
    assert_eq!(warns.len(), 1, "records: {records:?}");
    assert_eq!(
        warns[0]["context"],
        json!({ "op": "seed", "outcome": "hydration_failed", "count": 1 })
    );
    let warn_at = records.iter().position(|r| r["level"] == "warn");
    let success_at = records.iter().position(|r| r["status"] == "success");
    assert!(success_at.is_some(), "records: {records:?}");
    assert!(warn_at < success_at, "the success record follows the warn");
}

#[test]
fn sl03_seed_with_stored_some_emits_no_warn() {
    let h = harness("sl03");
    let state = MenuState::default();
    for stored in [v(&["/s.md"]), Vec::new()] {
        let op = RecentOp::Seed {
            stored: Some(stored),
            pending_newest_first: Vec::new(),
        };
        assert!(state.publish_op(op, None, ok).is_ok());
    }
    let records = h.records();
    assert!(
        records.iter().all(|r| r["level"] != "warn"),
        "records: {records:?}"
    );
    let count = |s: &str| records.iter().filter(|r| r["status"] == s).count();
    assert_eq!(
        (count("start"), count("success")),
        (2, 2),
        "records: {records:?}"
    );
}

#[test]
fn sl04_install_failure_logs_fail_and_no_success() {
    let h = harness("sl04");
    let state = state_with(&["/a.md"]);
    let result = state.publish_op(record("/b.md"), None, |_, _| Err("set_menu failed".into()));
    assert_eq!(result, Err("set_menu failed".to_string()));
    let records = h.records();
    assert_eq!(records.len(), 2, "records: {records:?}");
    assert_eq!(records[0]["status"], "start");
    assert_eq!(records[1]["status"], "fail");
    assert_eq!(records[1]["level"], "error");
    assert_eq!(records[1]["context"], json!({ "op": "record" }));
    let error = records[1]["error"].as_str().unwrap_or_default();
    assert!(!error.is_empty(), "records: {records:?}");
    assert!(records.iter().all(|r| r["status"] != "success"));
}

fn rng(seed: u64) -> impl FnMut() -> u64 {
    let mut x = seed;
    move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    }
}

#[test]
fn sl05_property_no_path_in_any_record_across_generated_ops() {
    const SEED: u64 = 0xD43_0305;
    let h = harness("sl05");
    let state = MenuState::default();
    let mut next = rng(SEED);
    let marker = |n: u64| format!("/D43-MARKER-{n}/doc.md");
    for n in 0..40u64 {
        let op = if n % 10 == 9 {
            record(&format!(
                "/D43-MARKER-{n}/{}",
                "x".repeat(MAX_RECENT_PATH_BYTES)
            ))
        } else {
            match next() % 3 {
                0 => record(&marker(n)),
                1 => RecentOp::Seed {
                    stored: if next().is_multiple_of(2) {
                        None
                    } else {
                        Some(vec![marker(n + 100)])
                    },
                    pending_newest_first: vec![marker(n + 200)],
                },
                _ => RecentOp::Refresh,
            }
        };
        let pass = next().is_multiple_of(2);
        let _ = state.publish_op(op, None, |_, _| {
            if pass {
                Ok(())
            } else {
                Err(format!("install failed for {}", marker(n)))
            }
        });
    }
    let log = h.log_text();
    assert!(
        !log.contains("D43-MARKER"),
        "seed={SEED:#x}: a path reached the log"
    );
    let allowed: BTreeSet<&str> = ["op", "count", "outcome"].into_iter().collect();
    let records = h.records();
    assert!(
        records.len() >= 80,
        "seed={SEED:#x}: {} records",
        records.len()
    );
    for r in &records {
        let keys: BTreeSet<&str> = r["context"]
            .as_object()
            .map(|m| m.keys().map(String::as_str).collect())
            .unwrap_or_default();
        assert!(keys.is_subset(&allowed), "seed={SEED:#x} record {r}");
    }
}

#[test]
fn sl06_validation_rejection_logs_a_kind_only_fail() {
    let h = harness("sl06");
    let state = state_with(&["/a.md"]);
    let prefix = "/D43-MARKER-x";
    let p_bad = format!(
        "{prefix}{}",
        "x".repeat(MAX_RECENT_PATH_BYTES + 1 - prefix.len())
    );
    assert_eq!(p_bad.len(), MAX_RECENT_PATH_BYTES + 1);
    assert!(state.publish_op(record(&p_bad), None, ok).is_err());
    let records = h.records();
    let fails: Vec<&Value> = records.iter().filter(|r| r["status"] == "fail").collect();
    assert_eq!(fails.len(), 1, "records: {records:?}");
    assert_eq!(fails[0]["error"], "path_too_long");
    assert!(!h.log_text().contains("D43-MARKER"));
    assert_eq!(state.recent_files(), v(&["/a.md"]));
}
