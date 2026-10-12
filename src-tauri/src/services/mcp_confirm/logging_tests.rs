//! Redaction and completeness of the `mcp.confirm` log builders (matrix
//! L-1, L-2). The title given to the builders is a sentinel; content, path
//! and token sentinels sit in scope and must never reach a line either.

use std::collections::BTreeSet;

use serde_json::Value;

use super::*;
use crate::models::{LogLevel, LogStatus};
use crate::services::mcp_confirm::payload::{ConfirmMeta, Operation, TableAction};
use crate::services::mcp_confirm::queue::{Cause, Outcome};

const ALLOWLIST: [&str; 7] = [
    "requestId",
    "documentId",
    "windowLabel",
    "operation",
    "queueDepth",
    "outcome",
    "waitedMs",
];
const TITLE: &str = "TITLE-SENTINEL-秘";
const CONTENT: &str = "CONTENT-SENTINEL";
const PATH: &str = "/Users/x/PATH-SENTINEL.md";
const TOKEN: &str = "TOKEN-SENTINEL";

#[derive(Debug, Clone, Copy, PartialEq)]
enum Phase {
    Start,
    End,
    Withdrawn,
}

const PHASES: [Phase; 3] = [Phase::Start, Phase::End, Phase::Withdrawn];
const OPS: [Operation; 3] = [
    Operation::Replace,
    Operation::Insert,
    Operation::Table(TableAction::SetCell),
];
const OUTCOMES: [Outcome; 7] = [
    Outcome::Approved,
    Outcome::Rejected,
    Outcome::TimedOut,
    Outcome::Cancelled(Cause::ServerStop),
    Outcome::Cancelled(Cause::AppExit),
    Outcome::Cancelled(Cause::WindowClosed),
    Outcome::Cancelled(Cause::EmitFailed),
];

fn meta(operation: Operation) -> ConfirmMeta {
    ConfirmMeta {
        document_id: "doc-1".to_string(),
        document_title: TITLE.to_string(),
        operation,
    }
}

fn build(phase: Phase, op: Operation, outcome: Outcome) -> LogEntryPayload {
    let m = meta(op);
    match phase {
        Phase::Start => start_entry("r0", "B", &m, 2),
        Phase::End => end_entry("r0", "B", &m, 2, outcome, 1_234),
        Phase::Withdrawn => withdrawn_entry("r0", "B", &m, 2, 1_234),
    }
}

fn domain() -> Vec<(Phase, Operation, Outcome, LogEntryPayload)> {
    let mut all = Vec::new();
    for phase in PHASES {
        for op in OPS {
            for outcome in OUTCOMES {
                all.push((phase, op, outcome, build(phase, op, outcome)));
            }
        }
    }
    all
}

fn context_keys(entry: &LogEntryPayload) -> BTreeSet<String> {
    entry
        .context
        .as_ref()
        .and_then(Value::as_object)
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default()
}

fn assert_redacted(entry: &LogEntryPayload, label: &str) {
    let line = serde_json::to_string(entry).expect("serializes");
    for sentinel in [
        TITLE,
        "TITLE-SENTINEL",
        CONTENT,
        PATH,
        "PATH-SENTINEL",
        TOKEN,
    ] {
        assert!(!line.contains(sentinel), "{label}: {sentinel} in {line}");
    }
    assert!(!line.contains("documentTitle"), "{label}: {line}");
    for key in context_keys(entry) {
        assert!(ALLOWLIST.contains(&key.as_str()), "{label}: key {key}");
    }
}

#[test]
fn l1_redaction_over_the_whole_domain() {
    let all = domain();
    assert_eq!(all.len(), 63, "phase x operation x outcome");
    for (phase, op, outcome, entry) in &all {
        assert_redacted(entry, &format!("{phase:?}/{op:?}/{outcome:?}"));
    }
}

#[test]
fn l1_fault_entries_are_redacted_too() {
    let m = meta(Operation::Replace);
    assert_redacted(&unavailable_entry("B", &m), "unavailable");
    assert_redacted(&effect_failed_entry("r0", "B", "attention"), "effect");
}

#[test]
fn l2_required_keys_are_present_per_phase() {
    let start_keys = [
        "requestId",
        "documentId",
        "windowLabel",
        "operation",
        "queueDepth",
    ];
    for (phase, op, outcome, entry) in domain() {
        let label = format!("{phase:?}/{op:?}/{outcome:?}");
        let keys = context_keys(&entry);
        for key in start_keys {
            assert!(keys.contains(key), "{label}: missing {key}");
        }
        let ctx = entry.context.clone().expect("context");
        assert_eq!(ctx["requestId"], "r0", "{label}");
        assert_eq!(ctx["windowLabel"], "B", "{label}");
        assert_eq!(ctx["documentId"], "doc-1", "{label}");
        assert_eq!(ctx["queueDepth"], 2, "{label}");
        assert_eq!(entry.event, "mcp.confirm", "{label}");
        assert_eq!(entry.level, LogLevel::Info, "{label}");
        match phase {
            Phase::Start => {
                assert_eq!(entry.status, LogStatus::Start, "{label}");
                assert!(!keys.contains("outcome"), "{label}");
            }
            Phase::End | Phase::Withdrawn => {
                assert!(keys.contains("outcome"), "{label}: missing outcome");
                assert_eq!(ctx["waitedMs"].as_u64(), Some(1_234), "{label}");
                let success = phase == Phase::End && outcome == Outcome::Approved;
                let status = if success {
                    LogStatus::Success
                } else {
                    LogStatus::Fail
                };
                assert_eq!(entry.status, status, "{label}");
            }
        }
    }
}

#[test]
fn l2_outcome_and_operation_values() {
    let m = meta(Operation::Table(TableAction::SetCell));
    let cases = [
        (Outcome::Approved, "approved"),
        (Outcome::Rejected, "rejected"),
        (Outcome::TimedOut, "timedOut"),
        (Outcome::Cancelled(Cause::ServerStop), "cancelled"),
    ];
    for (outcome, wire) in cases {
        let ctx = end_entry("r0", "B", &m, 1, outcome, 0)
            .context
            .expect("ctx");
        assert_eq!(ctx["outcome"], wire);
        assert_eq!(ctx["operation"], "table:set_cell");
    }
    let withdrawn = withdrawn_entry("r0", "B", &m, 1, 0).context.expect("ctx");
    assert_eq!(withdrawn["outcome"], "withdrawn");
    let cancelled = end_entry("r0", "B", &m, 1, Outcome::Cancelled(Cause::AppExit), 0);
    assert_eq!(cancelled.error.as_deref(), Some("appExit"), "cause kept");
}
