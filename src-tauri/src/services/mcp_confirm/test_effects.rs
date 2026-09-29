//! Test-only `ConfirmEffects` recorder (matrix P-SEAMS), broker fixtures on
//! tokio's paused clock, and the wire-level checker the broker cases replay
//! recorded calls through (B-4, B-8, B-10).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::task::JoinHandle;

use super::broker::ConfirmBroker;
use super::effects::ConfirmEffects;
use super::payload::{ConfirmMeta, Operation, CONFIRM_REQUEST_EVENT, CONFIRM_RESOLVED_EVENT};
use super::queue::{IdSource, Outcome};

/// One trait call, in the order the broker made it.
#[derive(Debug, Clone, PartialEq)]
pub enum Call {
    Emit {
        window: String,
        event: String,
        payload: Value,
    },
    /// An `emit_to` the fake was told to fail; it returned `Err`.
    FailedEmit {
        window: String,
        event: String,
        payload: Value,
    },
    Attention {
        window: String,
    },
}

/// Records every call; fails `mcp:confirm_request` for the chosen ids.
#[derive(Clone, Default)]
pub struct RecordingEffects {
    calls: Arc<Mutex<Vec<Call>>>,
    fail_ids: Arc<HashSet<String>>,
}

impl RecordingEffects {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn failing(ids: &[&str]) -> Self {
        Self {
            calls: Arc::default(),
            fail_ids: Arc::new(ids.iter().map(|s| s.to_string()).collect()),
        }
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().expect("calls lock").clone()
    }
}

impl ConfirmEffects for RecordingEffects {
    fn emit_to(&self, window: &str, event: &str, payload: Value) -> Result<(), String> {
        let fail = event == CONFIRM_REQUEST_EVENT
            && payload["requestId"]
                .as_str()
                .is_some_and(|id| self.fail_ids.contains(id));
        let (window, event) = (window.to_string(), event.to_string());
        let call = if fail {
            Call::FailedEmit {
                window,
                event,
                payload,
            }
        } else {
            Call::Emit {
                window,
                event,
                payload,
            }
        };
        self.calls.lock().expect("calls lock").push(call);
        if fail {
            Err("injected emit failure".to_string())
        } else {
            Ok(())
        }
    }

    fn request_attention(&self, window: &str) -> Result<(), String> {
        let call = Call::Attention {
            window: window.to_string(),
        };
        self.calls.lock().expect("calls lock").push(call);
        Ok(())
    }
}

pub type TestBroker = Arc<ConfirmBroker<RecordingEffects>>;

/// The n-th enqueue gets id `r{n}`.
pub fn seq_ids() -> impl IdSource + 'static {
    let mut n = 0u32;
    move || {
        let id = format!("r{n}");
        n += 1;
        id
    }
}

pub fn meta() -> ConfirmMeta {
    ConfirmMeta {
        document_id: "doc-1".to_string(),
        document_title: "Notes".to_string(),
        operation: Operation::Replace,
    }
}

pub fn broker(fx: &RecordingEffects) -> TestBroker {
    Arc::new(ConfirmBroker::new_with(fx.clone(), seq_ids()))
}

pub fn spawn_confirm(b: &TestBroker, window: &'static str) -> JoinHandle<Outcome> {
    let b = Arc::clone(b);
    tokio::spawn(async move { b.confirm(window, meta()).await })
}

/// Let every ready task run. Never parks, so the paused clock never
/// auto-advances inside it.
pub async fn settle() {
    for _ in 0..8 {
        tokio::task::yield_now().await;
    }
}

pub async fn advance_ms(ms: u64) {
    tokio::time::advance(Duration::from_millis(ms)).await;
    settle().await;
}

pub fn paused_runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .start_paused(true)
        .build()
        .expect("paused runtime")
}

pub async fn outcome(handle: JoinHandle<Outcome>) -> Outcome {
    handle.await.expect("waiter completed")
}

pub fn resolved(window: &str, id: &str, outcome: &str) -> Call {
    Call::Emit {
        window: window.to_string(),
        event: CONFIRM_RESOLVED_EVENT.to_string(),
        payload: json!({ "requestId": id, "outcome": outcome }),
    }
}

