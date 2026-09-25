//! Specification for the ADR-0029 deadlines: cases WI-BLOCK1-Q1 .. Q8.
//!
//! One law, in two halves:
//!
//! - **The request always has exactly one live deadline, or none on purpose.**
//!   An early tick re-arms it instead of dropping it, and a prompt's deadline is
//!   measured from the instant that prompt was issued.
//! - **A deadline bounds machine progress, never a person.** The webview has
//!   `QUIT_PROMPT_DELIVERY_TIMEOUT_MS` to get the dialog on screen; once it has,
//!   the user has as long as they like to read it.
//!
//! These are the cases the pre-ADR-0029 liveness defect fails: the single ack
//! timer fired once and was never re-armed, so a window that was prompted and
//! never answered left `NSTerminateLater` outstanding for ever — no alert, no
//! log line, and Force Quit as the only way out.

use super::coordinator_recheck_tests::fixtures::{commit_after_backstop, through_recheck};
use super::coordinator_tests::{begin_later, discard, ignored, norm, prompt};
use super::*;

/// The `Prompt` step with its deadline intact. `coordinator_tests::prompt`
/// normalises the deadline away; these cases are about the deadline.
fn prompt_at(label: &str, deadline_ms: u64) -> Step {
    Step::Prompt {
        label: label.to_string(),
        deadline_ms,
    }
}

fn fallback(labels: &[&str]) -> Step {
    Step::NativeFallback {
        timed_out: labels.iter().map(|s| (*s).to_string()).collect(),
    }
}

fn abort_by(label: &str) -> Step {
    Step::Abort {
        reason: AbortReason::Cancelled {
            by: label.to_string(),
        },
    }
}

// --- Q1: an early tick re-arms, and hands back the same deadline -------------

#[test]
fn q1_a_tick_before_the_deadline_re_arms_it_rather_than_dropping_it() {
    assert_eq!(QUIT_PROMPT_DELIVERY_TIMEOUT_MS, 2_000);

    let mut c = QuitCoordinator::new();
    let _r = begin_later(&mut c, &["a"], 1_000);
    let deadline = 1_000 + QUIT_ACK_TIMEOUT_MS;

    // Every early tick asks to be woken again at the *same* instant. A `Wait`
    // here is the defect: it is the request's only wake-up, silently spent.
    // `0` is also the backwards-clock case — it re-arms, it never times out.
    // Since D16F WI-9 the production clock is monotonic, so a backwards read
    // cannot happen there; this stays as a defensive case for the coordinator.
    for now in [0, 1, 999, 1_000, deadline - 1] {
        assert_eq!(
            c.on_tick(now),
            Step::Rearm {
                deadline_ms: deadline
            },
            "a tick at {now} must re-arm for {deadline}"
        );
    }
    assert_eq!(c.on_tick(deadline), fallback(&["a"]));
}

// --- Q2: a prompt's deadline starts when the prompt does ---------------------

#[test]
fn q2_a_prompts_deadline_is_measured_from_the_prompt_not_from_the_request() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);

    // Phase 1 takes almost the whole ack budget, which is ordinary on a cold
    // start: the windows answer at 1900ms of a 2000ms allowance.
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1_900), Step::Wait);
    assert_eq!(
        c.on_answer(r, "b", Answer::Clean, 1_900),
        prompt_at("a", 1_900 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS),
        "the delivery budget starts when the prompt is issued, not when the quit began"
    );

    // 100ms past the request's phase-1 deadline, and 1.8s short of the prompt's.
    // Falling back here would put the alert over a dialog that is still being
    // drawn.
    assert_eq!(
        c.on_tick(2_100),
        Step::Rearm { deadline_ms: 3_900 },
        "a prompt issued at 1900 has until 3900"
    );
    assert_eq!(c.on_tick(3_899), Step::Rearm { deadline_ms: 3_900 });
    assert_eq!(c.on_tick(3_900), fallback(&["a"]));
}

// --- Q3: the delivery ack buys unbounded human time --------------------------

#[test]
fn q3_a_delivered_ack_hands_the_window_unbounded_time_to_decide() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a"], 0);
    assert_eq!(
        c.on_answer(r, "a", Answer::Dirty, 1),
        prompt_at("a", 1 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS)
    );
    assert_eq!(
        c.on_answer(r, "a", Answer::Delivered, 2),
        Step::Wait,
        "the ack ends the bounded part of phase 2; it decides nothing"
    );

    // The dialog is on screen. Reading it is not a machine failing to make
    // progress, so no tick may ever seize the request from here.
    for now in [3, 2_001, 2_002, 3_600_000, 86_400_000] {
        assert_eq!(
            c.on_tick(now),
            Step::Wait,
            "a tick at {now} must not put an alert over the user's Save dialog"
        );
    }
    let step = c.on_answer(r, "a", discard(&["a1"]), 86_400_001);
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    let step = through_recheck(&mut c, r, step, 86_400_002);
    assert_eq!(
        step,
        // ADR-0035 changes the spec: commit is now preceded by a re-check round (and a backstop round).
        commit_after_backstop(&["a1"]),
        "the answer is still accepted a day later"
    );
}

// --- Q4: a prompt nobody acked does time out, naming only that window --------

#[test]
fn q4_a_prompt_that_is_never_acked_reaches_the_alert_naming_only_that_window() {
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    assert_eq!(
        c.on_answer(r, "b", Answer::Clean, 2),
        prompt_at("a", 2 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS)
    );

    assert_eq!(
        c.on_tick(2_001),
        Step::Rearm { deadline_ms: 2_002 },
        "one ms early is early"
    );
    assert_eq!(
        c.on_tick(2_002),
        fallback(&["a"]),
        "b answered and is settled; only the window whose dialog never appeared is named"
    );
    assert_eq!(
        c.on_answer(r, "a", Answer::Delivered, 2_003),
        ignored(IgnoredWhy::FallbackOwns),
        "a webview that recovers mid-alert cannot take the request back"
    );
}

// --- Q5: a deciding window is never named by the alert -----------------------

#[test]
fn q5_a_window_that_is_deciding_is_never_named_by_the_alert() {
    // The matrix's shape — a deciding window while another is still `Pending` —
    // is unreachable by construction: phase 2 does not begin until every window
    // has acked, so nothing is `Pending` once anything is deciding. The
    // reachable form of the same law is a window deciding while another is
    // queued behind it, and then that queued window's own prompt timing out.
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &["a", "b"], 0);
    assert_eq!(c.on_answer(r, "a", Answer::Dirty, 1), Step::Wait);
    assert_eq!(norm(c.on_answer(r, "b", Answer::Dirty, 2)), prompt("a"));
    assert_eq!(c.on_answer(r, "a", Answer::Delivered, 3), Step::Wait);

    // a is deciding and b is queued behind it: no deadline is running at all,
    // and neither window can be named.
    assert_eq!(c.on_tick(3_600_000), Step::Wait);

    // a decides; b is prompted and its webview never acks.
    assert_eq!(
        c.on_answer(r, "a", discard(&["a1"]), 3_600_001),
        prompt_at("b", 3_600_001 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS)
    );
    assert_eq!(
        c.on_tick(3_600_001 + QUIT_PROMPT_DELIVERY_TIMEOUT_MS),
        fallback(&["b"]),
        "a has settled; the alert names b alone"
    );
}

#[path = "coordinator_deadline_phase_tests.rs"]
mod coordinator_deadline_phase_tests;
