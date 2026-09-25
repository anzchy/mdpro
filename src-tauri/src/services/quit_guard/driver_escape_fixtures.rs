//! Fixtures for the WI-3 escape specifications (`driver_escape_tests.rs`,
//! `driver_escape_log_tests.rs`). `driver_fixtures.rs` is at its line budget,
//! so everything the escape cases add lives here.
//!
//! Request-id band: 10_000-10_990. No other `guard_at` floor reaches it.

use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    effects_of, fresh_log_home, guard_at, later, leak_gate, log_lines, set_home, Effect,
    HomeRestorer, RecordingEffects,
};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, Weak};

/// A fresh log HOME, already set. Caller holds `HOME_LOCK`.
pub(super) fn in_home(label: &str) -> (PathBuf, HomeRestorer) {
    let home = fresh_log_home(label);
    let restorer = set_home(&home);
    (home, restorer)
}

/// Every `app.quit.escape` line in `home`, in file order. An idle line carries
/// no `requestId`, so this filters by event only; every writer of this event
/// holds `HOME_LOCK`.
pub(super) fn escape_lines(home: &Path) -> Vec<Value> {
    log_lines(home)
        .into_iter()
        .filter(|v| v.get("event").and_then(Value::as_str) == Some("app.quit.escape"))
        .collect()
}

/// The escape lines for request `r`.
pub(super) fn escape_lines_for(home: &Path, r: u64) -> Vec<Value> {
    escape_lines(home)
        .into_iter()
        .filter(|v| v.pointer("/context/requestId").and_then(Value::as_u64) == Some(r))
        .collect()
}

/// The raw text of every escape line, for substring checks.
pub(super) fn raw_escape_lines(home: &Path) -> Vec<String> {
    let raw = std::fs::read_to_string(home.join(".mdpro").join("mdpro.log")).unwrap_or_default();
    raw.lines()
        .filter(|l| l.contains("\"app.quit.escape\""))
        .map(str::to_string)
        .collect()
}

/// How many `NativeFallback` effects were recorded for `r`.
pub(super) fn alerts_for(effects: &[Effect], r: u64) -> Vec<Vec<String>> {
    effects
        .iter()
        .filter_map(|e| match e {
            Effect::NativeFallback(id, labels) if *id == r => Some(labels.clone()),
            _ => None,
        })
        .collect()
}

/// The escape line's `(outcome, reason)` agrees with the `phase` it names.
pub(super) fn consistent(line: &Value) -> bool {
    let ctx = &line["context"];
    let outcome = ctx["outcome"].as_str();
    let reason = ctx.get("reason").and_then(Value::as_str);
    let phase = ctx["phase"].as_str();
    matches!(
        (outcome, reason, phase),
        (
            Some("fallback"),
            None,
            Some("checking" | "awaitingDelivery" | "deciding")
        ) | (Some("ignored"), Some("fallbackOwns"), Some("fallback"))
            | (Some("ignored"), Some("outOfPhase"), Some("backstop"))
            | (Some("noop"), None | Some("noGuard"), Some("idle"))
    )
}

fn reply(g: &QuitGuard<RecordingEffects>, label: &str, r: u64, answer: QuitAnswer, t: u64) {
    g.handle_reply(label, r, answer, None, t).unwrap();
}

/// `a` Dirty, `b` Clean, then `a` Delivered: `a` is Deciding with no deadline
/// armed, which no tick can rescue (dx2).
pub(super) fn to_deciding(g: &QuitGuard<RecordingEffects>) -> u64 {
    let r = later(g.begin(&["a", "b"], 0));
    reply(g, "a", r, QuitAnswer::Dirty, 1);
    reply(g, "b", r, QuitAnswer::Clean, 2);
    reply(g, "a", r, QuitAnswer::Delivered, 3);
    r
}

/// `a` Dirty, Delivered, then `Discard(["d1"])`: re-check round 1 starts.
pub(super) fn to_recheck_with_discard(g: &QuitGuard<RecordingEffects>) -> u64 {
    let r = later(g.begin(&["a"], 0));
    reply(g, "a", r, QuitAnswer::Dirty, 1);
    reply(g, "a", r, QuitAnswer::Delivered, 2);
    g.handle_reply("a", r, QuitAnswer::Discard, Some(vec!["d1".into()]), 3)
        .unwrap();
    assert_eq!(g.snapshot().round(), Some(1), "re-check round 1 started");
    r
}

/// Windows `a`, `b`, Clean at 0/1 (round 0) and 2/3 (round 1): the backstop
/// is issued in round 1 and both windows are Drafting.
pub(super) fn to_backstop_guard(floor: u64) -> (QuitGuard<RecordingEffects>, u64) {
    let g = guard_at(floor);
    let r = later(g.begin(&["a", "b"], 0));
    for (label, t) in [("a", 0), ("b", 1), ("a", 2), ("b", 3)] {
        reply(&g, label, r, QuitAnswer::Clean, t);
    }
    let effects = effects_of(&g);
    assert!(
        matches!(
            effects.iter().rev().nth(1),
            Some(Effect::EmitAll(QuitEvent::Backstop { request_id, round: 1 })) if *request_id == r
        ),
        "the backstop must be open in round 1: {effects:?}"
    );
    (g, r)
}

/// A platform whose alert is answered from inside `native_fallback`, the way
/// the nested `runModal` answers it on the main thread (dx13).
#[derive(Default)]
pub(super) struct EscapeReentrantEffects {
    pub inner: RecordingEffects,
    pub guard: OnceLock<Weak<QuitGuard<EscapeReentrantEffects>>>,
}

impl QuitEffects for EscapeReentrantEffects {
    fn emit_all(&self, event: QuitEvent) -> bool {
        self.inner.emit_all(event)
    }
    fn emit_to(&self, label: &str, event: QuitEvent) -> bool {
        self.inner.emit_to(label, event)
    }
    fn activate(&self, label: &str) -> bool {
        self.inner.activate(label)
    }
    fn arm_timer(&self, request_id: u64, deadline_ms: u64) {
        self.inner.arm_timer(request_id, deadline_ms);
    }
    fn reply(&self, terminate: bool) -> bool {
        self.inner.reply(terminate)
    }
    fn native_fallback(&self, request_id: u64, timed_out: Vec<String>) -> bool {
        let posted = self.inner.native_fallback(request_id, timed_out);
        if let Some(guard) = self.guard.get().and_then(Weak::upgrade) {
            guard.fallback_answer(request_id, FallbackAnswer::KeepOpen);
        }
        posted
    }
}

/// A re-entrant guard whose next request id is `floor` (same burn as
/// `guard_at`). Caller holds `HOME_LOCK`.
pub(super) fn reentrant_guard_at(floor: u64) -> Arc<QuitGuard<EscapeReentrantEffects>> {
    use crate::models::{LogLevel, LogSettings};
    use crate::services::logger;
    let settings = |enabled| LogSettings {
        enabled,
        level: LogLevel::Info,
    };
    logger::set_log_settings(settings(false));
    let guard = Arc::new(QuitGuard::with_gate(
        EscapeReentrantEffects::default(),
        leak_gate(),
    ));
    for _ in 1..floor {
        later(guard.begin(&["burn"], 0));
        guard.window_gone("burn", 0);
    }
    logger::set_log_settings(settings(true));
    let _ = guard.effects().guard.set(Arc::downgrade(&guard));
    guard
}
