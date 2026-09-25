//! WI-3 (plan-20260925-155408): `QuitGuard::escape` and `deliver_escape(Some)`
//! driven against the real coordinator, the real logger and the real draft
//! deletion; only the platform is `RecordingEffects`.
//!
//! Law: at most one `NativeFallback` per request, whichever source posted it;
//! an escape records no effect but `NativeFallback`; no effect runs under the
//! coordinator mutex.

use super::fixtures::{
    alerts_for, escape_lines_for, in_home, reentrant_guard_at, to_deciding, to_recheck_with_discard,
};
use crate::services::quit_guard::driver::*;
use crate::services::quit_guard::driver_fixtures::{
    bundle, drafts_dir, effects_of, entries_where, guard_at, guard_at_with, later, leak_gate,
    Effect,
};
use crate::HOME_LOCK;
use serde_json::Value;
use std::sync::mpsc;
use std::time::Duration;

fn s(labels: &[&str]) -> Vec<String> {
    labels.iter().map(|l| l.to_string()).collect()
}

fn fallback_on(g: &QuitGuard<impl QuitEffects>) -> bool {
    g.snapshot().live_request().is_some_and(|r| r.fallback)
}

#[test]
fn dx1_phase1_escape_posts_alert_without_reply() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (_home, _h) = in_home("dx1");
    let g = guard_at(10_000);
    let r = later(g.begin(&["w0", "w1"], 0));
    let mark = effects_of(&g).len();
    g.escape();
    assert_eq!(
        effects_of(&g)[mark..],
        [Effect::NativeFallback(r, s(&["w0", "w1"]))]
    );
    assert!(fallback_on(&g));
}

#[test]
fn dx2_deciding_escape_posts_alert_where_tick_cannot() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx2");
    let g = guard_at(10_050);
    let r = to_deciding(&g);
    let mark = effects_of(&g).len();
    g.tick(u64::MAX);
    assert_eq!(
        effects_of(&g).len(),
        mark,
        "the tick cannot rescue Deciding"
    );
    g.escape();
    assert_eq!(
        effects_of(&g)[mark..],
        [Effect::NativeFallback(r, s(&["a"]))]
    );
    assert!(fallback_on(&g));
    let lines = escape_lines_for(&home, r);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(lines[0]["context"]["outcome"], "fallback");
    assert_eq!(lines[0]["context"]["phase"], "deciding");
    assert_eq!(lines[0]["context"]["round"], 0);
    assert_eq!(lines[0]["context"]["unresolvedCount"], 1);
}

#[test]
fn dx5_late_answer_and_tick_after_escape_are_inert() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx5");
    let g = guard_at(10_200);
    let r = to_deciding(&g);
    g.escape();
    assert!(fallback_on(&g), "the escape must own the request first");
    let snap = g.snapshot();
    let mark = effects_of(&g).len();
    let answers_before = entries_where(&home, "app.quit.answer", r, |_| true).len();
    g.handle_reply("a", r, QuitAnswer::Discard, Some(vec!["d1".into()]), 10)
        .unwrap();
    g.handle_reply("b", r, QuitAnswer::Clean, None, 11).unwrap();
    g.tick(u64::MAX);
    assert_eq!(effects_of(&g).len(), mark, "{:?}", &effects_of(&g)[mark..]);
    assert_eq!(g.snapshot(), snap);
    let late = entries_where(&home, "app.quit.answer", r, |_| true)[answers_before..].to_vec();
    assert_eq!(late.len(), 2, "{late:?}");
    for line in &late {
        assert_eq!(line["status"], "fail", "{line}");
        let error = line["error"].as_str().unwrap_or("");
        assert!(error.ends_with("refused: fallbackOwns"), "{line}");
    }
}

#[test]
fn dx6_keep_open_after_escape_replies_false_and_gate_stays_open() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (_home, _h) = in_home("dx6");
    let gate = leak_gate();
    let g = guard_at_with(10_250, gate);
    let r = later(g.begin(&["a"], 0));

    g.escape();
    g.fallback_answer(r, FallbackAnswer::KeepOpen);

    assert_eq!(effects_of(&g).last(), Some(&Effect::Reply(false)));
    assert!(!gate.is_closed(), "KeepOpen must not commit");
    assert!(g.snapshot().round().is_none(), "the request is gone");
    match g.begin(&["a"], 10) {
        Begin::Later { request_id } => assert!(request_id > r),
        other => panic!("expected Later, got {other:?}"),
    }
}

