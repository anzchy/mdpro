//! Purpose: the request and reply contract of the control channel
//! (ADR-0047 WI-009, from candidate B's spike): parsing, the credential check,
//! the at-most-once id claim and the error envelope. No I/O and no Tauri here.
//!
//! Key decisions:
//! - Every request needs the token and an id. The token is compared in constant
//!   time and never logged.
//! - A mutating command claims its id **before** it runs, so a disconnect after
//!   the server read the request cannot make it run twice (S1.4).
//! - Read-only commands may repeat an id.
//! - A claimed id is kept for the life of the run (plan WI-009 item 21). The
//!   spike kept 1,024 and forgot older ones, so an evicted id could run twice.

use std::collections::HashSet;
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{json, Value};

const ID_MAX_LEN: usize = 64;
pub const DEFAULT_TIMEOUT_MS: u64 = 5_000;
pub const MAX_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Deserialize)]
pub struct Request {
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub cmd: String,
    #[serde(default = "main_label")]
    pub window: String,
    #[serde(default)]
    pub args: Value,
}

fn main_label() -> String {
    "main".to_string()
}

impl Request {
    /// The caller's timeout, clamped to the server's ceiling.
    pub fn timeout_ms(&self) -> u64 {
        self.args
            .get("timeoutMs")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .min(MAX_TIMEOUT_MS)
    }
}

/// An error reply: `{id, ok:false, error:{code, message[, class]}[, outcome]}`.
#[derive(Debug, Clone, PartialEq)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
    /// The command may or may not have taken effect.
    pub unknown_outcome: bool,
    /// The app moved under the request (page not ready, reloaded, closed),
    /// not the request's own error: `error.class` is `driver_failure`.
    pub driver_failure: bool,
}

impl Failure {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            unknown_outcome: false,
            driver_failure: false,
        }
    }

    pub fn driver(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            driver_failure: true,
            ..Self::new(code, message)
        }
    }

    pub fn timeout() -> Self {
        Self {
            unknown_outcome: true,
            ..Self::new("timeout", "no result before the timeout")
        }
    }

    /// The same failure, with the outcome left unknown.
    pub fn outcome_unknown(self) -> Self {
        Self {
            unknown_outcome: true,
            ..self
        }
    }
}

pub fn reply_ok(id: &str, value: Value) -> Value {
    json!({ "id": id, "ok": true, "value": value })
}

pub fn reply_err(id: &str, f: &Failure) -> Value {
    let mut v = json!({ "id": id, "ok": false, "error": { "code": f.code, "message": f.message } });
    if f.driver_failure {
        v["error"]["class"] = json!("driver_failure");
    }
    if f.unknown_outcome {
        v["outcome"] = json!("unknown");
    }
    v
}

/// Commands that change app state run at most once per id.
pub fn is_mutating(cmd: &str) -> bool {
    matches!(cmd, "key" | "type" | "click" | "activate" | "eval")
}

pub fn token_matches(expected: &str, given: &str) -> bool {
    let (a, b) = (expected.as_bytes(), given.as_bytes());
    if a.len() != b.len() || a.is_empty() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn id_is_valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= ID_MAX_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// Every mutating id this run has accepted. Ids are at most 64 bytes, so a
/// run of a million commands holds well under 100 MB.
#[derive(Default)]
pub struct IdCache {
    inner: Mutex<HashSet<String>>,
}

impl IdCache {
    /// True if the id was free and is now claimed.
    pub fn claim(&self, id: &str) -> bool {
        let mut set = match self.inner.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.insert(id.to_string())
    }
}

/// Checks that come before any command runs. The token check is first, so an
/// unauthenticated caller learns nothing about ids or commands.
pub fn admit(req: &Request, token: &str, ids: &IdCache) -> Result<(), Failure> {
    if !token_matches(token, &req.token) {
        return Err(Failure::new("unauthorized", "missing or wrong token"));
    }
    if !id_is_valid(&req.id) {
        return Err(Failure::new(
            "bad_request",
            "id must be 1-64 chars of [A-Za-z0-9._-]",
        ));
    }
    if is_mutating(&req.cmd) && !ids.claim(&req.id) {
        return Err(Failure::new(
            "duplicate",
            "this id was already accepted; the command did not run again",
        ));
    }
    Ok(())
}

pub fn parse(line: &str) -> Result<Request, Failure> {
    serde_json::from_str(line)
        .map_err(|e| Failure::new("bad_request", format!("not a request object: {e}")))
}

#[cfg(test)]
#[path = "proto_tests.rs"]
mod proto_tests;
