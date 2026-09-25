//! ADR-0035 WI-4: `translate` for the round steps (PL-1, PL-2) and the driver's
//! re-check arm (DR-1, DR-2, DR-5).
//!
//! Registered from `driver_backstop_log_tests.rs` (`mod.rs` and
//! `driver_tests.rs` are at their line budget). The platform is
//! `RecordingEffects`; no Tauri adapter runs under `cargo test`.
//!
//! Law: a `Recheck` or `Backstop` plan never resolves the request, so the
//! driver's `current` id survives it; the re-check reuses `app:quit-requested`
//! with the next round, and a failed broadcast still arms its deadline.

use crate::services::quit_guard::coordinator::{BackstopTally, QUIT_BACKSTOP_TIMEOUT_MS};
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, later, leak_gate, recording_guard, Effect,
};
use crate::services::quit_guard::plan::{translate, Plan};

// ── PL-1 ──────────────────────────────────────────────────────────────────────

#[test]
fn pl1_resolves_request_over_every_step_variant() {
    let tally = BackstopTally {
        drafted: 1,
        failed: 0,
        missing: 0,
        capped: 0,
        // ADR-0035 review M-1: compile-only — the tally gained an `undiscarded` count; no redraft here.
        undiscarded: 0,
    };
    let rows: Vec<(Step, Plan, Option<IgnoredWhy>, bool)> = vec![
        (Step::Wait, Plan::Nothing, None, false),
        (
            Step::Rearm { deadline_ms: 900 },
            Plan::Rearm {
                request_id: 7,
                deadline_ms: 900,
            },
            None,
            false,
        ),
        (
            Step::Prompt {
                label: "a".to_string(),
                deadline_ms: 800,
            },
            Plan::Prompt {
                request_id: 7,
                label: "a".to_string(),
                deadline_ms: 800,
                round: 1,
            },
            None,
            false,
        ),
        (
            Step::Recheck {
                deadline_ms: 2_700,
                window_count: 2,
            },
            Plan::Recheck {
                request_id: 7,
                deadline_ms: 2_700,
                window_count: 2,
                round: 1,
            },
            None,
            false,
        ),
        (
            Step::Backstop {
                deadline_ms: 3_100,
                window_count: 2,
            },
            Plan::Backstop {
                request_id: 7,
                deadline_ms: 3_100,
                window_count: 2,
                round: 1,
            },
            None,
            false,
        ),
        (
            Step::Commit {
                discard_document_ids: vec!["d".to_string()],
                backstop: Some(tally),
            },
            Plan::Commit {
                request_id: 7,
                discard_document_ids: vec!["d".to_string()],
                backstop: Some(tally),
            },
            None,
            true,
        ),
        (
            Step::Abort {
                reason: AbortReason::UserKeptOpen,
            },
            Plan::Abort {
                request_id: 7,
                reason: AbortReason::UserKeptOpen,
                round: 1,
            },
            None,
            true,
        ),
        (
            Step::NativeFallback {
                timed_out: vec!["a".to_string()],
            },
            Plan::Fallback {
                request_id: 7,
                timed_out: vec!["a".to_string()],
            },
            None,
            false,
        ),
        (
            Step::Ignored {
                why: IgnoredWhy::Duplicate,
            },
            Plan::Nothing,
            Some(IgnoredWhy::Duplicate),
            false,
        ),
    ];
    for (step, plan, why, resolves) in rows {
        let label = format!("{step:?}");
        let (got, got_why) = translate(step, 7, 1);
        assert_eq!(got, plan, "{label}");
        assert_eq!(got_why, why, "{label}");
        assert_eq!(got.resolves_request(), resolves, "{label}");
    }
}

// ── PL-2 ──────────────────────────────────────────────────────────────────────

#[test]
fn pl2_current_survives_a_recheck() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["a"], 0));
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 10)
        .unwrap();
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 20)
        .unwrap();

    assert_ne!(r, 0);
    assert!(
        effects_of(&guard).contains(&Effect::EmitAll(QuitEvent::Backstop {
            request_id: r,
            round: 1
        })),
        "the backstop must carry the live request id: {:?}",
        effects_of(&guard)
    );
}

// ── DR-1 ──────────────────────────────────────────────────────────────────────

#[test]
fn dr1_the_full_clean_quit_effect_sequence() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["a"], 0));
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 10)
        .unwrap();
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 20)
        .unwrap();
    guard.handle_drafted("a", r, (1, 0), 30);

    assert_eq!(
        effects_of(&guard),
        vec![
            Effect::EmitAll(QuitEvent::Requested {
                request_id: r,
                round: 0
            }),
            Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS),
            Effect::EmitAll(QuitEvent::Requested {
                request_id: r,
                round: 1
            }),
            Effect::ArmTimer(r, 10 + QUIT_ACK_TIMEOUT_MS),
            Effect::EmitAll(QuitEvent::Backstop {
                request_id: r,
                round: 1
            }),
            Effect::ArmTimer(r, 20 + QUIT_BACKSTOP_TIMEOUT_MS),
            Effect::Reply(true),
        ]
    );
    assert_eq!(guard.snapshot().round(), None, "the request must be over");
}

// ── DR-2 ──────────────────────────────────────────────────────────────────────

#[test]
fn dr2_reprompt_activates_prompts_and_arms_a_second_time() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["a", "b"], 0));
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 10)
        .unwrap();
    guard
        .handle_reply("b", r, QuitAnswer::Clean, None, 20)
        .unwrap();
    guard
        .handle_reply("a", r, QuitAnswer::Dirty, None, 30)
        .unwrap();
    guard
        .handle_reply("b", r, QuitAnswer::Clean, None, 40)
        .unwrap();

    let effects = effects_of(&guard);
    assert_eq!(
        effects[effects.len() - 3..],
        [
            Effect::Activate("a".to_string()),
            Effect::EmitTo(
                "a".to_string(),
                QuitEvent::Prompt {
                    request_id: r,
                    round: 1
                }
            ),
            Effect::ArmTimer(r, 40 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS),
        ]
    );
}

// ── DR-5 ──────────────────────────────────────────────────────────────────────

#[test]
fn dr5_a_failed_recheck_broadcast_reaches_the_alert_at_its_deadline() {
    let guard = recording_guard(leak_gate());
    guard.effects().fail(|f| f.emit_all_calls = vec![2]);
    let r = later(guard.begin(&["a"], 0));
    guard
        .handle_reply("a", r, QuitAnswer::Clean, None, 10)
        .unwrap();

    assert_eq!(
        effects_of(&guard).last(),
        Some(&Effect::ArmTimer(r, 10 + QUIT_ACK_TIMEOUT_MS)),
        "a failed re-check broadcast must still arm its deadline"
    );
    guard.tick(10 + QUIT_ACK_TIMEOUT_MS);
    assert_eq!(
        effects_of(&guard).last(),
        Some(&Effect::NativeFallback(r, vec!["a".to_string()]))
    );
}
