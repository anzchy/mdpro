//! Purpose: shared `#[cfg(test)]` support for the `mcp_controller` tests.
//!
//! Key decisions:
//! - Every test directory comes from `temp_files_dir`, which runs the
//!   `assert_test_dir` guard before returning. A path outside
//!   `std::env::temp_dir()`, or one that names `Application Support`, panics
//!   before any test can touch it, so no test can reach the real
//!   `server.token` of a running app.
//! - Nothing here calls `dirs::data_dir()`.
//! - Occupied ports come from `hold_port`, which keeps its listener, so there
//!   is no release window. `fixed_port` releases one and is used only through
//!   `with_free_port`, which retries a whole scenario once on a setup-step
//!   `BindInUse` and never on an asserted step.
//! - Tests never bind 55045 (the real app's port).
//! - `force_logger_on` / `start_lines` read the launch log lines of a temp
//!   `$HOME` (WI-5, L-3); the caller holds the `TestHome`.
//! - `test_env` gives the controller short, named budgets (WI-3); the
//!   routers and serve wrappers the controller cases use live in
//!   `test_routers.rs`.

use crate::models::{LogLevel, LogSettings};
use crate::services::logger;
use crate::services::mcp_controller::controller::ControllerEnv;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::future::Future;
use std::net::{SocketAddr, TcpListener as StdListener, TcpStream};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// The only wall-clock bound for "returns within budget" assertions.
pub(crate) const GENEROUS: Duration = Duration::from_secs(10);
/// The real app's MCP port; a test must never bind it.
const APP_PORT: u16 = 55045;
/// How long `connect_refused` waits for a connection attempt.
const CONNECT_PROBE: Duration = Duration::from_millis(500);
/// Poll interval for `wait_until`.
const POLL_INTERVAL: Duration = Duration::from_millis(20);
/// The controller budgets tests run with.
pub(crate) const TEST_DRAIN: Duration = Duration::from_millis(200);
pub(crate) const TEST_JOIN_GRACE: Duration = Duration::from_millis(200);
pub(crate) const TEST_EXIT_BUDGET: Duration = Duration::from_secs(1);

/// A `ControllerEnv` on `bind_addr` publishing into `dir`, with the short
/// test budgets and the real serve seam. `dir` is guarded first.
pub(crate) fn test_env(dir: &Path, bind_addr: SocketAddr) -> ControllerEnv {
    assert_test_dir(dir);
    let mut env = ControllerEnv::new(bind_addr, dir.to_path_buf());
    env.drain = TEST_DRAIN;
    env.join_grace = TEST_JOIN_GRACE;
    env.exit_budget = TEST_EXIT_BUDGET;
    env
}

/// `test_env(dir, 127.0.0.1:0)`.
pub(crate) fn test_env0(dir: &Path) -> ControllerEnv {
    test_env(dir, loopback(0))
}

/// Panics unless `path` is under `std::env::temp_dir()` and does not name
/// `Application Support`. Call it before touching any test directory.
pub(crate) fn assert_test_dir(path: &Path) {
    let tmp = std::env::temp_dir();
    assert!(
        path.starts_with(&tmp),
        "test dir {path:?} is not under temp_dir {tmp:?}"
    );
    assert!(
        !path.to_string_lossy().contains("Application Support"),
        "test dir {path:?} names Application Support"
    );
}

/// A fresh, not-yet-created directory path unique to this call:
/// `temp_dir()/mdpro-mcpctl-{label}-{uuid}`. Guarded by `assert_test_dir`.
pub(crate) fn temp_files_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mdpro-mcpctl-{label}-{}", uuid::Uuid::new_v4()));
    assert_test_dir(&dir);
    dir
}

/// Best-effort removal of a test directory, guarded first.
pub(crate) fn remove_test_dir(path: &Path) {
    assert_test_dir(path);
    let _ = fs::remove_dir_all(path);
}

