//! D190-WI-4: the guarded quit request off macOS (`QuitGuard::request_quit`).
//!
//! On Windows the predefined Quit item posts `WM_QUIT` and the process ends
//! without the guard. The replacement Exit item calls `request_quit`, which
//! must open the same request `applicationShouldTerminate:` opens on macOS and
//! end in the same terminal effect, `reply(true)`, only once the protocol has
//! ruled. The recording effects stand in only for the Tauri emit and the exit.

use super::driver::*;
use super::driver_fixtures::*;

const MAX_WINDOWS: usize = 6;

fn labels(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("w{i}")).collect()
}

fn reply_count(effects: &[Effect]) -> usize {
    effects
        .iter()
        .filter(|e| matches!(e, Effect::Reply(_)))
        .count()
}

/// rq1: with windows open, Exit opens a phase-1 request: it broadcasts
/// `app:quit-requested` round 0 and arms the ack deadline, and does not exit.
#[test]
fn rq1_request_with_open_windows_defers_and_broadcasts_phase_one() {
    let guard = recording_guard(leak_gate());
    let begin = guard.request_quit(&["A", "B"], 10);
    let r = later(begin);
    assert_eq!(
        effects_of(&guard),
        vec![
            Effect::EmitAll(QuitEvent::Requested {
                request_id: r,
                round: 0
            }),
            Effect::ArmTimer(r, 10 + QUIT_ACK_TIMEOUT_MS),
        ],
        "Exit must start phase 1 and must not exit before the guard rules"
    );
    assert!(guard.is_request_live(), "the request is live after Exit");
}

/// rq2: with no window open there is nothing to guard, and the route exits
/// exactly once (the off-macOS twin of `NSTerminateNow`).
#[test]
fn rq2_request_with_no_windows_exits_once() {
    let guard = recording_guard(leak_gate());
    let none: [&str; 0] = [];
    assert_eq!(guard.request_quit(&none, 0), Begin::TerminateNow);
    assert_eq!(effects_of(&guard), vec![Effect::Reply(true)]);
    assert!(!guard.is_request_live());
}

/// rq3: Exit chosen again while a request is live changes nothing: no second
/// broadcast, no exit (ADR-0025 §2, the nested `terminate:` twin).
#[test]
fn rq3_second_request_while_live_is_already_pending_and_inert() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.request_quit(&["A"], 0));
    let before = effects_of(&guard);
    assert_eq!(guard.request_quit(&["A"], 5), Begin::AlreadyPending);
    assert_eq!(effects_of(&guard), before, "a nested Exit must be inert");
    assert!(guard.is_request_live(), "request {r} is still live");
}

/// rq4: the guarded route ends in the same terminal effect as the macOS quit:
/// after phase 1, the ADR-0035 re-check and the backstop, exactly one
/// `Reply(true)`, and it is the last effect.
#[test]
fn rq4_guarded_request_ends_in_one_terminal_exit_after_the_backstop() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.request_quit(&["A"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Clean, None, 1)
        .unwrap();
    finish_quit(&guard, r, &["A"], 2);
    let effects = effects_of(&guard);
    assert_eq!(reply_count(&effects), 1, "one exit, effects: {effects:?}");
    assert_eq!(effects.last(), Some(&Effect::Reply(true)));
    assert!(
        effects
            .iter()
            .any(|e| matches!(e, Effect::EmitAll(QuitEvent::Backstop { .. }))),
        "ADR-0035: the draft backstop ran before the exit"
    );
}

/// rq5: a window that cancels keeps the app open: the route never exits.
#[test]
fn rq5_cancel_keeps_the_app_open() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.request_quit(&["A"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("A", r, QuitAnswer::Cancel, None, 2)
        .unwrap();
    let effects = effects_of(&guard);
    assert!(
        !effects.contains(&Effect::Reply(true)),
        "a cancelled quit must not exit: {effects:?}"
    );
    assert_eq!(
        effects.last(),
        Some(&Effect::Reply(false)),
        "the cancel ends in the macOS cancel reply"
    );
    assert!(!guard.is_request_live(), "the cancel resolved the request");
}

/// rq6 (S6, metamorphic): for every window count, `request_quit` emits exactly
/// what the macOS hook's `begin` emits, plus one `Reply(true)` when — and only
/// when — `begin` says there is nothing to guard. The two routes may differ
/// only in who performs the immediate exit.
#[test]
fn rq6_request_quit_matches_begin_for_every_window_count() {
    for n in 0..=MAX_WINDOWS {
        let names = labels(n);
        let mac = recording_guard(leak_gate());
        let mac_begin = mac.begin(&names, 7);
        let off = recording_guard(leak_gate());
        let off_begin = off.request_quit(&names, 7);
        assert_eq!(off_begin, mac_begin, "n={n}: same ruling");

        let mut expected = effects_of(&mac);
        if mac_begin == Begin::TerminateNow {
            expected.push(Effect::Reply(true));
        }
        assert_eq!(effects_of(&off), expected, "n={n}: same effects");
        assert_eq!(
            reply_count(&effects_of(&off)),
            usize::from(n == 0),
            "n={n}: exits immediately iff no window is open"
        );
    }
}
