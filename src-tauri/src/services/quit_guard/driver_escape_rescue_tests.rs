//! WI-3 (plan-20260925-155408) G1: the escape hatch rescues every request, not
//! only the first. Moved from `driver_escape_tests.rs` when the fallback-cause
//! migration (plan-20260925-232104 WI-2) would have pushed that file past its
//! line budget; the same migration made it assert `FallbackCause::Escape`.
//!
//! Law: each request an escape rescues gets exactly one alert, with cause
//! `Escape`, and exactly one `fallback` escape line.

use super::fixtures::{escape_lines_for, in_home};
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, guard_at_with, later, leak_gate, Effect,
};
use crate::HOME_LOCK;
use serde_json::Value;

fn s(labels: &[&str]) -> Vec<String> {
    labels.iter().map(|l| l.to_string()).collect()
}

fn fallback_on(g: &QuitGuard<impl QuitEffects>) -> bool {
    g.snapshot().live_request().is_some_and(|r| r.fallback)
}

/// G1: the hatch rescues every request, not only the first.
#[test]
fn dx16_escape_rescues_each_request_not_only_the_first() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx16");
    let g = guard_at_with(10_700, leak_gate());

    for (i, resolve) in [
        Some(FallbackAnswer::KeepOpen),
        Some(FallbackAnswer::QuitAnyway),
        None,
    ]
    .into_iter()
    .enumerate()
    {
        let r = later(g.begin(&["a"], 100 * i as u64));
        let mark = effects_of(&g).len();
        g.escape();
        assert_eq!(
            effects_of(&g)[mark..],
            [Effect::NativeFallback(r, s(&["a"]), FallbackCause::Escape)],
            "request {i}"
        );
        assert!(fallback_on(&g), "request {i}");
        let fallback_lines: Vec<Value> = escape_lines_for(&home, r)
            .into_iter()
            .filter(|v| v["context"]["outcome"] == "fallback")
            .collect();
        assert_eq!(fallback_lines.len(), 1, "request {i}: {fallback_lines:?}");
        if let Some(answer) = resolve {
            g.fallback_answer(r, answer);
        }
    }
}
