//! Contract test for the `file:open-in-window` payload (D29 WI-3).
use super::{OpenInWindowPayload, OPEN_IN_WINDOW_EVENT};

#[test]
fn open_in_window_payload_exact_camelcase_json() {
    let payload = OpenInWindowPayload {
        window_label: "mdpro-a".to_string(),
        document_id: "doc-1".to_string(),
        path: "/Users/x/a.md".to_string(),
    };
    assert_eq!(
        serde_json::to_string(&payload).expect("serialize"),
        r#"{"windowLabel":"mdpro-a","documentId":"doc-1","path":"/Users/x/a.md"}"#
    );
}

#[test]
fn open_in_window_event_name_is_pinned() {
    assert_eq!(OPEN_IN_WINDOW_EVENT, "file:open-in-window");
}
