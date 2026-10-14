//! D161: `POST /api/documents/new` names one owner window on its
//! `mcp:create_document` payload, so only that window opens the tab.
//!
//! The handler needs an `AppHandle` (the Tauri `test` feature is not enabled),
//! so these pin the function it calls, at function level.

use super::create_document_event;
use crate::models::mcp::WindowState;
use crate::models::ShadowStore;

const ID: &str = "8f6c1b2e-0000-4000-8000-000000000161";

fn window(label: &str, last_focused_at: i64) -> WindowState {
    WindowState {
        label: label.to_string(),
        documents: Vec::new(),
        active_document_id: None,
        last_focused_at,
        routable: true,
    }
}

fn store(windows: &[(&str, i64)], focused: Option<&str>) -> ShadowStore {
    ShadowStore {
        windows: windows
            .iter()
            .map(|(label, at)| (label.to_string(), window(label, *at)))
            .collect(),
        focused_window: focused.map(str::to_string),
    }
}

fn label_of(store: &ShadowStore) -> Option<Option<String>> {
    create_document_event(store, "doc-new", "body".to_string(), ID).map(|e| e.window_label)
}

#[test]
fn c1_the_focused_window_owns_the_new_document() {
    let s = store(&[("main", 300), ("window-2", 100)], Some("window-2"));
    assert_eq!(label_of(&s), Some(Some("window-2".to_string())));
}

#[test]
fn c2_with_no_window_focused_the_most_recently_focused_one_owns_it() {
    let s = store(&[("main", 100), ("window-2", 300), ("window-3", 200)], None);
    assert_eq!(label_of(&s), Some(Some("window-2".to_string())));
}

#[test]
fn c3_a_focused_label_whose_window_is_gone_falls_back_to_the_most_recent() {
    let s = store(&[("main", 300), ("window-2", 100)], Some("window-9"));
    assert_eq!(label_of(&s), Some(Some("main".to_string())));
}

#[test]
fn c4_with_no_window_registered_there_is_no_event() {
    let s = store(&[], None);
    assert_eq!(label_of(&s), None);
}

#[test]
fn c5_a_single_window_owns_it_and_the_payload_keeps_id_content_and_action_id() {
    let s = store(&[("main", 1)], None);
    let event = create_document_event(&s, "doc-new", "body".to_string(), ID).expect("an event");
    let wire = serde_json::to_value(&event).expect("serializes");
    assert_eq!(
        wire,
        serde_json::json!({
            "document_id": "doc-new",
            "content": "body",
            "window_label": "main",
            "action_id": ID,
        })
    );
}

// The handler answers 503 with this body and logs this line, and emits
// nothing, when `create_document_event` gives `None` (c4). Pinned at function
// level: the handler itself needs an `AppHandle`.

#[test]
fn c6_the_no_window_refusal_body_carries_the_no_window_code() {
    let wire = serde_json::to_value(super::no_window_error()).expect("serializes");
    assert_eq!(wire["code"], serde_json::json!("NO_WINDOW"));
    assert!(wire["error"].as_str().is_some_and(|e| !e.is_empty()));
}

#[test]
fn c7_the_no_window_line_is_a_scheduled_warning_with_the_ids_and_no_content() {
    use crate::models::{LogLevel, LogStatus};
    let entry = super::no_window_entry(ID, "doc-new");
    assert_eq!(entry.event, "mcp.create");
    assert_eq!(entry.level, LogLevel::Warn);
    assert_eq!(entry.status, LogStatus::Fail);
    assert_eq!(entry.action_id.as_deref(), Some(ID));
    assert_eq!(
        entry.context,
        Some(
            serde_json::json!({ "documentId": "doc-new", "reason": "no window", "stage": "scheduled" })
        )
    );
    assert_eq!(entry.error, None);
}
