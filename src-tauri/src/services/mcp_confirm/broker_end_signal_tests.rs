//! Every end of a shown request closes it in the webview exactly once,
//! before the next Show (matrix B-11). `cancel_window` is the exempt control:
//! the window is gone, so nothing is sent to it.

use crate::services::mcp_confirm::queue::Cause;
use crate::services::mcp_confirm::test_effects::*;

#[derive(Debug, Clone, Copy, PartialEq)]
enum End {
    Expire,
    Withdraw,
    CancelAll,
    Close,
    CancelWindow,
}

fn expected_outcome(end: End) -> Option<&'static str> {
    match end {
        End::Expire => Some("timedOut"),
        End::Withdraw => Some("withdrawn"),
        End::CancelAll | End::Close => Some("cancelled"),
        End::CancelWindow => None,
    }
}

fn run(end: End, requests: usize) {
    paused_runtime().block_on(async {
        let ctx = format!("{end:?} x {requests}");
        let fx = RecordingEffects::new();
        let b = broker(&fx);
        let mut handles = Vec::new();
        for _ in 0..requests {
            handles.push(spawn_confirm(&b, "A"));
            settle().await;
        }
        match end {
            End::Expire => advance_ms(60_000).await,
            End::Withdraw => handles[0].abort(),
            End::CancelAll => b.cancel_all(Cause::ServerStop).expect("cancel_all"),
            End::Close => b.close(Cause::AppExit).expect("close"),
            End::CancelWindow => b.cancel_window("A").expect("cancel_window"),
        }
        settle().await;
        let calls = fx.calls();
        let for_r0 = resolved_for(&calls, "r0");
        match expected_outcome(end) {
            Some(outcome) => {
                assert_eq!(for_r0.len(), 1, "{ctx}: exactly one close for r0");
                let (index, window, got) = &for_r0[0];
                assert_eq!((window.as_str(), got.as_str()), ("A", outcome), "{ctx}");
                if let Some(shown_r1) = request_index(&calls, "A", "r1") {
                    assert!(index < &shown_r1, "{ctx}: close r0 before showing r1");
                }
            }
            None => {
                let any = calls.iter().any(|c| matches!(c, Call::Emit { event, .. }
                    if event == crate::services::mcp_confirm::payload::CONFIRM_RESOLVED_EVENT));
                assert!(!any, "{ctx}: no close is sent to a destroyed window");
            }
        }
        if matches!(end, End::CancelAll | End::Close) {
            assert_eq!(request_index(&calls, "A", "r1"), None, "{ctx}: r1 never shown");
            assert!(resolved_for(&calls, "r1").is_empty(), "{ctx}: nothing for r1");
        }
        for id in ["r0", "r1"] {
            for (_, window, _) in resolved_for(&calls, id) {
                assert_eq!(window, "A", "{ctx}: close sent to another window");
            }
        }
    });
}

#[test]
fn b11_every_end_of_a_shown_request_closes_it_once_before_the_next_show() {
    let ends = [End::Expire, End::Withdraw, End::CancelAll, End::Close, End::CancelWindow];
    let mut runs = 0;
    for end in ends {
        for requests in [1, 2] {
            run(end, requests);
            runs += 1;
        }
    }
    assert_eq!(runs, 10, "4 end paths x 2 shapes + 2 control rows");
}
