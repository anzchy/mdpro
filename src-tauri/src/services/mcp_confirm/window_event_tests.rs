//! `on_window_event` (ADR-0042 WI-4): only `WindowEvent::Destroyed` has an
//! effect, and only on the queue of the label it names (matrix W-1, W-2),
//! plus the structural half of that law, SG-1(viii).

use tauri::{PhysicalPosition, PhysicalSize, Theme, WindowEvent};

use super::on_window_event;
use crate::services::mcp_confirm::payload::CONFIRM_RESOLVED_EVENT;
use crate::services::mcp_confirm::queue::{Cause, Outcome, ReplyVerdict};
use crate::services::mcp_confirm::test_effects::*;

fn window_of(call: &Call) -> &str {
    match call {
        Call::Emit { window, .. } | Call::FailedEmit { window, .. } => window,
        Call::Attention { window } => window,
    }
}

/// W-1: A holds r0 (shown) and r1 (queued), B holds r2 (shown).
/// `Destroyed` in A cancels A's two as `WindowClosed` and sends A nothing.
#[tokio::test(start_paused = true)]
async fn w1_destroyed_a_cancels_a_only_with_no_call_to_a() {
    let fx = RecordingEffects::new();
    let b = broker(&fx);
    let a0 = spawn_confirm(&b, "A");
    settle().await;
    let a1 = spawn_confirm(&b, "A");
    settle().await;
    let b2 = spawn_confirm(&b, "B");
    settle().await;
    assert_eq!(b.shown("A").as_deref(), Some("r0"), "precondition");
    assert_eq!(b.shown("B").as_deref(), Some("r2"), "precondition");
    let before = fx.calls().len();

    on_window_event(b.as_ref(), "A", &WindowEvent::Destroyed);
    settle().await;

    assert_eq!(outcome(a0).await, Outcome::Cancelled(Cause::WindowClosed));
    assert_eq!(outcome(a1).await, Outcome::Cancelled(Cause::WindowClosed));
    let after = fx.calls();
    let to_a: Vec<&Call> = after[before..]
        .iter()
        .filter(|c| window_of(c) == "A")
        .collect();
    assert!(to_a.is_empty(), "calls to the destroyed window: {to_a:?}");
    assert_eq!(b.shown("A"), None);
    assert_eq!(b.shown("B").as_deref(), Some("r2"), "B untouched");
    assert!(!b2.is_finished(), "B's waiter must still be pending");
    assert_eq!(b.pending_len(), 1);
    assert_eq!(b.reply("r2", "B", true), Ok(ReplyVerdict::Resolved));
    assert_eq!(outcome(b2).await, Outcome::Approved);
}

fn events() -> Vec<WindowEvent> {
    vec![
        WindowEvent::Destroyed,
        WindowEvent::Focused(true),
        WindowEvent::Focused(false),
        WindowEvent::Moved(PhysicalPosition::new(1, 2)),
        WindowEvent::Resized(PhysicalSize::new(3, 4)),
        WindowEvent::ThemeChanged(Theme::Dark),
    ]
}

