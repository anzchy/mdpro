//! ADR-0035 WI-4: the driver's backstop arm (DR-3, DR-4, DR-6, DR-7).
//!
//! Registered from `driver_backstop_log_tests.rs` (`mod.rs` and
//! `driver_tests.rs` are at their line budget). The
//! platform is `RecordingEffects`. DR-6 deletes real draft bundles, so it runs
//! under `HOME_LOCK` in a temp `$HOME`.
//!
//! Law: `Reply(true)` is recorded at most once per request, only after every
//! live window's `Drafted` or the backstop deadline, never while a live window
//! is still drafting before that deadline; every deletion observes the gate
//! held closed.

use crate::services::draft;
use crate::services::quit_guard::coordinator::QUIT_BACKSTOP_TIMEOUT_MS;
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    bundle, drafts_dir, effects_of, later, leak_gate, make_temp_home, recording_guard, set_home,
    Effect, RecordingEffects,
};
use crate::HOME_LOCK;

fn replies(guard: &QuitGuard<RecordingEffects>) -> usize {
    effects_of(guard)
        .iter()
        .filter(|e| matches!(e, Effect::Reply(_)))
        .count()
}

/// Two windows, both clean twice: the backstop is issued at 40.
fn to_backstop_at_40(guard: &QuitGuard<RecordingEffects>) -> u64 {
    let r = later(guard.begin(&["a", "b"], 0));
    for (label, now) in [("a", 10), ("b", 20), ("a", 30), ("b", 40)] {
        guard
            .handle_reply(label, r, QuitAnswer::Clean, None, now)
            .unwrap();
    }
    r
}

// ── DR-3 ──────────────────────────────────────────────────────────────────────

#[test]
fn dr3_no_reply_while_a_live_window_is_drafting_before_the_deadline() {
    let guard = recording_guard(leak_gate());
    let r = to_backstop_at_40(&guard);
    assert_eq!(replies(&guard), 0, "replied before the backstop answers");

    guard.handle_drafted("a", r, (1, 0), 50);
    assert_eq!(replies(&guard), 0, "replied while b was still drafting");
    guard.tick(1_000);
    assert_eq!(replies(&guard), 0, "replied at an early tick");
    guard.tick(40 + QUIT_BACKSTOP_TIMEOUT_MS - 1);
    assert_eq!(replies(&guard), 0, "replied one ms before the deadline");
    assert_eq!(
        effects_of(&guard).last(),
        Some(&Effect::ArmTimer(r, 40 + QUIT_BACKSTOP_TIMEOUT_MS)),
        "an early tick must re-arm the backstop deadline"
    );

    let before = effects_of(&guard).len();
    guard.tick(40 + QUIT_BACKSTOP_TIMEOUT_MS);
    let added = effects_of(&guard)[before..].to_vec();
    assert_eq!(replies(&guard), 1);
    assert!(added.contains(&Effect::Reply(true)), "added {added:?}");
    assert!(
        !added
            .iter()
            .any(|e| matches!(e, Effect::NativeFallback(..))),
        "the backstop deadline commits; it never draws the alert: {added:?}"
    );
}

// ── DR-4 ──────────────────────────────────────────────────────────────────────

#[test]
fn dr4_a_failed_backstop_broadcast_still_commits_at_the_deadline() {
    let guard = recording_guard(leak_gate());
    guard
        .effects()
        .fail(|f| f.emit_all = vec!["app:quit-backstop"]);
    let r = later(guard.begin(&["a"], 0));
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 10)
        .unwrap();
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 20)
        .unwrap();
    assert_eq!(
        effects_of(&guard).last(),
        Some(&Effect::ArmTimer(r, 20 + QUIT_BACKSTOP_TIMEOUT_MS)),
        "a failed backstop broadcast must still arm its deadline"
    );

    guard.tick(20 + QUIT_BACKSTOP_TIMEOUT_MS);
    assert_eq!(replies(&guard), 1);
    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
    assert_eq!(guard.last_commit_report().unwrap().draft_missing, 1);
}

// ── DR-6 ──────────────────────────────────────────────────────────────────────

#[test]
fn dr6_deletes_observe_the_gate_held_closed_after_a_backstop() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_dr6");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    for id in ["x", "y"] {
        draft::save_draft(id, "BODY", None, "t").unwrap();
        assert!(bundle(&drafts, id).exists(), "setup: {id} was not saved");
    }

    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["a"], 0));
    guard
        .handle_reply("a", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    let discard = Some(vec!["x".to_string(), "y".to_string()]);
    guard
        .handle_reply("a", r, QuitAnswer::Discard, discard, 2)
        .unwrap();
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 3)
        .unwrap();
    guard.handle_drafted("a", r, (1, 0), 4);

    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
    let mut deletes = guard.effects().deletes();
    deletes.sort();
    assert_eq!(
        deletes,
        vec![("x".to_string(), true), ("y".to_string(), true)],
        "every deletion must run with the gate held closed"
    );
    for id in ["x", "y"] {
        assert!(!bundle(&drafts, id).exists(), "{id} survived the commit");
    }
}

// ── DR-7 ──────────────────────────────────────────────────────────────────────

#[test]
fn dr7_a_window_destroyed_during_the_backstop_lets_the_commit_proceed() {
    let guard = recording_guard(leak_gate());
    let r = to_backstop_at_40(&guard);
    guard.handle_drafted("a", r, (1, 0), 50);
    assert_eq!(replies(&guard), 0);

    guard.window_gone("b", 60);
    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
    assert_eq!(replies(&guard), 1);
    assert_eq!(guard.last_commit_report().unwrap().draft_missing, 0);
}
