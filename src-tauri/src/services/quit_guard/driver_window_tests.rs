//! WI3-W1 and W2 (the `on_window_event` seam), split out of `driver_tests.rs`.
//!
//! Test cases for the WI-3 driver (`services::quit_guard::driver`), the
//! `on_window_event` seam and the pure log builders.
//!
//! Wired from `mod.rs` with `#[cfg(test)] #[path = ...]` so the specification
//! lives apart from the implementation it constrains.
//!
//! **Draft deletion is real here.** It is not behind `QuitEffects`, so every
//! case whose request reaches `Commit` with a non-empty id list runs under
//! `crate::HOME_LOCK`, in a temp `$HOME`, and asserts that `dirs::data_dir()`
//! resolved inside that temp HOME before it writes anything. Without that
//! guard these cases would delete the developer's own drafts.

use super::driver::*;
use super::driver_fixtures::*;
use super::on_window_event;

// ── WI3-W1 ────────────────────────────────────────────────────────────────────

#[test]
fn w1_destroyed_for_a_queued_window_advances_the_quit_without_prompting_it() {
    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Dirty, None, 2)
        .unwrap();
    let before_gone = effects_of(&guard);

    on_window_event(&guard, "B", &tauri::WindowEvent::Destroyed);
    assert_eq!(
        effects_of(&guard),
        before_gone,
        "a destroyed queued window must not produce an effect of its own"
    );

    guard
        .handle_reply("A", r, QuitAnswer::Discard, Some(vec![]), 3)
        .unwrap();

    assert_eq!(
        effects_of(&guard),
        vec![
            Effect::EmitAll(QuitEvent::Requested { request_id: r }),
            Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS),
            Effect::Activate("A".to_string()),
            Effect::EmitTo("A".to_string(), QuitEvent::Prompt { request_id: r }),
            // A's prompt was issued at now=2, so its delivery deadline is 2_002
            // (ADR-0029 §1) — measured from the prompt, not from the request.
            Effect::ArmTimer(r, 2 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS),
            Effect::Reply(true),
        ],
        "B must never be activated and never be prompted"
    );
    assert!(gate.is_closed());
}

// ── WI3-W2 ────────────────────────────────────────────────────────────────────

#[test]
fn w2_only_destroyed_reaches_the_coordinator() {
    // `WindowEvent::CloseRequested` is skipped: its `CloseRequestApi` has no
    // public constructor outside the tauri crate, so no test in this crate can
    // feed it. Manual gate G20 and the WI-9 grep cover that variant.
    // `ScaleFactorChanged` is skipped for the same reason: the variant is
    // `#[non_exhaustive]` in tauri 2.9.5.
    let inert = [
        tauri::WindowEvent::Focused(true),
        tauri::WindowEvent::Focused(false),
        tauri::WindowEvent::Moved(tauri::PhysicalPosition::new(1, 2)),
        tauri::WindowEvent::Resized(tauri::PhysicalSize::new(3, 4)),
        tauri::WindowEvent::ThemeChanged(tauri::Theme::Dark),
    ];

    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A"], 0));
    let effects_before = effects_of(&guard);
    let state_before = guard.snapshot();

    for event in &inert {
        on_window_event(&guard, "A", event);
        assert_eq!(
            effects_of(&guard),
            effects_before,
            "{event:?} produced an effect"
        );
        assert_eq!(
            guard.snapshot(),
            state_before,
            "{event:?} changed the coordinator state"
        );
    }

    guard
        .handle_reply("A", r, QuitAnswer::Clean, None, 5)
        .unwrap();
    assert_eq!(
        effects_of(&guard)
            .iter()
            .filter(|e| matches!(e, Effect::Reply(_)))
            .collect::<Vec<_>>(),
        vec![&Effect::Reply(true)],
        "A was still awaited, so no inert event may have been taken for a gone"
    );

    // A `Destroyed` with no request pending is a no-op, not a panic.
    let idle = recording_guard(leak_gate());
    on_window_event(&idle, "A", &tauri::WindowEvent::Destroyed);
    assert!(effects_of(&idle).is_empty());

    // Control: the same event during phase 1 really does resolve the request,
    // so the assertions above are not vacuous.
    let control = recording_guard(leak_gate());
    later(control.begin(&["A"], 0));
    on_window_event(&control, "A", &tauri::WindowEvent::Destroyed);
    assert_eq!(effects_of(&control).last(), Some(&Effect::Reply(true)));
}
