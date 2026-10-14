//! D98-WI-2 (audit b122 H1): `get_open_documents` relays the app's document
//! list through the sidecar's own `DocumentInfo`, which dropped `over_limit`,
//! so a client never saw which document MCP refuses. The field round-trips,
//! and defaults to absent so a new sidecar still reads an older app.

use super::DocumentInfo;

#[test]
fn i1_over_limit_survives_the_sidecar_round_trip() {
    let app = r#"{"id":"big","title":"big.md","path":null,"is_dirty":true,"over_limit":true}"#;
    let info: DocumentInfo = serde_json::from_str(app).expect("parses");
    let relayed = serde_json::to_value(&info).expect("serializes");
    assert_eq!(relayed["over_limit"], serde_json::json!(true));
}

#[test]
fn i2_an_older_app_without_the_field_still_parses_and_relays_no_flag() {
    let app = r#"{"id":"a","title":"a.md","path":"/a.md","is_dirty":false}"#;
    let info: DocumentInfo = serde_json::from_str(app).expect("parses");
    let relayed = serde_json::to_value(&info).expect("serializes");
    assert!(relayed.get("over_limit").is_none());
    assert_eq!(relayed["id"], serde_json::json!("a"));
}
