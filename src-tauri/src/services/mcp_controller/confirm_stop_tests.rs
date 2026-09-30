//! ADR-0042 WI-4 on a real `McpController` (127.0.0.1:0, temp dir): a stop
//! ends every pending confirmation as `Cancelled(ServerStop)` before the
//! server's connections are killed, so the waiting client gets an HTTP 503
//! `CONFIRM_CANCELLED`, not a reset (matrix S-1, S-2, S-3, S-4).

use crate::services::mcp_confirm::payload::{CONFIRM_REQUEST_EVENT, CONFIRM_RESOLVED_EVENT};
use crate::services::mcp_confirm::stop_hook;
use crate::services::mcp_confirm::test_effects::{
    broker, request_index, resolved_for, Call, RecordingEffects, TestBroker,
};
use crate::services::mcp_confirm::queue::ReplyVerdict;
use crate::services::mcp_controller::confirm_routers::{
    confirm_gated, confirm_parked, post_confirm, store_with_d_in_b,
};
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::McpPhase;
use crate::services::mcp_controller::test_support::{
    files_present, read_published, remove_test_dir, temp_files_dir, test_env0, wait_until,
    GENEROUS, TEST_DRAIN, TEST_JOIN_GRACE,
};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::task::JoinHandle;
use tokio::time::timeout;

type Response = reqwest::Result<(u16, Value)>;

struct Rig {
    dir: PathBuf,
    fx: RecordingEffects,
    b: TestBroker,
    c: Arc<McpController>,
}

async fn rig(label: &str) -> Rig {
    let dir = temp_files_dir(label);
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let env = test_env0(&dir).with_stop_hook(stop_hook(b.clone()));
    let c = Arc::new(McpController::new(env));
    let rig = Rig { dir, fx, b, c };
    rig.start().await;
    rig
}

impl Rig {
    async fn start(&self) {
        let factory = confirm_gated(self.b.clone(), store_with_d_in_b());
        let s = timeout(GENEROUS, self.c.start(factory)).await.expect("start").expect("snap");
        assert_eq!(s.phase, McpPhase::Running, "precondition: {s:?}");
    }

    /// POST `/confirm/d` on a task; returns it with its arrival instant.
    fn post(&self) -> JoinHandle<(Response, Instant)> {
        let (port, token) = read_published(&self.dir).expect("published");
        tokio::spawn(async move {
            let response = post_confirm(port, token, "d", GENEROUS).await;
            (response, Instant::now())
        })
    }

    /// Wait for a shown request in B other than `previous`.
    async fn shown_b(&self, previous: Option<&str>) -> String {
        let b = self.b.clone();
        let prev = previous.map(str::to_string);
        let fresh = move || b.shown("B").filter(|id| Some(id) != prev.as_ref());
        assert!(wait_until(GENEROUS, || fresh().is_some()).await, "no prompt in B");
        self.b.shown("B").expect("shown in B")
    }
}

async fn answered(h: JoinHandle<(Response, Instant)>) -> ((u16, Value), Instant) {
    let (response, at) = timeout(GENEROUS, h).await.expect("client bounded").expect("task");
    (response.expect("an HTTP response, not a killed connection"), at)
}

fn assert_cancelled(response: &(u16, Value)) {
    assert_eq!(response.0, 503, "status: {response:?}");
    assert_eq!(response.1["code"], "CONFIRM_CANCELLED", "body: {response:?}");
}

/// S-1: MCP off while a write waits for B -> 503 `CONFIRM_CANCELLED`,
/// answered inside the drain, before any connection is killed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s1_server_off_while_pending_answers_503_confirm_cancelled() {
    let r = rig("s1").await;
    let client = r.post();
    let id = r.shown_b(None).await;

    let t0 = Instant::now();
    timeout(GENEROUS, r.c.stop()).await.expect("stop bounded").expect("snap");
    let stop_took = t0.elapsed();
    let (response, at) = answered(client).await;

    assert_cancelled(&response);
    assert!(at.duration_since(t0) < TEST_DRAIN, "answered in the drain");
    assert!(stop_took <= TEST_DRAIN + TEST_JOIN_GRACE + GENEROUS);
    assert_eq!(r.b.pending_len(), 0);
    let ends = resolved_for(&r.fx.calls(), &id);
    let outcomes: Vec<(&str, &str)> = ends.iter().map(|(_, w, o)| (w.as_str(), o.as_str())).collect();
    assert_eq!(outcomes, vec![("B", "cancelled")]);
    assert_eq!(files_present(&r.dir), (false, false));
    remove_test_dir(&r.dir);
}

