//! Pure cases for the MCP launch-state machine (ADR-0039, WI-4).
//!
//! ST-01 … ST-03 (`apply`), BE-01 (`bind_event`), LG-01 … LG-04
//! (`launch_log_entry`). Every finite domain is enumerated exhaustively.

use super::*;
use crate::models::{LogLevel, LogStatus};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

use LaunchEvent::{BindErr, BindOk, Decided};
use McpConfigReadError::{Io, LockPoisoned, Parse};
use McpLaunchDecision::{Skip, Start};
use McpLaunchStatus::{Disabled, Failed, Running, Starting};

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

/// The eight events: `Decided(d)` for each decision, then `BindOk`, `BindErr`.
fn all_events() -> Vec<LaunchEvent> {
    let mut v: Vec<LaunchEvent> = all_decisions().into_iter().map(Decided).collect();
    v.push(BindOk);
    v.push(BindErr);
    v
}

const ALL_STATES: [McpLaunchStatus; 4] = [Starting, Running, Failed, Disabled];

fn is_terminal(s: McpLaunchStatus) -> bool {
    matches!(s, Running | Failed | Disabled)
}

#[test]
fn st01_full_transition_table() {
    // Hand-written expected result per (from, event). Starting row first.
    let expected = |from: McpLaunchStatus, ev: LaunchEvent| -> McpLaunchStatus {
        match from {
            Starting => match ev {
                Decided(Skip(SkipReason::Disabled)) => Disabled,
                Decided(Start(_)) => Starting,
                BindOk => Running,
                BindErr => Failed,
            },
            Running => Running,
            Failed => Failed,
            Disabled => Disabled,
        }
    };
    let mut failures = Vec::new();
    let mut cells = 0;
    for from in ALL_STATES {
        for ev in all_events() {
            cells += 1;
            let got = apply(from, ev);
            let want = expected(from, ev);
            if got != want {
                failures.push(format!("({from:?}, {ev:?}) → {got:?}, want {want:?}"));
            }
        }
    }
    assert_eq!(cells, 32, "domain is 4 states × 8 events");
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn st02_first_terminal_state_is_never_left_over_all_sequences_up_to_three() {
    let events = all_events();
    let mut sequences: Vec<Vec<LaunchEvent>> = Vec::new();
    for a in &events {
        sequences.push(vec![*a]);
        for b in &events {
            sequences.push(vec![*a, *b]);
            for c in &events {
                sequences.push(vec![*a, *b, *c]);
            }
        }
    }
    assert_eq!(sequences.len(), 8 + 64 + 512);

    let mut failures = Vec::new();
    for seq in &sequences {
        let mut state = Starting;
        let mut trace = vec![state];
        for ev in seq {
            state = apply(state, *ev);
            trace.push(state);
        }
        if let Some(i) = trace.iter().position(|s| is_terminal(*s)) {
            if trace[i..].iter().any(|s| *s != trace[i]) {
                failures.push(format!("left terminal: {seq:?} → {trace:?}"));
            }
        }
        if trace.contains(&Disabled) {
            let first_skip = seq.iter().position(|e| matches!(e, Decided(Skip(_))));
            let first_bind = seq.iter().position(|e| matches!(e, BindOk | BindErr));
            let ok = match (first_skip, first_bind) {
                (Some(s), Some(b)) => s < b,
                (Some(_), None) => true,
                _ => false,
            };
            if !ok {
                failures.push(format!("Disabled without a prior Skip: {seq:?}"));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} failures: {failures:#?}",
        failures.len()
    );
}

#[test]
fn st03_three_production_paths_through_the_shared_state() {
    let run = |events: &[LaunchEvent]| -> McpLaunchStatus {
        let s: SharedMcpLaunchState = Arc::new(Mutex::new(Starting));
        for ev in events {
            record_event(&s, *ev);
        }
        let v = *s.lock().unwrap();
        v
    };
    assert_eq!(run(&[Decided(Skip(SkipReason::Disabled))]), Disabled);
    assert_eq!(
        run(&[Decided(Start(StartReason::Enabled)), BindOk]),
        Running
    );
    assert_eq!(
        run(&[Decided(Start(StartReason::NoConfig)), BindErr]),
        Failed
    );
}

#[test]
fn be01_bind_event_follows_the_result_variant_and_composes_through_apply() {
    let started = apply(Starting, Decided(Start(StartReason::Enabled)));

    let oks = [Ok::<_, String>((55045u16, ())), Ok::<_, String>((0u16, ()))];
    for r in &oks {
        let ev = bind_event(r);
        assert_eq!(ev, BindOk, "row {r:?}");
        assert!(!matches!(ev, Decided(_)));
        assert_eq!(apply(started, ev), Running, "row {r:?}");
    }

    let errs = [
        Err::<(u16, ()), _>("Address already in use (os error 48)".to_string()),
        Err::<(u16, ()), _>(String::new()),
    ];
    for r in &errs {
        let ev = bind_event(r);
        assert_eq!(ev, BindErr, "row {r:?}");
        assert!(!matches!(ev, Decided(_)));
        assert_eq!(apply(started, ev), Failed, "row {r:?}");
    }
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
