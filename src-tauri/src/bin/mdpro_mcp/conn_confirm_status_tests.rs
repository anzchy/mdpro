//! C-1 (ADR-0042 WI-5, contract): the statuses the write gate can now
//! return (403, 404, 408, 503) fail a POST once, never replayed, with the
//! status and the code passed through to the MCP client.

use axum::http::StatusCode;
use serde_json::Value;

use super::conn_test_support::{outcome, remove_dir, temp_dir, token, write_files, TestServer};
use super::Conn;

const DOC: &str = "/api/documents/d";

#[tokio::test]
async fn c1_new_gate_statuses_fail_once_and_pass_through() {
    let cases = [
        (StatusCode::FORBIDDEN, "USER_REJECTED"),
        (StatusCode::NOT_FOUND, "NOT_FOUND"),
        (StatusCode::REQUEST_TIMEOUT, "CONFIRM_TIMEOUT"),
        (StatusCode::SERVICE_UNAVAILABLE, "CONFIRM_CANCELLED"),
    ];
    assert_eq!(cases.len(), 4);
    for (status, code) in cases {
        let dir = temp_dir("c1");
        let t = token('e');
        let body = serde_json::json!({ "error": "gate said no", "code": code });
        let server = TestServer::start_answering(&t, status, body).await;
        write_files(&dir, server.port, &t);
        let conn = Conn::load_from(&dir).expect("load");

        let got: Result<Value, _> = conn.post(DOC, &serde_json::json!({ "content": "x" })).await;
        let shown = outcome(&got, &dir);
        let err = got.expect_err("a non-2xx POST fails");
        let s = status.as_u16();
        assert!(err.message.contains(&format!("HTTP {s}")), "{s}: {shown}");
        assert!(err.message.contains(code), "{s}: {shown}");
        assert_eq!(server.hits.post(), 1, "{s}: a POST is never replayed");
        server.stop().await;
        remove_dir(&dir);
    }
}
