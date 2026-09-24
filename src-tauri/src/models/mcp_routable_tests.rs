//! Specification for the `routable` flag on `SyncDocumentsPayload` (D29 WI-1,
//! ADR-0033): the three input classes, and the IPC trust boundary rejecting a
//! non-boolean value.

use super::*;

fn payload_json(routable: Option<&str>) -> String {
    let tail = routable
        .map(|v| format!(",\"routable\":{}", v))
        .unwrap_or_default();
    format!(
        "{{\"windowLabel\":\"mdpro-a\",\"documents\":[],\"activeDocumentId\":null{}}}",
        tail
    )
}

#[test]
fn sync_payload_routable_true_false_absent() {
    let rows = [(Some("true"), true), (Some("false"), false), (None, false)];
    for (raw, expected) in rows {
        let json = payload_json(raw);
        let parsed: SyncDocumentsPayload = serde_json::from_str(&json)
            .unwrap_or_else(|e| panic!("payload {json} must parse: {e}"));
        assert_eq!(parsed.routable, expected, "payload {json}");
    }
}

#[test]
fn sync_payload_routable_non_bool_rejected() {
    for raw in ["\"yes\"", "1"] {
        let json = payload_json(Some(raw));
        assert!(
            serde_json::from_str::<SyncDocumentsPayload>(&json).is_err(),
            "a non-boolean routable must be rejected: {json}"
        );
    }
}
