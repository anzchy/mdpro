//! D153: an MCP write that Rust schedules and the frontend applies logs two
//! lines under one event name (`mcp.table.<action>`, `mcp.insert`). The Rust
//! line says `stage: "scheduled"` and carries one action id minted per
//! request; the same id rides on the emitted payload as `action_id`, so the
//! frontend's `stage: "applied"` line joins it.
//!
//! Wired from `http_server.rs` with `#[cfg(test)] #[path = ...]`, so
//! `http_server.rs` does not grow. The handlers themselves need an
//! `AppHandle` (the Tauri `test` feature is not enabled), so these pin the
//! builders the handlers call: the payload builder and the log builder.

use super::{scheduled_entry, table_action_event};
use crate::models::{InsertContentEvent, InsertPosition, LogLevel, LogStatus};
use crate::services::mcp_confirm::payload::TableAction;
use serde_json::{json, Value};

const ID: &str = "8f6c1b2e-0000-4000-8000-000000000153";

#[test]
fn s1_table_action_payload_carries_the_action_id_under_its_snake_case_key() {
    let event = table_action_event(
        "doc-1",
        TableAction::SetCell,
        json!({ "row": 1, "col": 0, "content": "Q" }),
        Some("main".to_string()),
        ID,
    );
    let wire = serde_json::to_value(&event).expect("serializes");
    assert_eq!(
        wire,
        json!({
            "document_id": "doc-1",
            "action": "set_cell",
            "payload": { "row": 1, "col": 0, "content": "Q" },
            "window_label": "main",
            "action_id": ID,
        })
    );
}

#[test]
fn s2_insert_content_payload_carries_the_action_id_under_its_snake_case_key() {
    let event = InsertContentEvent {
        document_id: "doc-1".to_string(),
        text: "X".to_string(),
        position: InsertPosition::End,
        window_label: None,
        action_id: ID.to_string(),
    };
    let wire = serde_json::to_value(&event).expect("serializes");
    assert_eq!(wire["action_id"], json!(ID));
    assert_eq!(wire["document_id"], json!("doc-1"));
    assert_eq!(wire["position"], json!("end"));
}

#[test]
fn s3_the_scheduled_success_line_carries_stage_scheduled_and_the_action_id() {
    let entry = scheduled_entry(
        LogLevel::Info,
        "mcp.table.set_cell",
        LogStatus::Success,
        ID,
        json!({ "documentId": "doc-1" }),
        None,
    );
    assert_eq!(entry.event, "mcp.table.set_cell");
    assert_eq!(entry.status, LogStatus::Success);
    assert_eq!(entry.level, LogLevel::Info);
    assert_eq!(entry.action_id.as_deref(), Some(ID));
    assert_eq!(
        entry.context,
        Some(json!({ "documentId": "doc-1", "stage": "scheduled" }))
    );
    assert_eq!(entry.error, None);
}

#[test]
fn s4_the_scheduled_line_keeps_every_other_context_key_and_the_error() {
    let entry = scheduled_entry(
        LogLevel::Error,
        "mcp.insert",
        LogStatus::Fail,
        ID,
        json!({ "documentId": "doc-1", "reason": "emit failed" }),
        Some("boom".to_string()),
    );
    assert_eq!(entry.action_id.as_deref(), Some(ID));
    assert_eq!(
        entry.context,
        Some(json!({ "documentId": "doc-1", "reason": "emit failed", "stage": "scheduled" }))
    );
    assert_eq!(entry.error.as_deref(), Some("boom"));
}

#[test]
fn s5_the_log_line_and_the_payload_share_one_id_and_the_log_wire_key_is_action_id_camel() {
    let event = table_action_event("doc-1", TableAction::AddRow, json!({}), None, ID);
    let entry = scheduled_entry(
        LogLevel::Info,
        "mcp.table.add_row",
        LogStatus::Success,
        ID,
        json!({ "documentId": "doc-1" }),
        None,
    );
    let event_wire = serde_json::to_value(&event).expect("serializes");
    let log_wire: Value = serde_json::to_value(&entry).expect("serializes");
    assert_eq!(event_wire["action_id"], log_wire["actionId"]);
    assert_eq!(log_wire["context"]["stage"], json!("scheduled"));
}

#[test]
fn s6_a_non_object_context_is_wrapped_rather_than_dropped() {
    let entry = scheduled_entry(
        LogLevel::Info,
        "mcp.insert",
        LogStatus::Success,
        ID,
        Value::Null,
        None,
    );
    assert_eq!(entry.context, Some(json!({ "stage": "scheduled" })));
}
