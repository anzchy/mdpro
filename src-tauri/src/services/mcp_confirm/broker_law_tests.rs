//! Hand-enumerated laws through the async shell (matrix B-5, B-10). Each
//! script runs on a fresh paused-clock runtime; every enumeration asserts
//! its own size.

use std::time::Duration;

use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::services::mcp_confirm::queue::{Cause, Outcome, ReplyVerdict};
use crate::services::mcp_confirm::test_effects::*;

/// Every sequence over `alphabet` of length `0..=max_len`.
fn scripts<T: Copy>(alphabet: &[T], max_len: usize) -> Vec<Vec<T>> {
    let mut all = vec![Vec::new()];
    let mut layer = vec![Vec::new()];
    for _ in 0..max_len {
        let next: Vec<Vec<T>> = layer
            .iter()
            .flat_map(|s: &Vec<T>| {
                alphabet.iter().map(move |t| {
                    let mut longer = s.clone();
                    longer.push(*t);
                    longer
                })
            })
            .collect();
        all.extend(next.iter().cloned());
        layer = next;
    }
    all
}

#[derive(Debug, Clone, Copy)]
enum Answer {
    ApproveHead,
    RejectHead,
    ApproveLast,
    ApproveHeadTwice,
}

const ANSWERS: [Answer; 4] = [
    Answer::ApproveHead,
    Answer::RejectHead,
    Answer::ApproveLast,
    Answer::ApproveHeadTwice,
];

/// Run one B-5 script; returns (approved outcomes, approving `Resolved` replies).
fn run_b5(n: usize, script: &[Answer]) -> (usize, usize) {
    paused_runtime().block_on(async {
        let fx = RecordingEffects::new();
        let b = broker(&fx);
        let mut handles: Vec<Option<JoinHandle<Outcome>>> = Vec::new();
        for _ in 0..n {
            handles.push(Some(spawn_confirm(&b, "A")));
            settle().await;
        }
        let (mut approved_outcomes, mut approving_replies) = (0, 0);
        for answer in script {
            let head = b.shown("A");
            let calls: Vec<(String, bool)> = match (answer, head) {
                (Answer::ApproveHead, Some(h)) => vec![(h, true)],
                (Answer::RejectHead, Some(h)) => vec![(h, false)],
                (Answer::ApproveHeadTwice, Some(h)) => vec![(h.clone(), true), (h, true)],
                (Answer::ApproveLast, _) => vec![(format!("r{}", n - 1), true)],
                (Answer::ApproveHead | Answer::RejectHead | Answer::ApproveHeadTwice, None) => {
                    Vec::new()
                }
            };
            let mut resolved_now = 0;
            for (id, approved) in calls {
                let verdict = b.reply(&id, "A", approved).expect("reply");
                if verdict == ReplyVerdict::Resolved {
                    resolved_now += 1;
                    approving_replies += usize::from(approved);
                }
            }
            settle().await;
            let mut finished_now = 0;
            for slot in handles.iter_mut() {
                if slot.as_ref().is_some_and(JoinHandle::is_finished) {
                    let h = slot.take().expect("handle");
                    finished_now += 1;
                    approved_outcomes += usize::from(outcome(h).await == Outcome::Approved);
                }
            }
            assert_eq!(finished_now, resolved_now, "n={n} {script:?}: one reply, one waiter");
        }
        (approved_outcomes, approving_replies)
    })
}

