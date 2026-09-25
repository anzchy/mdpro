//! WI3-D5 .. D10, split out of `driver_tests.rs`.
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
use super::logging::{answer_log_context, commit_log_context};
use crate::services::draft;
use crate::HOME_LOCK;
use std::fs;

// ── WI3-D5 ────────────────────────────────────────────────────────────────────

#[test]
fn d5_document_ids_are_accepted_only_with_discard() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d5");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    // (answer, ids, accepted, deletes a1)
    let rows: [(QuitAnswer, Option<Vec<String>>, bool, bool); 12] = [
        (QuitAnswer::Clean, None, true, false),
        (QuitAnswer::Clean, Some(vec![]), false, false),
        (QuitAnswer::Clean, ids(&["a1"]), false, false),
        (QuitAnswer::Dirty, None, true, false),
        (QuitAnswer::Dirty, Some(vec![]), false, false),
        (QuitAnswer::Dirty, ids(&["a1"]), false, false),
        (QuitAnswer::Discard, None, true, false),
        (QuitAnswer::Discard, Some(vec![]), true, false),
        (QuitAnswer::Discard, ids(&["a1"]), true, true),
        (QuitAnswer::Cancel, None, true, false),
        (QuitAnswer::Cancel, Some(vec![]), false, false),
        (QuitAnswer::Cancel, ids(&["a1"]), false, false),
    ];

    for (answer, payload, accepted, deletes) in rows {
        for id in ["a1", "keep"] {
            draft::save_draft(id, "BODY", None, "t").unwrap();
        }
        let phase_two = matches!(answer, QuitAnswer::Discard | QuitAnswer::Cancel);
        let gate = leak_gate();
        let guard = recording_guard(gate);
        let r = later(guard.begin(&["A"], 0));
        if phase_two {
            guard
                .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
                .unwrap();
        }

        let row = format!("{answer:?} with {payload:?}");
        let result = guard.handle_reply("A", r, answer, payload.clone(), 2);
        assert_eq!(
            result.is_ok(),
            accepted,
            "row {row}: expected accepted={accepted}, got {result:?}"
        );
        // ADR-0035 changes the spec: commit is now preceded by a re-check round.
        let commits = |a: QuitAnswer| matches!(a, QuitAnswer::Clean | QuitAnswer::Discard);
        if accepted && commits(answer) {
            finish_quit(&guard, r, &["A"], 3);
        }

        if !accepted {
            // The refusal left the request answerable.
            let valid = if phase_two {
                QuitAnswer::Cancel
            } else {
                QuitAnswer::Clean
            };
            guard.handle_reply("A", r, valid, None, 3).unwrap();
            // ADR-0035 changes the spec: commit is now preceded by a re-check round.
            if commits(valid) {
                finish_quit(&guard, r, &["A"], 4);
            }
            assert!(
                matches!(effects_of(&guard).last(), Some(&Effect::Reply(_))),
                "row {row}: a refused reply left the request unresolved"
            );
        }

        assert_eq!(
            bundle(&drafts, "a1").exists(),
            !deletes,
            "row {row}: wrong outcome for the a1 draft"
        );
        assert!(
            bundle(&drafts, "keep").exists(),
            "row {row}: keep was deleted"
        );
    }
}

// ── WI3-D7 ────────────────────────────────────────────────────────────────────

// ADR-0027 supersedes ADR-0025 §3: an ack timeout hands the request to the
// native alert instead of counting as `cancel`. The plan's WI-3 bullet still
// says the tick itself emits cancelled and replies NO; that text predates
// Revision 3 and contradicts the WI-2 coordinator, whose `on_tick` returns
// `NativeFallback`. The contract asserted here is the Rev-3 one: the tick hands
// over, and the *alert's* KeepOpen answer emits cancelled and then replies NO,
// exactly once.
#[test]
fn d7_a_silent_window_hands_the_request_to_the_native_alert_and_replies_once() {
    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));

    assert_eq!(
        effects_of(&guard),
        vec![
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitAll(QuitEvent::Requested {
                request_id: r,
                round: 0
            }),
            Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS),
        ],
        "begin must ask every window and arm the ack timer"
    );

    guard
        .handle_reply("A", r, QuitAnswer::Clean, None, 10)
        .unwrap();
    let before_deadline = effects_of(&guard);

    guard.tick(QUIT_ACK_TIMEOUT_MS - 1);
    assert_eq!(
        effects_of(&guard)[before_deadline.len()..],
        [Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS)],
        "a tick before the deadline must re-arm it and do nothing else (ADR-0029 §5)"
    );
    let before_deadline = effects_of(&guard);

    guard.tick(QUIT_ACK_TIMEOUT_MS);
    let after_deadline = effects_of(&guard);
    assert_eq!(
        after_deadline[before_deadline.len()..],
        [Effect::NativeFallback(r, vec!["B".to_string()])],
        "the deadline must hand the request to the native alert, naming the silent window"
    );

    guard.tick(QUIT_ACK_TIMEOUT_MS + 1);
    guard
        .handle_reply("B", r, QuitAnswer::Dirty, None, 2_002)
        .unwrap();
    assert_eq!(
        effects_of(&guard),
        after_deadline,
        "a second tick and a late reply must not touch a request the alert owns"
    );

    guard.fallback_answer(r, FallbackAnswer::KeepOpen);
    let end = effects_of(&guard);
    assert_eq!(
        end[after_deadline.len()..],
        [
            // ADR-0035 changes the spec: the event payload carries `round` (A5).
            Effect::EmitAll(QuitEvent::Cancelled {
                request_id: r,
                round: 0
            }),
            Effect::Reply(false),
        ],
        "Keep Open must close the dialogs before it refuses the quit"
    );
    assert_eq!(
        end.iter().filter(|e| matches!(e, Effect::Reply(_))).count(),
        1,
        "AppKit must be answered exactly once per request"
    );
    assert!(!gate.is_closed(), "Keep Open must not commit the quit");
}

