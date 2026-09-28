//! Tests R-5b, R-6, R-7 (ADR-0040 WI-8): bounded failure against a closed
//! port, the "not running" contract, and `load_from` input guards.

use std::fs;

use serde_json::Value;

use super::conn_test_support::{
    loopback, remove_dir, scrub, temp_dir, token, write_files, TestServer, GENEROUS,
};
use super::{Conn, ServerConfig, PORT_FILE, TOKEN_FILE};

const STATUS: &str = "/api/status";

fn assert_clean(message: &str, dir: &std::path::Path) {
    let shown = scrub(message, dir);
    assert!(!message.contains("secret"), "token leaked: {shown}");
    let dir_text = dir.to_str().expect("utf-8 temp dir");
    assert!(!message.contains(dir_text), "path leaked: {shown}");
}

// ---- R-5b -------------------------------------------------------------

#[tokio::test]
async fn r5b_closed_port_gives_a_bounded_error_not_a_reconnect_loop() {
    let dir = temp_dir("r5b");
    let q = {
        let l = std::net::TcpListener::bind(loopback(0)).expect("bind :0");
        l.local_addr().expect("local_addr").port()
    };
    write_files(&dir, q, &token('j'));
    let conn = Conn::load_from(&dir).expect("load");

    let got: Result<Value, _> = tokio::time::timeout(GENEROUS, conn.get(STATUS))
        .await
        .expect("GET completes: no reconnect loop");
    let err = got.expect_err("GET to a closed port errors");
    let lower = err.message.to_lowercase();
    assert!(
        lower.contains("not running") || lower.contains("connect"),
        "connection-failure text: {}",
        scrub(&err.message, &dir)
    );
    assert_clean(&err.message, &dir);

    let posted: Result<Value, _> =
        tokio::time::timeout(GENEROUS, conn.post("/api/documents/new", &Value::Null))
            .await
            .expect("POST completes: no reconnect loop");
    let err = posted.expect_err("POST to a closed port errors");
    assert_clean(&err.message, &dir);
    remove_dir(&dir);
}

// ---- R-6 --------------------------------------------------------------

#[tokio::test]
async fn r6_files_missing_at_reload_say_not_running_without_the_token() {
    let dir = temp_dir("r6");
    let t1 = token('k');
    let a = TestServer::start(Some(&t1)).await;
    write_files(&dir, a.port, &t1);
    let conn = Conn::load_from(&dir).expect("load");
    let hits_a = a.hits.clone();
    let before = hits_a.get();
    a.stop().await;
    fs::remove_file(dir.join(PORT_FILE)).expect("rm port");
    fs::remove_file(dir.join(TOKEN_FILE)).expect("rm token");

    let got: Result<Value, _> = tokio::time::timeout(GENEROUS, conn.get(STATUS))
        .await
        .expect("bounded");
    let err = got.expect_err("GET errors");
    assert!(
        err.message.contains("not running"),
        "got: {}",
        scrub(&err.message, &dir)
    );
    assert!(
        !err.message.contains("os error"),
        "raw io text: {}",
        scrub(&err.message, &dir)
    );
    assert_clean(&err.message, &dir);
    assert_eq!(hits_a.get(), before, "A's hits unchanged");
    remove_dir(&dir);
}

// ---- R-7 --------------------------------------------------------------

#[test]
fn r7_load_from_rejects_malformed_ports_without_leaking() {
    for bad in ["abc", "70000", ""] {
        let dir = temp_dir("r7");
        fs::write(dir.join(PORT_FILE), bad).expect("write port");
        fs::write(dir.join(TOKEN_FILE), token('l')).expect("write token");
        let err = match ServerConfig::load_from(&dir) {
            Ok(c) => panic!("port {bad:?} accepted as {}", c.port),
            Err(e) => e,
        };
        assert_clean(&err, &dir);
        remove_dir(&dir);
    }
}

#[test]
fn r7_load_from_trims_a_valid_port() {
    let dir = temp_dir("r7ok");
    fs::write(dir.join(PORT_FILE), " 41234\n").expect("write port");
    fs::write(dir.join(TOKEN_FILE), token('m')).expect("write token");
    let config = ServerConfig::load_from(&dir).expect("valid port loads");
    assert_eq!(config.port, 41234);
    remove_dir(&dir);
}

#[test]
fn r7_load_from_reads_only_the_given_directory() {
    // Valid files sit in the parent; the given (child) dir is empty. A
    // loader that looked anywhere but `dir` itself would succeed.
    let parent = temp_dir("r7scope");
    write_files(&parent, 41235, &token('n'));
    let child = parent.join("empty");
    fs::create_dir_all(&child).expect("mkdir child");

    let err = match ServerConfig::load_from(&child) {
        Ok(c) => panic!("loaded port {} from outside the dir", c.port),
        Err(e) => e,
    };
    assert!(err.contains("not running"), "got: {}", scrub(&err, &child));
    assert_clean(&err, &child);
    let conn_err = Conn::load_from(&child).err().expect("Conn load fails too");
    assert!(
        conn_err.contains("not running"),
        "got: {}",
        scrub(&conn_err, &child)
    );
    remove_dir(&parent);
}