#[test]
fn dx7_quit_anyway_after_escape_keeps_discarded_draft_on_disk() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx7");
    let drafts = drafts_dir(&home);
    std::fs::create_dir_all(&drafts).unwrap();
    std::fs::write(bundle(&drafts, "d1"), "{}").unwrap();
    let gate = leak_gate();
    let g = guard_at_with(10_300, gate);
    let r = to_recheck_with_discard(&g);

    g.escape();
    g.fallback_answer(r, FallbackAnswer::QuitAnyway);

    assert_eq!(effects_of(&g).last(), Some(&Effect::Reply(true)));
    assert!(gate.is_closed(), "QuitAnyway commits");
    assert!(
        drafts.join("d1.draft.json").exists(),
        "ADR-0027 §5: QuitAnyway deletes no drafts"
    );
    assert!(
        g.effects().deletes().is_empty(),
        "{:?}",
        g.effects().deletes()
    );
    assert_eq!(g.last_commit_report().unwrap().deleted, 0);
}

#[test]
fn dx8a_failed_alert_releases_then_second_escape_posts_again() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (_home, _h) = in_home("dx8a");
    let g = guard_at(10_350);
    let r = later(g.begin(&["solo"], 0));

    g.effects().fail(|f| f.native_fallback = true);
    g.escape();
    let released = g.snapshot();
    let req = released.live_request().expect("the request is still live");
    assert!(!req.fallback, "a failed alert hands the request back");
    assert_eq!(req.deadline_ms, None);

    g.effects().fail(|f| f.native_fallback = false);
    g.escape();
    assert_eq!(
        effects_of(&g).last(),
        Some(&Effect::NativeFallback(r, s(&["solo"])))
    );
    assert!(fallback_on(&g));
    // D8: `RecordingEffects` records a failed attempt too, so this is one
    // attempt per `escape()`.
    assert_eq!(alerts_for(&effects_of(&g), r).len(), 2);
}

#[test]
fn dx8b_failed_alert_hands_request_back_to_windows() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _h) = in_home("dx8b");
    let g = guard_at(10_400);
    let r = later(g.begin(&["solo"], 0));
    g.effects().fail(|f| f.native_fallback = true);
    g.escape();
    assert_eq!(
        alerts_for(&effects_of(&g), r).len(),
        1,
        "the alert was tried"
    );
    g.effects().fail(|f| f.native_fallback = false);
    let mark = effects_of(&g).len();

    g.handle_reply("solo", r, QuitAnswer::Clean, None, 1)
        .unwrap();

    let added = effects_of(&g)[mark..].to_vec();
    assert!(
        added.contains(&Effect::EmitAll(QuitEvent::Requested {
            request_id: r,
            round: 1
        })),
        "the answer must start the re-check: {added:?}"
    );
    let answers = entries_where(&home, "app.quit.answer", r, |_| true);
    assert_eq!(answers.len(), 1, "{answers:?}");
    assert_eq!(answers[0]["status"], "success");
}

#[test]
fn dx12_deliver_escape_some_is_the_direct_call() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (home1, h1) = in_home("dx12a");
    let g1 = guard_at(10_650);
    g1.begin(&["a", "b"], 0);
    deliver_escape(Some(&g1));
    drop(h1);
    let (home2, _h2) = in_home("dx12b");
    let g2 = guard_at(10_650);
    g2.begin(&["a", "b"], 0);
    g2.escape();

    assert_eq!(effects_of(&g1), effects_of(&g2));
    assert_eq!(g1.snapshot(), g2.snapshot());
    assert!(fallback_on(&g1));
    let mut lines = Vec::new();
    for home in [&home1, &home2] {
        let all = super::fixtures::escape_lines(home);
        assert_eq!(all.len(), 1, "exactly one escape line per HOME: {all:?}");
        assert!(all[0]["context"].get("reason").is_none(), "{all:?}");
        let mut ctx = all[0]["context"].clone();
        ctx["requestId"] = Value::Null;
        lines.push(ctx);
    }
    assert_eq!(lines[0], lines[1]);
}

#[test]
fn dx13_reentrant_alert_answer_does_not_deadlock() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (_home, _h) = in_home("dx13");
    let g = reentrant_guard_at(10_750);
    let r = later(g.begin(&["a"], 0));
    let mark = g.effects().inner.effects().len();
    let (tx, rx) = mpsc::channel();
    let worker = std::sync::Arc::clone(&g);

    std::thread::spawn(move || {
        worker.escape();
        let _ = tx.send(());
    });

    assert!(
        rx.recv_timeout(Duration::from_secs(2)).is_ok(),
        "escape deadlocked against the nested alert answer"
    );
    let added = g.effects().inner.effects()[mark..].to_vec();
    assert_eq!(
        added,
        [
            Effect::NativeFallback(r, s(&["a"])),
            Effect::EmitAll(QuitEvent::Cancelled {
                request_id: r,
                round: 0
            }),
            Effect::Reply(false),
        ]
    );
    assert!(g.snapshot().round().is_none(), "KeepOpen ended the request");
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
            [Effect::NativeFallback(r, s(&["a"]))],
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
