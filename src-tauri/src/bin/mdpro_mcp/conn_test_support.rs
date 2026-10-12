//! Purpose: `#[cfg(test)]` support for the sidecar `conn` tests (ADR-0040 WI-8).
//!
//! Key decisions:
//! - Every directory comes from `temp_dir`, which asserts it is under
//!   `std::env::temp_dir()` and does not name `Application Support` before
//!   anything touches it. Nothing here calls `dirs::data_dir()`, so no test
//!   can reach a real `server.token`.
//! - The test server is a small axum router: one hit counter per method, a
//!   fixed expected token (or none, meaning "always 401"), bound to loopback.
//! - `stop` shuts the server down gracefully and awaits its task, so the
//!   port is closed when it returns.
//! - A failure message never echoes a token or the temp dir: error text is
//!   printed only through `scrub` / `outcome`.

use std::fs;
use std::future::Future;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, Method as HttpMethod, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use rmcp::model::ErrorData;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::{PORT_FILE, TOKEN_FILE};

/// The only wall-clock bound for "completes at all" assertions.
pub(super) const GENEROUS: Duration = Duration::from_secs(10);
/// The real app's MCP port; a test must never bind it.
const APP_PORT: u16 = 55045;

/// A 64-char token whose first six chars are `secret`, so a leak is easy to
/// spot in an error message.
pub(super) fn token(tag: char) -> String {
    format!("secret{}", tag.to_string().repeat(58))
}

/// A fresh directory `temp_dir()/mdpro-mcpconn-{label}-{uuid}`, created,
/// and guarded against pointing anywhere but the temp dir.
pub(super) fn temp_dir(label: &str) -> PathBuf {
    let tmp = std::env::temp_dir();
    let dir = tmp.join(format!("mdpro-mcpconn-{label}-{}", uuid::Uuid::new_v4()));
    assert!(dir.starts_with(&tmp), "{dir:?} is not under {tmp:?}");
    assert!(!dir.to_string_lossy().contains("Application Support"));
    fs::create_dir_all(&dir).expect("create test dir");
    dir
}

/// Best-effort removal of a `temp_dir` directory.
pub(super) fn remove_dir(dir: &Path) {
    assert!(dir.starts_with(std::env::temp_dir()));
    let _ = fs::remove_dir_all(dir);
}

/// Write `server.port` and `server.token` into `dir`.
pub(super) fn write_files(dir: &Path, port: u16, token: &str) {
    fs::write(dir.join(PORT_FILE), port.to_string()).expect("write port");
    fs::write(dir.join(TOKEN_FILE), token).expect("write token");
}

/// `message` made safe for a failure message: `dir` becomes `<dir>` and
/// every test token (`secret` plus its alphanumeric tail) becomes `<token>`.
pub(super) fn scrub(message: &str, dir: &Path) -> String {
    let text = match dir.to_str() {
        Some(d) => message.replace(d, "<dir>"),
        None => message.to_string(),
    };
    let mut out = String::with_capacity(text.len());
    let mut rest = text.as_str();
    while let Some(i) = rest.find("secret") {
        out.push_str(&rest[..i]);
        out.push_str("<token>");
        rest = rest[i + "secret".len()..].trim_start_matches(|c: char| c.is_ascii_alphanumeric());
    }
    out.push_str(rest);
    out
}

/// A call result for a failure message: `ok`, or its scrubbed error text.
pub(super) fn outcome<T>(result: &Result<T, ErrorData>, dir: &Path) -> String {
    match result {
        Ok(_) => "ok".to_string(),
        Err(e) => format!("err: {}", scrub(&e.message, dir)),
    }
}

/// Per-method hit counters of one test server.
#[derive(Default)]
pub(super) struct Hits {
    pub(super) get: AtomicUsize,
    pub(super) post: AtomicUsize,
}

impl Hits {
    pub(super) fn get(&self) -> usize {
        self.get.load(Ordering::SeqCst)
    }
    pub(super) fn post(&self) -> usize {
        self.post.load(Ordering::SeqCst)
    }
}