/// S-2: a restart while pending stops through `stop_locked`, so the waiter
/// gets 503, and the restarted server prompts again.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s2_restart_while_pending_cancels_as_server_stop() {
    let r = rig("s2").await;
    let old = read_published(&r.dir).expect("published");
    let client = r.post();
    let first = r.shown_b(None).await;

    r.start().await;
    let (response, _) = answered(client).await;
    assert_cancelled(&response);
    assert_eq!(r.c.snapshot().expect("snap").phase, McpPhase::Running);
    let new = read_published(&r.dir).expect("republished");
    assert_ne!(new, old, "a new port and token");

    let second_client = r.post();
    let second = r.shown_b(Some(&first)).await;
    assert_ne!(second, first);
    timeout(GENEROUS, r.c.stop()).await.expect("stop").expect("snap");
    let (response, _) = answered(second_client).await;
    assert_cancelled(&response);
    remove_test_dir(&r.dir);
}

/// S-3: stop then start: the broker still confirms (only AppExit closes).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s3_stop_then_start_still_confirms() {
    let r = rig("s3").await;
    let client = r.post();
    let first = r.shown_b(None).await;
    timeout(GENEROUS, r.c.stop()).await.expect("stop").expect("snap");
    assert_cancelled(&answered(client).await.0);

    r.start().await;
    let client = r.post();
    let second = r.shown_b(Some(&first)).await;
    assert!(request_index(&r.fx.calls(), "B", &second).is_some(), "confirm_request to B");
    assert_eq!(r.b.reply(&second, "B", true), Ok(ReplyVerdict::Resolved));
    let (response, _) = answered(client).await;
    assert_eq!(response.0, 200, "approved: {response:?}");
    timeout(GENEROUS, r.c.stop()).await.expect("stop").expect("snap");
    remove_test_dir(&r.dir);
}

/// S-4: a request that reaches the gate after the hook fired is bounded by
/// the stop, withdrawn when its connection dies, and closed in B once.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s4_a_request_gated_after_the_hook_is_bounded_and_withdrawn() {
    let dir = temp_files_dir("s4");
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let env = test_env0(&dir).with_stop_hook(stop_hook(b.clone()));
    let c = Arc::new(McpController::new(env));
    let parked = confirm_parked(b.clone(), store_with_d_in_b());
    timeout(GENEROUS, c.start(parked.factory)).await.expect("start").expect("snap");
    let (port, token) = read_published(&dir).expect("published");
    let client = tokio::spawn(post_confirm(port, token, "d", GENEROUS));
    timeout(GENEROUS, parked.entered).await.expect("entered").expect("signal");

    let stopper = c.clone();
    let t0 = Instant::now();
    let stop = tokio::spawn(async move { stopper.stop().await });
    let stopping = || c.snapshot().map(|s| s.phase) == Ok(McpPhase::Stopping);
    assert!(wait_until(GENEROUS, stopping).await, "never Stopping");
    let _ = parked.release.send(());

    timeout(GENEROUS, stop).await.expect("stop bounded").expect("task").expect("snap");
    assert!(t0.elapsed() <= TEST_DRAIN + TEST_JOIN_GRACE + GENEROUS);
    let done = timeout(GENEROUS, client).await.expect("client bounded").expect("task");
    if let Ok((status, _)) = &done {
        assert_eq!(*status, 503, "a response must be 503: {done:?}");
    }
    assert_eq!(b.pending_len(), 0);
    let for_id: Vec<(String, String, Value)> = fx
        .calls()
        .into_iter()
        .filter_map(|call| match call {
            Call::Emit { window, event, payload } if payload["requestId"] == "r0" => {
                Some((window, event, payload))
            }
            Call::Emit { .. } | Call::FailedEmit { .. } | Call::Attention { .. } => None,
        })
        .collect();
    assert_eq!(for_id.len(), 2, "calls for r0: {for_id:?}");
    assert_eq!((for_id[0].0.as_str(), for_id[0].1.as_str()), ("B", CONFIRM_REQUEST_EVENT));
    assert_eq!((for_id[1].0.as_str(), for_id[1].1.as_str()), ("B", CONFIRM_RESOLVED_EVENT));
    assert_eq!(for_id[1].2["outcome"], "withdrawn", "{for_id:?}");
    remove_test_dir(&dir);
}
