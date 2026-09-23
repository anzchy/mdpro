//! D16F WI-6 property: refusal invariance of `QuitGuard::fallback_answer`
//! across every phase, answer and id (split from `driver_fallback_log_tests.rs`
//! for the 300-line limit; same law, same 6_400 band).

use super::driver_fallback_log_tests::{all, in_fallback, wire, OTHER, WIN};
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, entries_where, fresh_log_home, guard_at, later, set_home, Effect, RecordingEffects,
};
use crate::HOME_LOCK;
use serde_json::json;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Phase {
    NoRequest,
    Live,
    Fallback,
    Released,
    Aborted,
    Committed,
}

/// Put a fresh guard at `floor` into `phase`; returns it and the current id.
fn guard_in(phase: Phase, floor: u64) -> QuitGuard<RecordingEffects> {
    if phase == Phase::Fallback {
        return in_fallback(floor);
    }
    let guard = guard_at(floor);
    if phase == Phase::NoRequest {
        return guard;
    }
    let r = later(guard.begin(&[WIN, OTHER], 0));
    assert_eq!(r, floor, "guard_at did not land on its floor");
    match phase {
        Phase::Live => {}
        Phase::Released => {
            guard.effects().fail(|f| f.native_fallback = true);
            guard
                .handle_reply(WIN, r, QuitAnswer::Clean, None, 1)
                .unwrap();
            guard.tick(QUIT_ACK_TIMEOUT_MS);
        }
        Phase::Aborted => {
            guard
                .handle_reply(OTHER, r, QuitAnswer::Clean, None, 1)
                .unwrap();
            guard
                .handle_reply(WIN, r, QuitAnswer::Dirty, None, 2)
                .unwrap();
            guard
                .handle_reply(WIN, r, QuitAnswer::Cancel, None, 3)
                .unwrap();
            assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(false)));
        }
        Phase::Committed => {
            guard
                .handle_reply(WIN, r, QuitAnswer::Clean, None, 1)
                .unwrap();
            guard
                .handle_reply(OTHER, r, QuitAnswer::Clean, None, 2)
                .unwrap();
            assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
        }
        Phase::NoRequest | Phase::Fallback => unreachable!(),
    }
    guard
}

#[test]
fn wi6_refusal_invariance_across_every_phase_answer_and_id() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = fresh_log_home("wi6prop");
    let _home = set_home(&home);
    let phases = [
        Phase::NoRequest,
        Phase::Live,
        Phase::Fallback,
        Phase::Released,
        Phase::Aborted,
        Phase::Committed,
    ];
    let answers = [FallbackAnswer::KeepOpen, FallbackAnswer::QuitAnyway];
    let mut k = 0u64;
    for phase in phases {
        for answer in answers {
            for offset in [0u64, 1] {
                let floor = 6_400 + 10 * k;
                k += 1;
                let guard = guard_in(phase, floor);
                let id = floor + offset;
                let before = guard.snapshot();
                let base = effects_of(&guard).len();
                let case = format!("{phase:?}/{answer:?}/+{offset}");

                guard.fallback_answer(id, answer);

                let delta = effects_of(&guard)[base..].to_vec();
                assert!(
                    !delta.iter().any(|e| matches!(e, Effect::ArmTimer(..))),
                    "{case}: no timer may be armed by a fallback answer: {delta:?}"
                );
                let accepted = phase == Phase::Fallback && offset == 0;
                let lines = entries_where(&home, "app.quit.fallback", id, all);
                assert_eq!(lines.len(), 1, "{case}: expected one line, got {lines:?}");
                assert_eq!(
                    lines[0]["context"],
                    json!({ "requestId": id, "answer": wire(answer) }),
                    "{case}"
                );
                if accepted {
                    assert_eq!(lines[0]["status"], "success", "{case}");
                } else {
                    assert_eq!(lines[0]["status"], "fail", "{case}");
                    let why = lines[0]["error"].as_str().unwrap_or_default();
                    assert!(
                        ["staleRequest", "outOfPhase"].contains(&why),
                        "{case}: refusal reason {why:?}"
                    );
                    assert_eq!(guard.snapshot(), before, "{case}: refusal changed state");
                    assert!(delta.is_empty(), "{case}: refusal had effects {delta:?}");
                }
            }
        }
    }
}
