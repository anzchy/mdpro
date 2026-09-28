//! Test cases for `services::mcp_controller::serve` (ADR-0040 WI-2: V-1..V-3).
//!
//! Wired from `serve.rs` with `#[cfg(test)] #[path = ...] mod tests;`. Every
//! socket is on `127.0.0.1`; no test binds the app port.

use super::*;
use crate::services::mcp_controller::killable::{default_serve, KillSwitch, KillableListener};
use crate::services::mcp_controller::test_support::{
    connect_refused, hold_port, loopback, raw_get, GENEROUS,
};
use axum::{http::StatusCode, routing::get, Router};
use tokio::sync::oneshot;

/// V-1: an occupied port is `InUse`; an unassignable address is `Other`; an
/// ephemeral bind succeeds with a real port.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn v1_bind_classifies_in_use_and_other() {
    // (a) occupied
    let (_held, p) = hold_port();
    assert_eq!(bind(loopback(p)).await.err(), Some(BindError::InUse));

    // (b) TEST-NET-1 is not assigned locally: EADDRNOTAVAIL.
    let unassignable: SocketAddr = "192.0.2.1:0".parse().unwrap();
    assert_eq!(bind(unassignable).await.err(), Some(BindError::Other));

    // (c) ephemeral
    let listener = bind(loopback(0)).await.expect("ephemeral bind");
    assert_ne!(listener.local_addr().unwrap().port(), 0);
}

/// V-2: graceful shutdown resolves the handle to `Ok(())`, and the port is
/// closed afterwards. Spawns the production serve seam, `default_serve()`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn v2_graceful_shutdown_resolves_ok_and_closes_the_port() {
    let listener = bind(loopback(0)).await.expect("bind");
    let port = listener.local_addr().unwrap().port();
    let router = Router::new().route("/ping", get(|| async { StatusCode::OK }));
    let (tx, rx) = oneshot::channel();
    let serve = default_serve();
    let handle = tokio::spawn(serve(
        KillableListener::new(listener, KillSwitch::new()),
        router,
        rx,
    ));

    assert_eq!(raw_get(port, "/ping", None, GENEROUS).await.unwrap(), 200);

    tx.send(()).unwrap();
    let joined = tokio::time::timeout(GENEROUS, handle).await;
    assert!(
        matches!(joined, Ok(Ok(Ok(())))),
        "handle did not resolve to Ok(()): {joined:?}"
    );
    assert!(
        connect_refused(port),
        "port {port} still accepts after shutdown"
    );
}

/// V-3: an I/O error from serving maps to `Err(ServeError::Io)`, not `Ok`.
#[test]
fn v3_a_serve_io_error_is_not_discarded() {
    assert_eq!(
        map_serve_result(Err(io::Error::other("x"))),
        Err(ServeError::Io)
    );
    assert_eq!(map_serve_result(Ok(())), Ok(()));
}