// ── WI3-D9 ────────────────────────────────────────────────────────────────────

#[test]
fn d9_a_draft_delete_that_fails_still_commits_and_replies_yes() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d9");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    draft::save_draft("a2", "BODY", None, "t").unwrap();
    // A directory where the bundle should be: `remove_file` on it fails.
    let blocked = bundle(&drafts, "a1");
    fs::create_dir_all(&blocked).unwrap();

    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("A", r, QuitAnswer::Discard, ids(&["a1", "a2"]), 2)
        .unwrap();
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    finish_quit(&guard, r, &["A"], 3);

    assert_eq!(
        effects_of(&guard).last(),
        Some(&Effect::Reply(true)),
        "a failed delete must not block the quit"
    );
    assert!(
        !bundle(&drafts, "a2").exists(),
        "one failed delete short-circuited the rest"
    );
    assert!(blocked.is_dir(), "the blocked path was destroyed");

    let report = guard
        .last_commit_report()
        .expect("the commit must report what it deleted");
    // ADR-0035 changes the spec: the commit report carries the backstop tally and gateWaitMs (WI-4, A6).
    assert_eq!(
        report,
        CommitReport {
            deleted: 1,
            failed: 1,
            backstop: true,
            ..CommitReport::default()
        }
    );
    // ADR-0035 changes the spec: the commit report carries the backstop tally and gateWaitMs (WI-4, A6).
    // ADR-0035 review M-1: the commit context gains the `undiscarded` count, so the exact key set grows by one.
    assert_eq!(
        commit_log_context(&report, 0),
        serde_json::json!({
            "deleted": 1, "failed": 1, "drafted": 0, "draftFailed": 0,
            "draftMissing": 0, "capped": 0, "backstop": true, "gateWaitMs": 0,
            "undiscarded": 0
        })
    );
}

// ── WI3-D10 ───────────────────────────────────────────────────────────────────

#[test]
fn d10_log_contexts_carry_counts_never_ids_or_content() {
    let answers = [
        (QuitAnswer::Clean, "clean"),
        (QuitAnswer::Dirty, "dirty"),
        (QuitAnswer::Discard, "discard"),
        (QuitAnswer::Cancel, "cancel"),
    ];
    for (answer, wire) in answers {
        for n in [0usize, 1, 50] {
            let list: Vec<String> = (0..n).map(|i| format!("secret-id-{i}")).collect();
            let context = answer_log_context("main", answer, 7, &list);
            assert_eq!(context["windowLabel"], "main", "{answer:?}/{n}");
            assert_eq!(context["answer"], wire, "{answer:?}/{n}");
            assert_eq!(context["requestId"], 7, "{answer:?}/{n}");
            assert_eq!(context["idCount"], n, "{answer:?}/{n}");
            let rendered = serde_json::to_string(&context).unwrap();
            assert!(
                !rendered.contains("secret-id"),
                "the answer log leaked document ids: {rendered}"
            );
        }
    }

    // ADR-0035 changes the spec: the commit report carries the backstop tally and gateWaitMs (WI-4, A6).
    // ADR-0035 review M-1: the commit context gains the `undiscarded` count, so the exact key set grows by one.
    assert_eq!(
        commit_log_context(
            &CommitReport {
                deleted: 3,
                failed: 1,
                ..CommitReport::default()
            },
            0
        ),
        serde_json::json!({
            "deleted": 3, "failed": 1, "drafted": 0, "draftFailed": 0,
            "draftMissing": 0, "capped": 0, "backstop": false, "gateWaitMs": 0,
            "undiscarded": 0
        })
    );
}
