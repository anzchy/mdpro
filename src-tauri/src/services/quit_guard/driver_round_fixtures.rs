//! The ADR-0035 round legs of the driver specifications (WI-1, WI-2, WI-4).
//!
//! Registered from `driver_fixtures.rs`. Every driver spec that used to see
//! `Reply(true)` straight after the last answer now routes through
//! `finish_quit`, so the path from the last answer to the commit is written
//! down once.
//!
//! WI-4 form of the backstop leg: the driver broadcasts `app:quit-backstop`,
//! and every live window answers it with `Drafted{0,0}` through
//! `handle_drafted` — the driver-level twin of `finish_recheck_and_backstop`.

use super::super::driver::*;
use super::super::DraftGate;
use super::{effects_of, later, recording_guard, Effect, RecordingEffects};

/// The last answer opened a re-check round: the request was re-broadcast to
/// every window and a deadline armed. Answer it `clean` from each of `labels`
/// (the windows still alive), starting at `now`, one ms apart; then run the
/// backstop leg to the commit.
pub(in super::super) fn finish_quit(
    guard: &QuitGuard<RecordingEffects>,
    request_id: u64,
    labels: &[&str],
    now: u64,
) {
    let effects = effects_of(guard);
    let tail = &effects[effects.len().saturating_sub(2)..];
    assert!(
        matches!(
            tail,
            [Effect::EmitAll(QuitEvent::Requested { request_id: a, .. }), Effect::ArmTimer(b, _)]
                if *a == request_id && *b == request_id
        ),
        "ADR-0035: the commit must be preceded by a re-check round; effects were {effects:?}"
    );
    for (t, label) in (now..).zip(labels) {
        guard
            .handle_reply(label, request_id, QuitAnswer::Clean, None, t)
            .unwrap();
    }
    let after = now.saturating_add(labels.len() as u64);
    finish_backstop(guard, request_id, labels, after);
}

/// ADR-0035 changes the spec: the last re-check answer opens the backstop,
/// which is broadcast (`app:quit-backstop`) and armed. Every live window
/// answers it `Drafted{0,0}`, one ms apart from `now`; the last one commits.
fn finish_backstop(
    guard: &QuitGuard<RecordingEffects>,
    request_id: u64,
    labels: &[&str],
    now: u64,
) {
    let effects = effects_of(guard);
    let tail = &effects[effects.len().saturating_sub(2)..];
    assert!(
        matches!(
            tail,
            [Effect::EmitAll(QuitEvent::Backstop { request_id: a, .. }), Effect::ArmTimer(b, _)]
                if *a == request_id && *b == request_id
        ),
        "ADR-0035: the re-check must open a backstop round; effects were {effects:?}"
    );
    for (t, label) in (now..).zip(labels) {
        guard.handle_drafted(label, request_id, (0, 0), t);
    }
}

/// `guard_at` over a caller-supplied gate, reopened after the burn (each burnt
/// request commits, which closes the gate), so a test can hold that gate
/// against the commit. SAFETY: caller must hold HOME_LOCK, as for `guard_at`.
pub(in super::super) fn guard_at_with(
    floor: u64,
    gate: &'static DraftGate,
) -> QuitGuard<RecordingEffects> {
    use crate::models::{LogLevel, LogSettings};
    use crate::services::logger;
    logger::set_log_settings(LogSettings {
        enabled: false,
        level: LogLevel::Info,
    });
    let guard = recording_guard(gate);
    for _ in 1..floor {
        later(guard.begin(&["burn"], 0));
        guard.window_gone("burn", 0);
    }
    gate.reopen_for_tests();
    logger::set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    guard
}
