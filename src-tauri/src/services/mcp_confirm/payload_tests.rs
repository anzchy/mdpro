//! Wire contract for the confirmation events (matrix P-1, P-2), pinned to
//! `tests/fixtures/mcp-confirm-contract.json`, which the TS side (M-1, CT-1)
//! reads too.

use std::collections::BTreeSet;

use serde_json::Value;

use super::*;
use crate::services::mcp_confirm::queue::{Cause, Outcome};

const CONTRACT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/mcp-confirm-contract.json"
));

fn fixture() -> Value {
    serde_json::from_str(CONTRACT).expect("contract fixture parses")
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("fixture list")
        .iter()
        .map(|v| v.as_str().expect("fixture string").to_string())
        .collect()
}

const ACTIONS: [TableAction; 6] = [
    TableAction::InsertTable,
    TableAction::SetCell,
    TableAction::AddRow,
    TableAction::DeleteRow,
    TableAction::AddColumn,
    TableAction::DeleteColumn,
];

/// Every operation, in the fixture's sample order.
fn operations() -> Vec<Operation> {
    let mut ops = vec![Operation::Replace, Operation::Insert];
    ops.extend(ACTIONS.iter().map(|a| Operation::Table(*a)));
    ops
}

fn meta(operation: Operation) -> ConfirmMeta {
    ConfirmMeta {
        document_id: "doc-1".to_string(),
        document_title: "Notes".to_string(),
        operation,
    }
}

fn keys(value: &Value) -> BTreeSet<String> {
    value.as_object().expect("object").keys().cloned().collect()
}

#[test]
fn p1_request_payload_matches_the_contract_for_every_operation() {
    let fx = fixture();
    let samples = fx["samples"].as_array().expect("samples");
    let ops = operations();
    assert_eq!(ops.len(), 8, "operation domain");
    assert_eq!(samples.len(), ops.len(), "one sample per operation");
    let request_keys: BTreeSet<String> = strings(&fx["$requestKeys"]).into_iter().collect();
    let op_names = strings(&fx["operations"]);
    for (i, op) in ops.iter().enumerate() {
        let value = serde_json::to_value(ConfirmRequestPayload::new("req-1", &meta(*op), 42_000))
            .expect("serializes");
        let mut expected = request_keys.clone();
        if !matches!(op, Operation::Table(_)) {
            expected.remove("action");
        }
        assert_eq!(keys(&value), expected, "keys for {op:?}");
        let name = value["operation"].as_str().expect("operation string");
        assert!(op_names.iter().any(|n| n == name), "{name} not in fixture");
        assert_eq!(&value, &samples[i], "sample {i} ({op:?})");
    }
}

#[test]
fn p1_table_actions_equal_the_contract_actions() {
    let wire: Vec<String> = ACTIONS
        .iter()
        .map(|a| {
            let v = serde_json::to_value(a).expect("serializes");
            v.as_str().expect("action string").to_string()
        })
        .collect();
    assert_eq!(wire, strings(&fixture()["actions"]));
}

#[test]
fn p1_event_names_match_the_contract() {
    let fx = fixture();
    assert_eq!(CONFIRM_REQUEST_EVENT, fx["events"]["request"]);
    assert_eq!(CONFIRM_RESOLVED_EVENT, fx["events"]["resolved"]);
}

/// Forces a compile error when the wire enum gains a variant that this
/// test's domain does not list.
fn in_domain(outcome: ResolvedOutcome) -> ResolvedOutcome {
    match outcome {
        ResolvedOutcome::Approved
        | ResolvedOutcome::Rejected
        | ResolvedOutcome::TimedOut
        | ResolvedOutcome::Cancelled
        | ResolvedOutcome::Withdrawn => outcome,
    }
}

const CAUSES: [Cause; 4] = [
    Cause::ServerStop,
    Cause::AppExit,
    Cause::WindowClosed,
    Cause::EmitFailed,
];

fn resolved_value(outcome: ResolvedOutcome) -> Value {
    let payload = ConfirmResolvedPayload {
        request_id: "req-1".to_string(),
        outcome: in_domain(outcome),
    };
    serde_json::to_value(payload).expect("serializes")
}

#[test]
fn p2_resolved_payload_covers_every_wire_outcome() {
    let fx = fixture();
    let mut domain: Vec<ResolvedOutcome> = vec![
        Outcome::Approved.into(),
        Outcome::Rejected.into(),
        Outcome::TimedOut.into(),
    ];
    domain.extend(
        CAUSES
            .iter()
            .map(|c| ResolvedOutcome::from(Outcome::Cancelled(*c))),
    );
    domain.push(ResolvedOutcome::Withdrawn);
    assert_eq!(domain.len(), 8, "outcome domain");
    let resolved_keys: BTreeSet<String> = strings(&fx["$resolvedKeys"]).into_iter().collect();
    let mut seen = BTreeSet::new();
    for outcome in domain {
        let value = resolved_value(outcome);
        assert_eq!(keys(&value), resolved_keys, "keys for {outcome:?}");
        assert_eq!(value["requestId"], "req-1");
        seen.insert(value["outcome"].as_str().expect("outcome").to_string());
    }
    let expected: BTreeSet<String> = strings(&fx["outcomes"]).into_iter().collect();
    assert_eq!(seen, expected, "wire outcomes both ways");
}

#[test]
fn p2_every_cause_is_cancelled_on_the_wire() {
    for cause in CAUSES {
        let value = resolved_value(Outcome::Cancelled(cause).into());
        assert_eq!(value["outcome"], "cancelled", "{cause:?}");
    }
}