#[derive(Clone)]
struct ServerState {
    hits: Arc<Hits>,
    /// `None`: answer every request with 401.
    token: Option<String>,
    /// `Some`: an authorized request gets this status and JSON body.
    answer: Option<(StatusCode, serde_json::Value)>,
}

async fn handle(
    State(state): State<ServerState>,
    method: HttpMethod,
    headers: HeaderMap,
) -> Response {
    if method == HttpMethod::POST {
        state.hits.post.fetch_add(1, Ordering::SeqCst);
    } else {
        state.hits.get.fetch_add(1, Ordering::SeqCst);
    }
    let sent = headers.get("X-MDPRO-Token").and_then(|v| v.to_str().ok());
    match (&state.token, sent) {
        (Some(expected), Some(sent)) if expected == sent => match &state.answer {
            Some((status, body)) => (*status, Json(body.clone())).into_response(),
            None => Json(serde_json::json!({ "ok": true })).into_response(),
        },
        _ => (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
    }
}

/// A running test server.
pub(super) struct TestServer {
    pub(super) port: u16,
    pub(super) hits: Arc<Hits>,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl TestServer {
    /// Serve on `listener`. `token == None` answers everything with 401.
    pub(super) fn serve(listener: TcpListener, token: Option<&str>) -> Self {
        Self::serve_answering(listener, token, None)
    }

    /// Serve on `listener`; an authorized request gets `answer` when set.
    fn serve_answering(
        listener: TcpListener,
        token: Option<&str>,
        answer: Option<(StatusCode, serde_json::Value)>,
    ) -> Self {
        let port = listener.local_addr().expect("local_addr").port();
        assert_ne!(port, APP_PORT, "a test must never bind the app port");
        let hits = Arc::new(Hits::default());
        let state = ServerState {
            hits: hits.clone(),
            token: token.map(str::to_string),
            answer,
        };
        let app = Router::new().fallback(handle).with_state(state);
        let (tx, rx) = oneshot::channel::<()>();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await;
        });
        Self {
            port,
            hits,
            shutdown: Some(tx),
            task,
        }
    }

    /// Bind `127.0.0.1:0` and serve.
    pub(super) async fn start(token: Option<&str>) -> Self {
        let listener = TcpListener::bind(loopback(0)).await.expect("bind :0");
        Self::serve(listener, token)
    }

    /// Bind `127.0.0.1:0`; every authorized request gets `status` + `body`.
    pub(super) async fn start_answering(
        token: &str,
        status: StatusCode,
        body: serde_json::Value,
    ) -> Self {
        let listener = TcpListener::bind(loopback(0)).await.expect("bind :0");
        Self::serve_answering(listener, Some(token), Some((status, body)))
    }

    /// Shut down gracefully and wait until the task (and listener) is gone.
    pub(super) async fn stop(mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        tokio::time::timeout(GENEROUS, &mut self.task)
            .await
            .expect("test server stops in time")
            .expect("test server task");
    }
}

/// `127.0.0.1:port`.
pub(super) fn loopback(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

/// Returned by a `with_free_port` scenario iff its setup bind collided.
#[derive(Debug)]
pub(super) struct SetupCollision;

/// A port that was free a moment ago.
fn fixed_port() -> u16 {
    let listener = std::net::TcpListener::bind(loopback(0)).expect("bind :0");
    let port = listener.local_addr().expect("local_addr").port();
    assert_ne!(port, APP_PORT);
    port
}

/// Run `scenario` on a free port, retrying the whole scenario once with a
/// new port if its setup bind collided. A second collision fails the test.
pub(super) async fn with_free_port<F, Fut>(scenario: F)
where
    F: Fn(u16) -> Fut,
    Fut: Future<Output = Result<(), SetupCollision>>,
{
    if scenario(fixed_port()).await.is_ok() {
        return;
    }
    if scenario(fixed_port()).await.is_err() {
        panic!("fixed_port TOCTOU: port taken twice by another process");
    }
}
