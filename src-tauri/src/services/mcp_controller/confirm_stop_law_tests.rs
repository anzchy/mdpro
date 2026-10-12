//! ADR-0042 WI-4 laws on a real `McpController` (127.0.0.1:0, temp dir):
//! no pending confirmation survives a stop of a live server (S-5), and
//! `begin_exit` cancels as `AppExit`, closes the broker, and its cause wins
//! over the exit's own stop (S-7).

use crate::services::mcp_confirm::payload::CONFIRM_REQUEST_EVENT;
use crate::services::mcp_confirm::queue::{Cause, Outcome};
use crate::services::mcp_confirm::stop_hook;
use crate::services::mcp_confirm::test_effects::{
    broker, meta, spawn_confirm, Call, RecordingEffects,
};
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::snapshot::McpPhase;
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{
    remove_test_dir, temp_files_dir, test_env0, wait_until, GENEROUS,
};
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio::time::timeout;

/// Long enough for a woken waiter to finish; used only to show one did not.
const QUIET: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, Copy)]
enum Op {
    Start,
    Stop,
}

/// Every sequence of length 1..=3 over {Start, Stop}.
fn sequences() -> Vec<Vec<Op>> {
    let mut all: Vec<Vec<Op>> = Vec::new();
    let mut frontier: Vec<Vec<Op>> = vec![Vec::new()];
    for _ in 0..3 {
        let mut next = Vec::new();
        for seq in &frontier {
            for op in [Op::Start, Op::Stop] {
                let mut longer = seq.clone();
                longer.push(op);
                next.push(longer);
            }
        }
        all.extend(next.iter().cloned());
        frontier = next;
    }
    all
}

async fn run_sequence(seq: &[Op], k: usize) {
    let dir = temp_files_dir("s5");
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let c = McpController::new(test_env0(&dir).with_stop_hook(stop_hook(b.clone())));
    let mut waiting: Vec<JoinHandle<Outcome>> = Vec::new();
    for (step, op) in seq.iter().enumerate() {
        for _ in 0..k {
            waiting.push(spawn_confirm(&b, "B"));
        }
        let expected = waiting.len();
        assert!(
            wait_until(GENEROUS, || b.pending_len() == expected).await,
            "enqueue"
        );
        let live = c.snapshot().expect("snap").phase == McpPhase::Running;
        let at = format!("{seq:?} k={k} step {step} ({op:?}, live={live})");
        match op {
            Op::Start => timeout(GENEROUS, c.start(plain())).await,
            Op::Stop => timeout(GENEROUS, c.stop()).await,
        }
        .expect("bounded")
        .expect("snap");
        if live {
            for h in waiting.drain(..) {
                let out = timeout(GENEROUS, h).await.expect("woken").expect("task");
                assert_eq!(out, Outcome::Cancelled(Cause::ServerStop), "{at}");
            }
            assert_eq!(b.pending_len(), 0, "{at}");
        } else {
            tokio::time::sleep(QUIET).await;
            assert!(waiting.iter().all(|h| !h.is_finished()), "{at}: untouched");
            assert_eq!(b.pending_len(), waiting.len(), "{at}");
        }
    }
    timeout(GENEROUS, c.stop())
        .await
        .expect("stop")
        .expect("snap");
    for h in waiting {
        h.abort();
    }
    remove_test_dir(&dir);
}

/// S-5 LAW: after each op that stopped a live server, every earlier waiter
/// ended `Cancelled(ServerStop)`; an op with no live server touches none.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s5_no_pending_confirmation_survives_a_stop() {
    let seqs = sequences();
    assert_eq!(seqs.len(), 14, "sequences of length <= 3");
    let mut runs = 0;
    for seq in &seqs {
        for k in 0..=2 {
            run_sequence(seq, k).await;
            runs += 1;
        }
    }
    assert_eq!(runs, 42, "14 sequences x 3 values of k");
}

/// S-7: `begin_exit` cancels as `AppExit` and closes the broker; the exit's
/// stop never re-resolves anything as `ServerStop`, and a later request is
/// cancelled at once without a prompt.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s7_begin_exit_cancels_as_app_exit_and_its_cause_wins() {
    let dir = temp_files_dir("s7");
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let c = McpController::new(test_env0(&dir).with_stop_hook(stop_hook(b.clone())));
    let s = timeout(GENEROUS, c.start(plain()))
        .await
        .expect("start")
        .expect("snap");
    assert_eq!(s.phase, McpPhase::Running, "precondition");
    let first = spawn_confirm(&b, "B");
    assert!(
        wait_until(GENEROUS, || b.shown("B").is_some()).await,
        "shown"
    );
    let before = fx.calls().len();

    c.begin_exit();
    timeout(GENEROUS, c.stop())
        .await
        .expect("stop")
        .expect("snap");

    let out = timeout(GENEROUS, first)
        .await
        .expect("woken")
        .expect("task");
    assert_eq!(
        out,
        Outcome::Cancelled(Cause::AppExit),
        "the first cause wins"
    );
    let later = timeout(GENEROUS, b.confirm("A", meta()))
        .await
        .expect("immediate");
    assert_eq!(later, Outcome::Cancelled(Cause::AppExit));
    let requests: Vec<Call> = fx.calls()[before..]
        .iter()
        .filter(|c| matches!(c, Call::Emit { event, .. } if event == CONFIRM_REQUEST_EVENT))
        .cloned()
        .collect();
    assert!(
        requests.is_empty(),
        "prompted after begin_exit: {requests:?}"
    );
    assert_eq!(b.pending_len(), 0);
    remove_test_dir(&dir);
}
