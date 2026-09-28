//! Tests R-1..R-5 (ADR-0040 WI-8): `retry_decision` and `Conn` reload/retry
//! against real loopback axum servers.

use serde_json::Value;
use tokio::net::TcpListener;

use super::conn_test_support::{
    loopback, outcome, remove_dir, scrub, temp_dir, token, with_free_port, write_files,
    SetupCollision, TestServer, GENEROUS,
};
use super::{retry_decision, Conn, Decision, Failure, Method};

const STATUS: &str = "/api/status";
const NEW_DOC: &str = "/api/documents/new";

fn body() -> Value {
    serde_json::json!({ "content": "x" })
}

// ---- R-1 --------------------------------------------------------------

#[test]
fn r1_retry_decision_matches_the_hand_written_table() {
    use Decision::*;
    use Failure::*;
    use Method::*;
    let table: [(Method, Failure, u32, Decision); 12] = [
        (Get, Unauthorized, 0, ReloadAndRetry),
        (Get, Connect, 0, ReloadAndRetry),
        (Get, Other, 0, Fail),
        (Get, Unauthorized, 1, Fail),
        (Get, Connect, 1, Fail),
        (Get, Other, 1, Fail),
        (Post, Unauthorized, 0, ReloadOnly),
        (Post, Connect, 0, ReloadOnly),
        (Post, Other, 0, Fail),
        (Post, Unauthorized, 1, ReloadOnly),
        (Post, Connect, 1, ReloadOnly),
        (Post, Other, 1, Fail),
    ];
    let mismatches: Vec<_> = table
        .iter()
        .filter(|(m, f, a, want)| retry_decision(*m, *f, *a) != *want)
        .map(|(m, f, a, want)| (*m, *f, *a, *want, retry_decision(*m, *f, *a)))
        .collect();
    assert!(
        mismatches.is_empty(),
        "(m, f, attempt, want, got): {mismatches:?}"
    );
}

#[test]
fn r1_laws_post_never_retries_and_attempt_one_never_retries() {
    for m in [Method::Get, Method::Post] {
        for f in [Failure::Unauthorized, Failure::Connect, Failure::Other] {
            for a in [0u32, 1, 2] {
                let d = retry_decision(m, f, a);
                if m == Method::Post {
                    assert_ne!(d, Decision::ReloadAndRetry, "safety: {m:?} {f:?} {a}");
                }
                if a >= 1 {
                    assert_ne!(d, Decision::ReloadAndRetry, "termination: {m:?} {f:?} {a}");
                }
            }
        }
    }
}

// ---- R-2 --------------------------------------------------------------

#[tokio::test]
async fn r2_get_after_restart_on_new_port_succeeds_with_one_retry() {
    let dir = temp_dir("r2");
    let (t1, t2) = (token('a'), token('b'));
    let a = TestServer::start(Some(&t1)).await;
    write_files(&dir, a.port, &t1);
    let conn = Conn::load_from(&dir).expect("load");

    let first: Result<Value, _> = conn.get(STATUS).await;
    assert!(first.is_ok(), "first GET: {}", outcome(&first, &dir));
    assert_eq!(a.hits.get(), 1);

    a.stop().await;
    let b = TestServer::start(Some(&t2)).await;
    write_files(&dir, b.port, &t2);

    let second: Result<Value, _> = tokio::time::timeout(GENEROUS, conn.get(STATUS))
        .await
        .expect("bounded");
    assert!(
        second.is_ok(),
        "GET after restart: {}",
        outcome(&second, &dir)
    );
    assert_eq!(b.hits.get(), 1, "B served exactly one request for the call");
    b.stop().await;
    remove_dir(&dir);
}

// ---- R-3 --------------------------------------------------------------

#[tokio::test]
async fn r3_get_after_restart_on_same_port_gets_401_then_retries() {
    with_free_port(|p| async move {
        let dir = temp_dir("r3");
        let (t1, t2) = (token('c'), token('d'));
        let Ok(listener) = TcpListener::bind(loopback(p)).await else {
            remove_dir(&dir);
            return Err(SetupCollision);
        };
        let a = TestServer::serve(listener, Some(&t1));
        write_files(&dir, p, &t1);
        let conn = Conn::load_from(&dir).expect("load");
        a.stop().await;

        let rebound = TcpListener::bind(loopback(p))
            .await
            .expect("rebind same port");
        let b = TestServer::serve(rebound, Some(&t2));
        write_files(&dir, p, &t2);

        let got: Result<Value, _> = tokio::time::timeout(GENEROUS, conn.get(STATUS))
            .await
            .expect("bounded");
        assert!(
            got.is_ok(),
            "GET after token change: {}",
            outcome(&got, &dir)
        );
        assert_eq!(b.hits.get(), 2, "one 401, then one 200");
        b.stop().await;
        remove_dir(&dir);
        Ok(())
    })
    .await;
}