#[test]
fn b5_one_approval_completes_exactly_one_operation() {
    let mut runs = 0;
    for n in 1..=3 {
        for script in scripts(&ANSWERS, n + 1) {
            let (outcomes, replies) = run_b5(n, &script);
            assert_eq!(outcomes, replies, "n={n} {script:?}");
            runs += 1;
        }
    }
    assert_eq!(runs, 21 + 85 + 341, "enumeration size");
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Step {
    ConfirmA,
    ConfirmB,
    ReplyHeadAApprove,
    ReplyHeadBReject,
    AbortOldestLive,
    Advance30,
    CancelWindowA,
    CancelAllServerStop,
}

const STEPS: [Step; 8] = [
    Step::ConfirmA,
    Step::ConfirmB,
    Step::ReplyHeadAApprove,
    Step::ReplyHeadBReject,
    Step::AbortOldestLive,
    Step::Advance30,
    Step::CancelWindowA,
    Step::CancelAllServerStop,
];

struct Waiter {
    id: String,
    arrival: Instant,
    handle: Option<JoinHandle<Outcome>>,
    outcome: Option<Outcome>,
    aborted: bool,
}

impl Waiter {
    fn live(&self) -> bool {
        self.outcome.is_none() && !self.aborted
    }
}

async fn apply(step: Step, b: &TestBroker, waiters: &mut Vec<Waiter>) {
    let mut confirm = |w: &'static str| {
        let id = format!("r{}", waiters.len());
        let handle = Some(spawn_confirm(b, w));
        let (arrival, outcome, aborted) = (Instant::now(), None, false);
        waiters.push(Waiter { id, arrival, handle, outcome, aborted });
    };
    match step {
        Step::ConfirmA => confirm("A"),
        Step::ConfirmB => confirm("B"),
        Step::ReplyHeadAApprove | Step::ReplyHeadBReject => {
            let (w, approved) = if step == Step::ReplyHeadAApprove { ("A", true) } else { ("B", false) };
            if let Some(head) = b.shown(w) {
                b.reply(&head, w, approved).expect("reply");
            }
        }
        Step::AbortOldestLive => {
            if let Some(w) = waiters.iter_mut().find(|w| w.live()) {
                w.handle.as_ref().expect("live handle").abort();
                w.aborted = true;
            }
        }
        Step::Advance30 => tokio::time::advance(Duration::from_secs(30)).await,
        Step::CancelWindowA => b.cancel_window("A").expect("cancel_window"),
        Step::CancelAllServerStop => b.cancel_all(Cause::ServerStop).expect("cancel_all"),
    }
}

fn run_b10(script: &[Step]) {
    paused_runtime().block_on(async {
        let fx = RecordingEffects::new();
        let b = broker(&fx);
        let mut waiters: Vec<Waiter> = Vec::new();
        let mut checker = WireChecker::default();
        for (i, step) in script.iter().enumerate() {
            let ctx = format!("{script:?} step {i}");
            apply(*step, &b, &mut waiters).await;
            settle().await;
            for w in waiters.iter_mut() {
                let finished = w.handle.as_ref().is_some_and(JoinHandle::is_finished);
                if !finished {
                    continue;
                }
                let joined = w.handle.take().expect("handle").await;
                match joined {
                    Ok(o) => {
                        assert!(!w.aborted, "{ctx}: aborted waiter produced {o:?}");
                        assert_eq!(w.outcome, None, "{ctx}: finished twice");
                        w.outcome = Some(o);
                    }
                    Err(e) => assert!(w.aborted && e.is_cancelled(), "{ctx}: {e}"),
                }
            }
            let live = waiters.iter().filter(|w| w.live()).count();
            assert_eq!(b.pending_len(), live, "{ctx}: (ii) pending == live waiters");
            for w in waiters.iter().filter(|w| w.live()) {
                let age = Instant::now() - w.arrival;
                assert!(age < Duration::from_secs(60), "{ctx}: (iii) {} aged {age:?}", w.id);
            }
            let calls = fx.calls();
            checker.feed(&calls).unwrap_or_else(|e| panic!("{ctx}: (iv) {e}"));
            if *step == Step::CancelWindowA {
                checker.forget_window("A");
            }
            for w in waiters.iter().filter(|w| !w.live()) {
                let count = checker.resolved.get(&w.id).copied().unwrap_or(0);
                let exempt = w.outcome == Some(Outcome::Cancelled(Cause::WindowClosed));
                let expected = usize::from(checker.requested.contains(&w.id) && !exempt);
                assert_eq!(count, expected, "{ctx}: (v) confirm_resolved for {}", w.id);
            }
        }
    });
}

#[test]
fn b10_conservation_through_the_async_shell() {
    let all = scripts(&STEPS, 3);
    assert_eq!(all.len(), 585, "enumeration size");
    for script in all {
        run_b10(&script);
    }
}
