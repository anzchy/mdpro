//! Test cases for `http_server::with_token_auth` and a failed publish
//! (ADR-0040 WI-2: A-1, A-1b, A-2, A-3). A-4 is the unchanged `mod tests`
//! block in `http_server.rs`. WI-5 deleted `serve::start_server_in`: A-3 now
//! drives the controller's start, and A-3b / A-3c were deleted as duplicates
//! of the controller's bind-failure and start cases (C-3, C-1).
//!
//! Wired from `http_server.rs` with `#[cfg(test)] #[path = ...]`, so
//! `http_server.rs` does not grow. Real axum on `127.0.0.1`, real reqwest;
//! every files dir comes from `temp_files_dir` (guarded under `temp_dir()`).

use super::{token_matches, with_token_auth};
use crate::models::{ServerConfig, SharedServerConfig};
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::files::{PORT_FILE, TOKEN_FILE};
use crate::services::mcp_controller::killable::{default_serve, KillSwitch, KillableListener};
use crate::services::mcp_controller::serve;
use crate::services::mcp_controller::snapshot::McpServerError;
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{
    connect_refused, loopback, raw_get, remove_test_dir, temp_files_dir, test_env, wait_until,
    with_free_port, SetupCollision, GENEROUS,
};
use axum::{http::StatusCode, routing::get, Router};
use std::fs;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

fn config_of(token: Option<&str>) -> SharedServerConfig {
    Arc::new(Mutex::new(token.map(|t| ServerConfig {
        port: 0,
        token: t.to_string(),
    })))
}

fn set_token(config: &SharedServerConfig, token: Option<&str>) {
    *config.lock().unwrap() = token.map(|t| ServerConfig {
        port: 0,
        token: t.to_string(),
    });
}

/// `/t -> 200` behind `with_token_auth` on `config`.
fn guarded_router(config: SharedServerConfig) -> Router {
    with_token_auth(
        Router::new().route("/t", get(|| async { StatusCode::OK })),
        config,
    )
}

/// Serve `guarded_router(config)` on an ephemeral port.
async fn serve_guarded(config: SharedServerConfig) -> (u16, oneshot::Sender<()>) {
    let listener = serve::bind(loopback(0)).await.expect("bind");
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = oneshot::channel();
    let listener = KillableListener::new(listener, KillSwitch::new());
    let _handle = tokio::spawn(default_serve()(listener, guarded_router(config), rx));
    (port, tx)
}

async fn status(port: u16, token: Option<&str>) -> u16 {
    raw_get(port, "/t", token, GENEROUS).await.expect("request")
}

/// A-1: exact match only, over a partition of near-misses (wire level).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a1_only_the_exact_token_passes() {
    let t = format!("{}b", "a".repeat(63));
    let (port, _tx) = serve_guarded(config_of(Some(&t))).await;

    let rows: Vec<(&str, Option<String>, u16)> = vec![
        ("absent", None, 401),
        ("empty", Some(String::new()), 401),
        ("exact", Some(t.clone()), 200),
        ("prefix", Some(t[..63].to_string()), 401),
        ("extension", Some(format!("{t}b")), 401),
        ("last byte differs", Some("a".repeat(64)), 401),
        ("uppercase", Some(t.to_uppercase()), 401),
    ];
    let mut got = Vec::new();
    for (name, header, _) in &rows {
        got.push((*name, status(port, header.as_deref()).await));
    }
    let want: Vec<(&str, u16)> = rows.iter().map(|(n, _, s)| (*n, *s)).collect();
    assert_eq!(got, want);
}

/// A-1b: the whitespace row of A-1, on the predicate the middleware uses.
/// HTTP/1.1 parsers strip leading/trailing OWS from header values, so a
/// padded token cannot reach the middleware over the wire; the row is pinned
/// one level down instead.
#[test]
fn a1b_the_predicate_is_byte_exact_and_rejects_none() {
    let t = format!("{}b", "a".repeat(63));
    assert!(token_matches(Some(&t), Some(&t)));
    assert!(!token_matches(Some(&format!(" {t}")), Some(&t)));
    assert!(!token_matches(Some(&format!("{t} ")), Some(&t)));
    assert!(!token_matches(None, Some(&t)));
    assert!(!token_matches(Some(&t), None));
    assert!(!token_matches(None, None));
}

/// A-2: rotating or clearing the shared config takes effect on the next
/// request.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a2_rotation_and_clearing_apply_to_the_next_request() {
    let config = config_of(Some("T1"));
    let (port, _tx) = serve_guarded(config.clone()).await;

    let mut got = vec![status(port, Some("T1")).await];
    set_token(&config, Some("T2"));
    got.push(status(port, Some("T1")).await);
    got.push(status(port, Some("T2")).await);
    set_token(&config, None);
    got.push(status(port, Some("T2")).await);
    got.push(status(port, Some("")).await);

    assert_eq!(got, vec![200, 401, 200, 401, 401]);
}

/// A-3: a publish failure shuts the spawned server down, leaves no
/// `server.port`, and clears the in-memory token. ADR-0040 WI-5 migrated it
/// from the deleted `serve::start_server_in` to the controller's start; the
/// assertions are unchanged.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a3_a_publish_failure_leaves_no_listener_no_port_file_no_token() {
    with_free_port(|p| async move {
        let dir = temp_files_dir("a3");
        fs::create_dir_all(dir.join(TOKEN_FILE)).unwrap(); // obstacle
        let controller = McpController::new(test_env(&dir, loopback(p)));
        let config = controller.shared_config();

        let result = controller.start(plain()).await.expect("snapshot");
        match result.error {
            Some(McpServerError::BindInUse) => {
                remove_test_dir(&dir);
                return Err(SetupCollision);
            }
            Some(McpServerError::PublishFailed) => {}
            other => panic!("expected a PublishFailed kind, got {other:?}"),
        }

        assert!(
            wait_until(GENEROUS, || connect_refused(p)).await,
            "port {p} still accepts after a failed publish"
        );
        assert!(!dir.join(PORT_FILE).exists(), "server.port left behind");
        assert!(config.lock().unwrap().is_none(), "in-memory token left set");
        std::net::TcpListener::bind(loopback(p)).expect("port is free again");
        remove_test_dir(&dir);
        Ok(())
    })
    .await;
}