// ---- R-4 --------------------------------------------------------------

#[tokio::test]
async fn r4_post_after_token_change_fails_once_is_not_replayed_then_succeeds() {
    with_free_port(|p| async move {
        let dir = temp_dir("r4");
        let (t1, t2) = (token('e'), token('f'));
        let Ok(listener) = TcpListener::bind(loopback(p)).await else {
            remove_dir(&dir);
            return Err(SetupCollision);
        };
        let a = TestServer::serve(listener, Some(&t1));
        write_files(&dir, p, &t1);
        let conn = Conn::load_from(&dir).expect("load");
        a.stop().await;

        let rebound = TcpListener::bind(loopback(p))
            .await
            .expect("rebind same port");
        let b = TestServer::serve(rebound, Some(&t2));
        write_files(&dir, p, &t2);

        let first: Result<Value, _> = tokio::time::timeout(GENEROUS, conn.post(NEW_DOC, &body()))
            .await
            .expect("bounded");
        let err = first.expect_err("first POST errors");
        assert!(
            !err.message.contains("secret"),
            "no token in: {}",
            scrub(&err.message, &dir)
        );
        assert_eq!(b.hits.post(), 1, "the 401 attempt only, not replayed");

        let second: Result<Value, _> = conn.post(NEW_DOC, &body()).await;
        assert!(second.is_ok(), "next POST: {}", outcome(&second, &dir));
        assert_eq!(b.hits.post(), 2);
        b.stop().await;
        remove_dir(&dir);
        Ok(())
    })
    .await;
}

#[tokio::test]
async fn r4_variant_post_after_restart_on_new_port_is_not_replayed() {
    let dir = temp_dir("r4v");
    let (t1, t2) = (token('g'), token('h'));
    let a = TestServer::start(Some(&t1)).await;
    write_files(&dir, a.port, &t1);
    let conn = Conn::load_from(&dir).expect("load");
    a.stop().await;
    let b = TestServer::start(Some(&t2)).await;
    write_files(&dir, b.port, &t2);

    let first: Result<Value, _> = tokio::time::timeout(GENEROUS, conn.post(NEW_DOC, &body()))
        .await
        .expect("bounded");
    let err = first.expect_err("first POST errors");
    assert!(
        !err.message.contains("secret"),
        "no token in: {}",
        scrub(&err.message, &dir)
    );
    assert_eq!(b.hits.post(), 0, "not replayed against B");

    let second: Result<Value, _> = conn.post(NEW_DOC, &body()).await;
    assert!(second.is_ok(), "next POST: {}", outcome(&second, &dir));
    assert_eq!(b.hits.post(), 1);
    b.stop().await;
    remove_dir(&dir);
}

// ---- R-5 --------------------------------------------------------------

#[tokio::test]
async fn r5_always_401_stops_get_after_exactly_two_attempts() {
    let dir = temp_dir("r5");
    let t = token('i');
    let c = TestServer::start(None).await;
    write_files(&dir, c.port, &t);
    let conn = Conn::load_from(&dir).expect("load");

    let got: Result<Value, _> = tokio::time::timeout(GENEROUS, conn.get(STATUS))
        .await
        .expect("bounded");
    let err = got.expect_err("GET errors");
    assert!(
        !err.message.contains("secret"),
        "no token in: {}",
        scrub(&err.message, &dir)
    );
    assert_eq!(c.hits.get(), 2, "exactly two attempts, not one, not three");

    let posted: Result<Value, _> = tokio::time::timeout(GENEROUS, conn.post(NEW_DOC, &body()))
        .await
        .expect("bounded");
    assert!(posted.is_err());
    assert_eq!(c.hits.post(), 1, "POST is never replayed");
    c.stop().await;
    remove_dir(&dir);
}
