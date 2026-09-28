//! Pure cases for the MCP launch log line (ADR-0039, WI-4).
//!
//! LG-01 … LG-04 (`launch_log_entry`). Moved verbatim from the deleted
//! `mcp_launch_state_tests.rs` (ADR-0040 WI-5) when `launch_log_entry` moved
//! into `mcp_launch.rs`; the test bodies are unchanged.

use super::*;
use crate::models::{LogLevel, LogStatus};
use serde_json::{json, Value};

use McpConfigReadError::{Io, LockPoisoned, Parse};
use McpLaunchDecision::{Skip, Start};

/// The six decisions of DC-01's domain.
fn all_decisions() -> [McpLaunchDecision; 6] {
    [
        Start(StartReason::Enabled),
        Skip(SkipReason::Disabled),
        Start(StartReason::NoConfig),
        Start(StartReason::ConfigUnreadable(LockPoisoned)),
        Start(StartReason::ConfigUnreadable(Io)),
        Start(StartReason::ConfigUnreadable(Parse)),
    ]
}

#[test]
fn lg01_skip_entry_is_exactly_the_d3_shape() {
    let p = launch_log_entry(Skip(SkipReason::Disabled)).expect("skip must log");
    assert_eq!(p.event, "mcp.http_server.start");
    assert_eq!(p.level, LogLevel::Info);
    assert_eq!(p.status, LogStatus::Success);
    assert_eq!(
        p.context,
        Some(json!({"outcome": "skipped", "reason": "disabled"}))
    );
    assert_eq!(p.action_id, None);
    assert_eq!(p.error, None);
    assert_eq!(p.duration_ms, None);
}

#[test]
fn lg02_each_fail_open_kind_has_its_own_entry_under_the_shared_event() {
    let rows = [
        (LockPoisoned, "lock_poisoned"),
        (Io, "io"),
        (Parse, "parse"),
    ];
    for (kind, k) in rows {
        let p = launch_log_entry(Start(StartReason::ConfigUnreadable(kind)))
            .unwrap_or_else(|| panic!("fail-open {kind:?} must log"));
        assert_eq!(p.event, "mcp.http_server.start", "kind {k}");
        assert_eq!(p.level, LogLevel::Warn, "kind {k}");
        assert_eq!(p.status, LogStatus::Start, "kind {k}");
        assert_eq!(
            p.context,
            Some(json!({"outcome": "fail_open", "reason": "config_unreadable", "kind": k})),
            "kind {k}"
        );
        assert_eq!(p.action_id, None, "kind {k}");
        assert_eq!(p.error, None, "kind {k}");
        assert_eq!(p.duration_ms, None, "kind {k}");
    }
}

#[test]
fn lg03_enabled_and_no_config_add_no_entry() {
    assert!(launch_log_entry(Start(StartReason::Enabled)).is_none());
    assert!(launch_log_entry(Start(StartReason::NoConfig)).is_none());
}

#[test]
fn lg04_redaction_and_single_event_over_all_six_decisions() {
    const VOCAB: [&str; 7] = [
        "skipped",
        "disabled",
        "fail_open",
        "config_unreadable",
        "parse",
        "io",
        "lock_poisoned",
    ];
    fn leaves(v: &Value, out: &mut Vec<Value>) {
        match v {
            Value::Object(m) => m.values().for_each(|x| leaves(x, out)),
            Value::Array(a) => a.iter().for_each(|x| leaves(x, out)),
            other => out.push(other.clone()),
        }
    }
    let mut somes = 0;
    let mut failures = Vec::new();
    for d in all_decisions() {
        let Some(p) = launch_log_entry(d) else {
            continue;
        };
        somes += 1;
        let s = serde_json::to_string(&p).unwrap();
        if s.contains('/') || s.contains('\\') {
            failures.push(format!("{d:?}: path-like character in {s}"));
        }
        if p.error.is_some() {
            failures.push(format!("{d:?}: error text present"));
        }
        if p.event != "mcp.http_server.start" || p.action_id.is_some() {
            failures.push(format!("{d:?}: event/action_id off contract"));
        }
        let mut ls = Vec::new();
        if let Some(ctx) = &p.context {
            leaves(ctx, &mut ls);
        }
        for leaf in ls {
            match &leaf {
                Value::String(x) if VOCAB.contains(&x.as_str()) => {}
                other => failures.push(format!("{d:?}: leaf {other} outside vocabulary")),
            }
        }
    }
    assert_eq!(somes, 4, "Skip plus three fail-open kinds log");
    assert!(failures.is_empty(), "{failures:#?}");
}