/// The mode a file gets when created with `mode(0o666)` in `dir`, i.e.
/// `0o666 & !umask`. Reads the effective umask without `libc`.
#[cfg(unix)]
pub(crate) fn probe_mode_umask(dir: &Path) -> u32 {
    assert_test_dir(dir);
    let probe = dir.join(format!("umask-probe-{}", uuid::Uuid::new_v4()));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o666)
        .open(&probe)
        .expect("create umask probe");
    let mode = file
        .metadata()
        .expect("probe metadata")
        .permissions()
        .mode()
        & 0o777;
    drop(file);
    let _ = fs::remove_file(&probe);
    mode
}

/// `127.0.0.1:port`.
pub(crate) fn loopback(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

/// Bind `127.0.0.1:0` and keep the listener: an occupied port with no
/// release window.
pub(crate) fn hold_port() -> (StdListener, u16) {
    let listener = StdListener::bind(loopback(0)).expect("bind 127.0.0.1:0");
    let port = listener.local_addr().expect("local_addr").port();
    assert_ne!(port, APP_PORT, "a test must never hold the app port");
    (listener, port)
}

/// A port that was free a moment ago. Only `with_free_port` calls this.
fn fixed_port() -> u16 {
    let (listener, port) = hold_port();
    drop(listener);
    port
}

/// Returned by a `with_free_port` scenario iff its first (setup) bind of
/// the port failed with `BindInUse`.
#[derive(Debug)]
pub(crate) struct SetupCollision;

/// Run `scenario` on a free port, retrying the whole scenario once with a
/// new port if its setup bind collided. A second collision fails the test.
pub(crate) async fn with_free_port<F, Fut>(scenario: F)
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

/// True iff a TCP connect to `127.0.0.1:port` fails.
pub(crate) fn connect_refused(port: u16) -> bool {
    TcpStream::connect_timeout(&loopback(port), CONNECT_PROBE).is_err()
}

/// Poll `cond` until it holds or `budget` passes. Returns whether it held.
pub(crate) async fn wait_until(budget: Duration, mut cond: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + budget;
    loop {
        if cond() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// GET `http://127.0.0.1:{port}{path}` with an optional `X-MDPRO-Token`
/// header and an explicit client timeout. Returns the HTTP status code.
pub(crate) async fn raw_get(
    port: u16,
    path: &str,
    token: Option<&str>,
    client_timeout: Duration,
) -> reqwest::Result<u16> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(client_timeout)
        .build()?;
    let mut request = client.get(format!("http://127.0.0.1:{port}{path}"));
    if let Some(token) = token {
        request = request.header("X-MDPRO-Token", token);
    }
    Ok(request.send().await?.status().as_u16())
}

/// Whether `server.port` / `server.token` exist in `dir`, in that order.
pub(crate) fn files_present(dir: &Path) -> (bool, bool) {
    assert_test_dir(dir);
    (
        dir.join(super::files::PORT_FILE).exists(),
        dir.join(super::files::TOKEN_FILE).exists(),
    )
}

/// The published `(port, token)`, if both files are readable.
pub(crate) fn read_published(dir: &Path) -> Option<(u16, String)> {
    assert_test_dir(dir);
    let port = fs::read_to_string(dir.join(super::files::PORT_FILE)).ok()?;
    let token = fs::read_to_string(dir.join(super::files::TOKEN_FILE)).ok()?;
    Some((port.trim().parse().ok()?, token))
}

/// Restores the log settings on drop.
pub(crate) struct LogOn(LogSettings);
impl Drop for LogOn {
    fn drop(&mut self) {
        logger::set_log_settings(self.0.clone());
    }
}

pub(crate) fn force_logger_on() -> LogOn {
    let prev = LogOn(logger::get_log_settings());
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    });
    prev
}

/// Raw `mcp.http_server.start` lines in the temp HOME's log.
pub(crate) fn start_lines(home: &Path) -> Vec<String> {
    let text = fs::read_to_string(home.join(".mdpro").join("mdpro.log")).unwrap_or_default();
    text.lines()
        .filter(|l| {
            serde_json::from_str::<Value>(l)
                .ok()
                .and_then(|v| v.get("event").and_then(|e| e.as_str()).map(str::to_owned))
                .as_deref()
                == Some("mcp.http_server.start")
        })
        .map(str::to_owned)
        .collect()
}

pub(crate) fn is_enum_string(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|ch| ch.is_ascii_lowercase() || ch == '_')
}