/// Index of the successful `confirm_request` emit for `id` in `window`.
pub fn request_index(calls: &[Call], window: &str, id: &str) -> Option<usize> {
    calls.iter().position(|c| match c {
        Call::Emit {
            window: w,
            event,
            payload,
        } => w == window && event == CONFIRM_REQUEST_EVENT && payload["requestId"] == id,
        Call::FailedEmit { .. } | Call::Attention { .. } => false,
    })
}

/// `(index, window, outcome)` of every `confirm_resolved` emit for `id`.
pub fn resolved_for(calls: &[Call], id: &str) -> Vec<(usize, String, String)> {
    let mut found = Vec::new();
    for (i, call) in calls.iter().enumerate() {
        if let Call::Emit {
            window,
            event,
            payload,
        } = call
        {
            if event == CONFIRM_RESOLVED_EVENT && payload["requestId"] == id {
                let outcome = payload["outcome"].as_str().unwrap_or("").to_string();
                found.push((i, window.clone(), outcome));
            }
        }
    }
    found
}

/// Replays recorded calls as the webview would see them: at most one
/// displayed request per window, shown in enqueue order, each request
/// followed at once by one attention call, and each `confirm_resolved`
/// closing exactly the displayed request.
#[derive(Default)]
pub struct WireChecker {
    displayed: HashMap<String, String>,
    last_shown: HashMap<String, u32>,
    awaiting_attention: Option<String>,
    seen: usize,
    pub requested: HashSet<String>,
    pub resolved: HashMap<String, usize>,
}

fn ordinal(id: &str) -> Result<u32, String> {
    id.strip_prefix('r')
        .and_then(|n| n.parse().ok())
        .ok_or_else(|| format!("unexpected id {id}"))
}

impl WireChecker {
    pub fn feed(&mut self, calls: &[Call]) -> Result<(), String> {
        for (i, call) in calls.iter().enumerate().skip(self.seen) {
            self.step(call)
                .map_err(|e| format!("call {i}: {e}; calls = {calls:#?}"))?;
        }
        self.seen = calls.len();
        Ok(())
    }

    /// The window was destroyed: nothing is displayed in it any more.
    pub fn forget_window(&mut self, window: &str) {
        self.displayed.remove(window);
    }

    fn step(&mut self, call: &Call) -> Result<(), String> {
        if let Some(window) = self.awaiting_attention.take() {
            let expected = Call::Attention { window };
            return if call == &expected {
                Ok(())
            } else {
                Err(format!("expected {expected:?}"))
            };
        }
        match call {
            Call::Attention { window } => Err(format!("attention for {window} with no request")),
            Call::FailedEmit { .. } => Ok(()),
            Call::Emit {
                window,
                event,
                payload,
            } => {
                let id = payload["requestId"].as_str().ok_or("no requestId")?;
                if event == CONFIRM_REQUEST_EVENT {
                    self.show(window, id)
                } else if event == CONFIRM_RESOLVED_EVENT {
                    self.close(window, id)
                } else {
                    Err(format!("unknown event {event}"))
                }
            }
        }
    }

    fn show(&mut self, window: &str, id: &str) -> Result<(), String> {
        if let Some(prev) = self.displayed.get(window) {
            return Err(format!("{id} shown in {window} while {prev} is displayed"));
        }
        let n = ordinal(id)?;
        if self.last_shown.get(window).is_some_and(|&last| n <= last) {
            return Err(format!("{id} shown out of enqueue order in {window}"));
        }
        self.last_shown.insert(window.to_string(), n);
        self.displayed.insert(window.to_string(), id.to_string());
        self.requested.insert(id.to_string());
        self.awaiting_attention = Some(window.to_string());
        Ok(())
    }

    fn close(&mut self, window: &str, id: &str) -> Result<(), String> {
        if self.displayed.get(window).map(String::as_str) != Some(id) {
            let shown = self.displayed.get(window);
            return Err(format!("resolved {id} in {window}, displayed {shown:?}"));
        }
        self.displayed.remove(window);
        *self.resolved.entry(id.to_string()).or_default() += 1;
        Ok(())
    }
}
