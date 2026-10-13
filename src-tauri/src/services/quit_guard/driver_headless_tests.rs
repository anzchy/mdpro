//! D190-WI-4 (delegator ruling, decision 1): the ADR-0027 alert off macOS.
//!
//! No alert is drawn off macOS. A timeout therefore hands the request back to
//! the windows (the effect reports `false`, the driver releases it), and the
//! "Stop Waiting and Quit…" escape answers for the person who chose it:
//! `QuitAnyway`, the alert's Quit Without Saving, which commits without
//! deleting any draft (ADR-0027 §5) and ends in `reply(true)`.

use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::*;

/// hf1: the headless answer for every cause (the domain is two values).
#[test]
fn hf1_headless_answer_per_cause() {
    assert_eq!(
        headless_fallback_answer(FallbackCause::Escape),
        Some(FallbackAnswer::QuitAnyway),
        "the escape is the person choosing to quit"
    );
    assert_eq!(
        headless_fallback_answer(FallbackCause::Timeout),
        None,
        "a timeout must not quit on its own: nobody chose to"
    );
}

/// hf2: a wedged window (it never answers) is escaped off macOS: the escape
/// commits without deleting anything and exits once.
#[test]
fn hf2_escape_from_a_wedged_window_exits_without_deleting() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.request_quit(&["A"], 0));
    guard.escape();
    assert!(
        effects_of(&guard).iter().any(|e| matches!(
            e,
            Effect::NativeFallback(id, _, FallbackCause::Escape) if *id == r
        )),
        "the escape reached the fallback"
    );
    let answer = headless_fallback_answer(FallbackCause::Escape)
        .expect("off macOS the escape must answer the fallback");
    deliver_fallback(Some(&guard), r, answer);
    let effects = effects_of(&guard);
    assert_eq!(effects.last(), Some(&Effect::Reply(true)), "{effects:?}");
    assert_eq!(
        effects
            .iter()
            .filter(|e| matches!(e, Effect::Reply(_)))
            .count(),
        1
    );
    assert!(guard.effects().deletes().is_empty(), "nothing deleted");
    assert!(!guard.is_request_live());
}

/// hf3: a timeout whose alert reports "not posted" (the off-macOS effect)
/// leaves the request live and owned by the windows, so the escape still
/// works afterwards and ends in the exit.
#[test]
fn hf3_released_timeout_is_still_escapable() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.request_quit(&["A"], 0));
    guard.effects().fail(|f| f.native_fallback = true);
    guard.tick(QUIT_ACK_TIMEOUT_MS);
    assert!(
        guard.is_request_live(),
        "the timeout did not end the request"
    );
    assert!(
        !effects_of(&guard).contains(&Effect::Reply(true)),
        "a timeout alone must not exit"
    );

    guard.effects().fail(|f| f.native_fallback = false);
    guard.escape();
    let answer = headless_fallback_answer(FallbackCause::Escape)
        .expect("off macOS the escape must answer the fallback");
    deliver_fallback(Some(&guard), r, answer);
    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
    assert!(!guard.is_request_live());
}
