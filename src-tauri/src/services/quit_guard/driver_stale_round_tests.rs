//! ADR-0035 WI-5 (A5): DD-5, stale-round junk of every answer kind is inert at
//! the IPC entry `handle_wire_reply`.
//!
//! Registered from `driver_drafted_reply_tests.rs`. The two-window trace
//! discards a real id at the commit, so it runs under `HOME_LOCK` in a temp
//! `$HOME` (asserted by `drafts_dir` before anything is deleted).
//!
//! Law (metamorphic): inserting, before every answer in round k ≥ 1, one reply
//! of every answer kind from every live window tagged with round k-1 changes
//! neither the state at the moment of the junk nor the final effect trace.

use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    drafts_dir, effects_of, later, leak_gate, make_temp_home, recording_guard, set_home, Effect,
};
use crate::HOME_LOCK;

/// One wire reply: label, answer, ids, counts, round, time.
type Call = (
    &'static str,
    QuitAnswer,
    Option<Vec<String>>,
    (Option<u32>, Option<u32>),
    u32,
    u64,
);

const NO: (Option<u32>, Option<u32>) = (None, None);

fn x() -> Option<Vec<String>> {
    Some(vec!["x".to_string()])
}

/// One answer kind with its ids and counts.
type JunkKind = (QuitAnswer, Option<Vec<String>>, (Option<u32>, Option<u32>));

/// Every answer kind, well-formed, so that only the round can refuse it.
fn junk_kinds() -> Vec<JunkKind> {
    vec![
        (QuitAnswer::Clean, None, NO),
        (QuitAnswer::Dirty, None, NO),
        (QuitAnswer::Delivered, None, NO),
        (QuitAnswer::Discard, x(), NO),
        (QuitAnswer::Cancel, None, NO),
        (QuitAnswer::Drafted, None, (Some(1), Some(0))),
    ]
}

/// DR-1: one window, clean twice, then drafted.
fn dr1_trace() -> Vec<Call> {
    vec![
        ("a", QuitAnswer::Clean, None, NO, 0, 10),
        ("a", QuitAnswer::Clean, None, NO, 1, 20),
        ("a", QuitAnswer::Drafted, None, (Some(1), Some(0)), 1, 30),
    ]
}

/// DR-2, extended: `a` is dirty at the re-check, is prompted, discards `x`;
/// the next re-check is clean, and both windows draft.
fn dr2_trace() -> Vec<Call> {
    vec![
        ("a", QuitAnswer::Clean, None, NO, 0, 10),
        ("b", QuitAnswer::Clean, None, NO, 0, 20),
        ("a", QuitAnswer::Dirty, None, NO, 1, 30),
        ("b", QuitAnswer::Clean, None, NO, 1, 40),
        ("a", QuitAnswer::Delivered, None, NO, 1, 50),
        ("a", QuitAnswer::Discard, x(), NO, 1, 60),
        ("a", QuitAnswer::Clean, None, NO, 2, 70),
        ("b", QuitAnswer::Clean, None, NO, 2, 80),
        ("a", QuitAnswer::Drafted, None, (Some(1), Some(0)), 2, 90),
        ("b", QuitAnswer::Drafted, None, (Some(0), Some(0)), 2, 100),
    ]
}

/// Replay `trace` on a fresh guard over `labels`, with or without the junk,
/// and return the effect log.
fn replay(labels: &[&'static str], trace: &[Call], junk: bool) -> Vec<Effect> {
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(labels, 0));
    for (label, answer, ids, counts, round, t) in trace.iter().cloned() {
        if junk && round >= 1 {
            for &from in labels {
                for (kind, kind_ids, kind_counts) in junk_kinds() {
                    let row = format!("{kind:?} from {from} at round {round}, before {answer:?}");
                    let before = guard.snapshot();
                    let effects_before = effects_of(&guard).len();
                    let got = guard.handle_wire_reply(
                        from,
                        r,
                        kind,
                        kind_ids,
                        kind_counts.0,
                        kind_counts.1,
                        Some(round - 1),
                        t - 1,
                    );
                    assert!(got.is_ok(), "{row}: {got:?}");
                    assert_eq!(guard.snapshot(), before, "{row}: the state moved");
                    assert_eq!(
                        effects_of(&guard).len(),
                        effects_before,
                        "{row}: an effect ran"
                    );
                }
            }
        }
        guard
            .handle_wire_reply(label, r, answer, ids, counts.0, counts.1, Some(round), t)
            .unwrap();
    }
    effects_of(&guard)
}

#[test]
fn dd5_stale_round_junk_of_every_kind_is_inert_at_the_wire_entry() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("dd5");
    let _home = set_home(&home);
    let _ = drafts_dir(&home);

    for (labels, trace) in [(vec!["a"], dr1_trace()), (vec!["a", "b"], dr2_trace())] {
        let clean = replay(&labels, &trace, false);
        let junk = replay(&labels, &trace, true);
        assert_eq!(junk, clean, "{labels:?}: the junk changed the trace");
        for (run, log) in [("clean", &clean), ("junk", &junk)] {
            let replies: Vec<&Effect> = log
                .iter()
                .filter(|e| matches!(e, Effect::Reply(_)))
                .collect();
            assert_eq!(
                replies,
                vec![&Effect::Reply(true)],
                "{labels:?} {run}: {log:?}"
            );
            assert!(
                !log.iter()
                    .any(|e| matches!(e, Effect::EmitAll(QuitEvent::Cancelled { .. }))),
                "{labels:?} {run}: a stale cancel aborted"
            );
        }
    }
}
