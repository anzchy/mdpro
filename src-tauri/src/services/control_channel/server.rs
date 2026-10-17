//! Purpose: one request line in, one reply line out, for the control channel
//! (ADR-0047 WI-009 WI 4). Pure over a `Host`, so it is tested without a
//! webview; `mod.rs` supplies the Tauri host and the socket loop.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use super::dispatch::dispatch;
pub use super::generation::Generations;
pub use super::page::Script;
use super::proto::{self, Failure, IdCache};

/// An input the host turns into native events. Its values are checked by
/// the platform's key table, not here.
#[derive(Debug, Clone, PartialEq)]
pub enum Input {
    Activate,
    Key {
        key: String,
        mods: Vec<String>,
        repeat: usize,
    },
    Text(String),
    Click {
        x: f64,
        y: f64,
    },
}

/// What the channel needs from the running app.
pub trait Host: Send + Sync {
    fn labels(&self) -> Vec<String>;
    fn has_window(&self, label: &str) -> bool;
    fn page(
        &self,
        label: &str,
        req_id: &str,
        script: Script<'_>,
        args: &Value,
        timeout: Duration,
    ) -> Result<Value, Failure>;
    fn input(&self, label: &str, input: Input) -> Result<Value, Failure>;
}

/// `(event, context)`; never given the token.
pub type LogSink = Box<dyn Fn(&str, Value) + Send + Sync>;

pub struct Channel<H: Host> {
    pub host: H,
    pub token: String,
    pub eval: bool,
    pub ids: IdCache,
    pub gens: Arc<Generations>,
    pub log: LogSink,
}

/// Handles one request line and returns the reply object. The token is
/// checked before anything else; a refusal is logged with its reason only.
pub fn serve_line<H: Host>(ch: &Channel<H>, line: &str) -> Value {
    let req = match proto::parse(line) {
        Ok(req) => req,
        Err(f) => return proto::reply_err("", &f),
    };
    if let Err(f) = proto::admit(&req, &ch.token, &ch.ids) {
        (ch.log)("control.reject", json!({ "reason": f.code }));
        return proto::reply_err(&req.id, &f);
    }
    match dispatch(ch, &req) {
        Ok(v) => proto::reply_ok(&req.id, v),
        Err(f) => proto::reply_err(&req.id, &f),
    }
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod server_tests;
