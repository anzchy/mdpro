//! Purpose: the sidecar's connection to mdpro's HTTP server, which follows
//! the server across restarts (ADR-0040, WI-8).
//!
//! The app can stop and restart its HTTP server while this sidecar runs
//! (the live MCP server switch). A restart may change the port, the token,
//! or both, and rewrites `server.port` / `server.token` in the data dir.
//!
//! Key decisions:
//! - `Conn` holds the loaded `ServerConfig` in a `RwLock` and the directory
//!   it came from, so a failed attempt can re-read the files.
//! - `retry_decision` is the whole retry policy, as a pure function:
//!   - GET, on a 401 or a connection failure: reload, then retry once.
//!   - POST, on a 401 or a connection failure: reload for the *next* call
//!     and fail this one. A POST is never replayed, because a mutation that
//!     may have reached the app must not be applied twice.
//!   - Anything else, or any second attempt: fail.
//! - The request loop is also capped at `MAX_ATTEMPTS`, independent of the
//!   policy, so no policy change can turn it into a loop.
//! - Error text returned to MCP clients never contains the token or the
//!   data-dir path. A reload that finds no files says "not running".
//! - The HTTP client disables connection pooling and proxies: the target is
//!   always loopback, and a pooled connection to a stopped server would
//!   surface as an ambiguous mid-request failure instead of a clean
//!   connect failure.
//! - `load_from` reads exactly `dir/server.port` and `dir/server.token`.
//!   Only `main` names the real data dir.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Duration;

use reqwest::{Client, Response, StatusCode};
use rmcp::model::ErrorData;
use serde::de::DeserializeOwned;
use serde::Serialize;

/// File, inside the data dir, holding the HTTP server's port.
pub(crate) const PORT_FILE: &str = "server.port";
/// File, inside the data dir, holding the HTTP server's token.
pub(crate) const TOKEN_FILE: &str = "server.token";
/// Header the HTTP server checks the token against.
const TOKEN_HEADER: &str = "X-MDPRO-Token";
/// Hard cap on attempts per call, whatever `retry_decision` says.
const MAX_ATTEMPTS: u32 = 2;
/// Bound on a TCP connect to loopback.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Port and token read from the data directory.
pub(crate) struct ServerConfig {
    pub(crate) port: u16,
    token: String,
}

impl ServerConfig {
    /// Read `server.port` and `server.token` from `dir`, and nothing else.
    /// A missing file means the app is not running. Errors never contain
    /// the token or the directory path.
    pub(crate) fn load_from(dir: &Path) -> Result<Self, String> {
        let port_str = read_config_file(dir, PORT_FILE)?;
        let port: u16 = port_str
            .trim()
            .parse()
            .map_err(|e| format!("Invalid port number in {PORT_FILE}: {e}"))?;
        if port == 0 {
            return Err(format!("Invalid port number in {PORT_FILE}: 0"));
        }
        let token = read_config_file(dir, TOKEN_FILE)?.trim().to_string();
        if token.is_empty() {
            return Err(format!("mdpro not running: {TOKEN_FILE} is empty."));
        }
        Ok(Self { port, token })
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }
}

fn read_config_file(dir: &Path, name: &str) -> Result<String, String> {
    fs::read_to_string(dir.join(name)).map_err(|e| match e.kind() {
        ErrorKind::NotFound => {
            format!("mdpro not running: {name} not found. Please start mdpro first.")
        }
        kind => format!("Failed to read {name}: {kind}"),
    })
}

/// The HTTP method of a forwarded call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Method {
    Get,
    Post,
}

/// How one attempt failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Failure {
    /// The server answered 401: the token changed.
    Unauthorized,
    /// No connection could be made: the port changed or nothing listens.
    Connect,
    /// Anything else (other status, broken response).
    Other,
}

/// What to do after a failed attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Decision {
    /// Re-read the files, then send the same request again.
    ReloadAndRetry,
    /// Re-read the files for the next call, and fail this one.
    ReloadOnly,
    /// Fail this call.
    Fail,
}

/// The retry policy. `attempt` counts from 0.
/// Laws: `Post` never gives `ReloadAndRetry`; `attempt >= 1` never does.
pub(crate) fn retry_decision(method: Method, failure: Failure, attempt: u32) -> Decision {
    match (method, failure) {
        (_, Failure::Other) => Decision::Fail,
        (Method::Post, Failure::Unauthorized | Failure::Connect) => Decision::ReloadOnly,
        (Method::Get, Failure::Unauthorized | Failure::Connect) if attempt == 0 => {
            Decision::ReloadAndRetry
        }
        (Method::Get, Failure::Unauthorized | Failure::Connect) => Decision::Fail,
    }
}