/// W-2: events × labels. `CloseRequested` and `ScaleFactorChanged` cannot be
/// constructed outside tauri; SG-1(viii) below and manual G5b cover them.
#[tokio::test(start_paused = true)]
async fn w2_only_destroyed_on_the_owner_has_an_effect() {
    let mut pairs = 0;
    for index in 0..events().len() {
        for label in ["A", "B", "C"] {
            let event = &events()[index];
            let fx = RecordingEffects::new();
            let b = broker(&fx);
            let wa = spawn_confirm(&b, "A");
            settle().await;
            let wb = spawn_confirm(&b, "B");
            settle().await;
            let before = fx.calls();

            on_window_event(b.as_ref(), label, event);
            settle().await;

            let destroyed = matches!(event, WindowEvent::Destroyed);
            let hit_a = destroyed && label == "A";
            let hit_b = destroyed && label == "B";
            let at = format!("({event:?}, {label})");
            assert_eq!(wa.is_finished(), hit_a, "A waiter at {at}");
            assert_eq!(wb.is_finished(), hit_b, "B waiter at {at}");
            let expected_len = 2 - usize::from(hit_a) - usize::from(hit_b);
            assert_eq!(b.pending_len(), expected_len, "pending at {at}");
            let shown_a = (!hit_a).then(|| "r0".to_string());
            let shown_b = (!hit_b).then(|| "r1".to_string());
            assert_eq!(b.shown("A"), shown_a, "A shown at {at}");
            assert_eq!(b.shown("B"), shown_b, "B shown at {at}");
            if hit_a {
                assert_eq!(outcome(wa).await, Outcome::Cancelled(Cause::WindowClosed));
            } else if hit_b {
                assert_eq!(outcome(wb).await, Outcome::Cancelled(Cause::WindowClosed));
            } else {
                assert_eq!(fx.calls(), before, "inert pair {at} made a call");
            }
            let resolved = fx
                .calls()
                .iter()
                .filter(|c| matches!(c, Call::Emit { event, .. } if event == CONFIRM_RESOLVED_EVENT))
                .count();
            assert_eq!(resolved, 0, "no confirm_resolved at {at}");
            pairs += 1;
        }
    }
    assert_eq!(pairs, 18, "events x labels");
}

/// The text of `fn on_window_event`'s body in `mod.rs`, braces excluded.
fn on_window_event_body() -> String {
    let source = include_str!("mod.rs");
    let start = source
        .find("pub fn on_window_event")
        .expect("premise: on_window_event is defined in mod.rs");
    let open = start + source[start..].find('{').expect("premise: a body");
    let mut depth = 0usize;
    for (offset, ch) in source[open..].char_indices() {
        if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return source[open + 1..open + offset].to_string();
            }
        }
    }
    panic!("premise: on_window_event's body is balanced");
}

/// True iff `text` has `match`, then optional `&` / `*`, then `event` as a
/// word: the `\bmatch\s+&?\s*\*?\s*event\b` of SG-1(viii).
fn has_match_on_event(text: &str) -> bool {
    let bytes = text.as_bytes();
    let word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let mut from = 0;
    while let Some(pos) = text[from..].find("match") {
        let at = from + pos;
        from = at + 5;
        if at > 0 && word(bytes[at - 1]) {
            continue;
        }
        let rest = &text[at + 5..];
        if !rest.starts_with(char::is_whitespace) {
            continue;
        }
        let rest = rest.trim_start();
        let rest = rest.strip_prefix('&').unwrap_or(rest).trim_start();
        let rest = rest.strip_prefix('*').unwrap_or(rest).trim_start();
        if let Some(after) = rest.strip_prefix("event") {
            if !after.bytes().next().is_some_and(word) {
                return true;
            }
        }
    }
    false
}

#[test]
fn sg1_viii_the_match_detector_detects() {
    assert!(has_match_on_event("match event {"));
    assert!(has_match_on_event("x; match &*event {"));
    assert!(has_match_on_event("match  & event{"));
    assert!(!has_match_on_event("matches!(event, X)"));
    assert!(!has_match_on_event("match events {"));
    assert!(!has_match_on_event("match other {"));
}

/// SG-1(viii): exactly one `matches!(event, [tauri::]WindowEvent::Destroyed
/// [{ .. }])`, no `match` on the event, and no `CloseRequested` token.
#[test]
fn sg1_viii_on_window_event_tests_destroyed_with_matches_only() {
    let body = on_window_event_body();
    let calls: Vec<&str> = body.split("matches!(").skip(1).collect();
    assert_eq!(calls.len(), 1, "exactly one matches! in: {body}");
    let arg = calls[0]
        .split(')')
        .next()
        .expect("premise: matches! closes")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let allowed = [
        "event, WindowEvent::Destroyed",
        "event, tauri::WindowEvent::Destroyed",
        "event, WindowEvent::Destroyed { .. }",
        "event, tauri::WindowEvent::Destroyed { .. }",
    ];
    assert!(allowed.contains(&arg.as_str()), "matches! argument: {arg}");
    assert!(!arg.contains('|'), "no alternation");
    assert!(!has_match_on_event(&body), "no match on the event: {body}");
    assert!(!body.contains("CloseRequested"), "CloseRequested is vetoable");
}