/// A connection to mdpro's HTTP server that re-reads port and token from
/// its directory when the server moves.
pub(crate) struct Conn {
    dir: PathBuf,
    config: RwLock<ServerConfig>,
    client: Client,
}

impl Conn {
    /// Load the config from `dir` and build the HTTP client.
    pub(crate) fn load_from(dir: &Path) -> Result<Self, String> {
        let config = ServerConfig::load_from(dir)?;
        let client = Client::builder()
            .no_proxy()
            .pool_max_idle_per_host(0)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
        Ok(Self {
            dir: dir.to_path_buf(),
            config: RwLock::new(config),
            client,
        })
    }

    /// Authenticated GET, retried once after a reload on 401 / connect failure.
    pub(crate) async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, ErrorData> {
        self.call(Method::Get, path, None).await
    }

    /// Authenticated POST. Never replayed: a 401 / connect failure reloads
    /// the config for the next call and fails this one.
    pub(crate) async fn post<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, ErrorData> {
        let body = serde_json::to_value(body)
            .map_err(|e| internal(format!("Failed to serialize request: {e}")))?;
        self.call(Method::Post, path, Some(&body)).await
    }

    async fn call<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<T, ErrorData> {
        let mut last = String::from("mdpro request was not attempted");
        for attempt in 0..MAX_ATTEMPTS {
            let (failure, message) = match self.send(method, path, body).await? {
                Ok(response) => return parse(response).await,
                Err(failed) => failed,
            };
            match retry_decision(method, failure, attempt) {
                Decision::ReloadAndRetry => {
                    self.reload().map_err(internal)?;
                    last = message;
                }
                Decision::ReloadOnly => {
                    self.reload().map_err(internal)?;
                    return Err(internal(format!(
                        "{message}. mdpro's server changed; the request was not \
                         sent again. Retry the call."
                    )));
                }
                Decision::Fail => return Err(internal(message)),
            }
        }
        Err(internal(last))
    }

    /// One attempt. The outer `Err` is a local failure (lock); the inner
    /// one is a classified request failure with a token-free message.
    async fn send(
        &self,
        method: Method,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<Result<Response, (Failure, String)>, ErrorData> {
        let (url, token) = {
            let config = self
                .config
                .read()
                .map_err(|_| internal("mdpro connection state is unavailable".into()))?;
            (config.url(path), config.token.clone())
        };
        let request = match (method, body) {
            (Method::Get, _) => self.client.get(&url),
            (Method::Post, Some(body)) => self.client.post(&url).json(body),
            (Method::Post, None) => self.client.post(&url),
        };
        let response = match request.header(TOKEN_HEADER, token).send().await {
            Ok(response) => response,
            Err(e) if e.is_connect() => {
                return Ok(Err((
                    Failure::Connect,
                    "Could not connect to mdpro; it may not be running".into(),
                )))
            }
            Err(e) => {
                return Ok(Err((
                    Failure::Other,
                    format!("HTTP request to mdpro failed: {}", e.without_url()),
                )))
            }
        };
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED {
            return Ok(Err((
                Failure::Unauthorized,
                "mdpro rejected the sidecar's token (HTTP 401)".into(),
            )));
        }
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Ok(Err((Failure::Other, format!("HTTP {status}: {text}"))));
        }
        Ok(Ok(response))
    }

    /// Re-read port and token from the directory this `Conn` was loaded from.
    fn reload(&self) -> Result<(), String> {
        let fresh = ServerConfig::load_from(&self.dir)?;
        let mut config = self
            .config
            .write()
            .map_err(|_| "mdpro connection state is unavailable".to_string())?;
        *config = fresh;
        Ok(())
    }
}

async fn parse<T: DeserializeOwned>(response: Response) -> Result<T, ErrorData> {
    response
        .json()
        .await
        .map_err(|e| internal(format!("Failed to parse response: {}", e.without_url())))
}

fn internal(message: String) -> ErrorData {
    ErrorData::internal_error(message, None)
}

#[cfg(test)]
#[path = "conn_load_tests.rs"]
mod conn_load_tests;
#[cfg(test)]
#[path = "conn_test_support.rs"]
mod conn_test_support;
#[cfg(test)]
#[path = "conn_tests.rs"]
mod conn_tests;
