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
use super::QUIT_COMMITTED;
use crate::services::draft;
use crate::HOME_LOCK;
use std::fs;

// ── WI3-D1 ────────────────────────────────────────────────────────────────────

#[test]
fn d1_commit_deletes_exactly_the_discarded_drafts_and_never_the_global_gate() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d1");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;
    assert!(
        !QUIT_COMMITTED.is_closed(),
        "precondition: the global quit-committed gate must start open"
    );

    for id in ["a1", "a2", "b1", "keep"] {
        draft::save_draft(id, "BODY", None, "t").unwrap();
        assert!(bundle(&drafts, id).exists(), "setup: {id} was not saved");
    }

    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Dirty, None, 2)
        .unwrap();
    guard
        .handle_reply("A", r, QuitAnswer::Discard, ids(&["a1", "a2"]), 3)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Discard, ids(&["b1"]), 4)
        .unwrap();
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    finish_quit(&guard, r, &["A", "B"], 5);

    for id in ["a1", "a2", "b1"] {
        assert!(
            !bundle(&drafts, id).exists(),
            "discarded draft {id} survived the commit"
        );
    }
    assert!(
        bundle(&drafts, "keep").exists(),
        "a draft nobody discarded was deleted"
    );
    assert_eq!(draft::load_draft("keep").unwrap().unwrap().content, "BODY");

    let effects = effects_of(&guard);
    assert_eq!(
        effects.last(),
        Some(&Effect::Reply(true)),
        "the commit must end with YES; effects were {effects:?}"
    );
    assert!(
        gate.is_closed(),
        "the injected gate was not closed on commit"
    );
    assert!(
        !QUIT_COMMITTED.is_closed(),
        "a with_gate driver closed the global QUIT_COMMITTED"
    );
    for (id, inside_closing_section) in guard.effects().deletes() {
        assert!(
            inside_closing_section,
            "{id} was deleted outside the closing critical section, where a save could still write it back"
        );
    }
}

// ── WI3-D2 ────────────────────────────────────────────────────────────────────

#[test]
fn d2_abort_after_an_earlier_discard_touches_no_draft() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d2");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    let names = ["a1", "a2", "b1", "keep"];
    for id in names {
        draft::save_draft(id, "BODY", None, "t").unwrap();
    }
    let before: Vec<Vec<u8>> = names
        .iter()
        .map(|id| fs::read(bundle(&drafts, id)).unwrap())
        .collect();

    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A", "B"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Dirty, None, 2)
        .unwrap();
    guard
        .handle_reply("A", r, QuitAnswer::Discard, ids(&["a1", "a2"]), 3)
        .unwrap();
    guard
        .handle_reply("B", r, QuitAnswer::Cancel, None, 4)
        .unwrap();

    for (id, bytes) in names.iter().zip(before) {
        assert_eq!(
            fs::read(bundle(&drafts, id)).ok(),
            Some(bytes),
            "an aborted quit changed draft {id}"
        );
    }

    let effects = effects_of(&guard);
    // ADR-0035 changes the spec: the event payload carries `round` (A5).
    assert!(
        effects.contains(&Effect::EmitAll(QuitEvent::Cancelled {
            request_id: r,
            round: 0
        })),
        "an abort must tell every window to close its dialog; effects were {effects:?}"
    );
    assert_eq!(effects.last(), Some(&Effect::Reply(false)));
    assert!(!gate.is_closed(), "an abort must not close the gate");
    assert!(
        crate::commands::draft::save_draft_gated(gate, "after-abort", "x", None, "t").is_ok(),
        "saving drafts must still work after an aborted quit"
    );
}

// ── WI3-D3 ────────────────────────────────────────────────────────────────────

#[test]
fn d3_invalid_document_ids_are_rejected_whole_and_move_nothing_on_disk() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d3");
    let _home = set_home(&home);
    let dir = mdpro_dir(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    draft::save_draft("ok1", "BODY", None, "t").unwrap();
    let sentinel = dir.join("x.draft.json");
    fs::write(&sentinel, b"SENTINEL").unwrap();

    let corpus = ["", "a/b", "a\\b", "..", "../x", "..\\x", "x/../../y"];
    for bad in corpus {
        for payload in [
            vec![bad.to_string()],
            vec!["ok1".to_string(), bad.to_string()],
        ] {
            let gate = leak_gate();
            let guard = recording_guard(gate);
            let r = later(guard.begin(&["A"], 0));
            guard
                .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
                .unwrap();

            let refused = guard.handle_reply("A", r, QuitAnswer::Discard, Some(payload.clone()), 2);
            assert!(
                refused.is_err(),
                "id list {payload:?} reached the commit path"
            );
            assert!(
                !gate.is_closed(),
                "a refused reply committed the quit for {payload:?}"
            );

            // The coordinator is still waiting on A: it can still be answered.
            guard
                .handle_reply("A", r, QuitAnswer::Cancel, None, 3)
                .unwrap();
            assert_eq!(
                effects_of(&guard).last(),
                Some(&Effect::Reply(false)),
                "a rejected id list left the request unanswerable for {payload:?}"
            );
            assert_eq!(fs::read(&sentinel).unwrap(), b"SENTINEL");
            assert!(
                bundle(&drafts, "ok1").exists(),
                "ok1 was deleted by {payload:?}"
            );
        }
    }

    // Not vacuous: the same shape with a valid id does commit and does delete.
    let gate = leak_gate();
    let guard = recording_guard(gate);
    let r = later(guard.begin(&["A"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard
        .handle_reply("A", r, QuitAnswer::Discard, ids(&["ok1"]), 2)
        .unwrap();
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    finish_quit(&guard, r, &["A"], 3);
    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
    assert!(!bundle(&drafts, "ok1").exists());
    assert_eq!(fs::read(&sentinel).unwrap(), b"SENTINEL");
}

// ── WI3-D4 ────────────────────────────────────────────────────────────────────

#[test]
fn d4_document_ids_length_cap_boundary() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d4");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    let last = format!("d{}", MAX_DISCARD_IDS - 1);
    for id in ["d0", last.as_str(), "keep"] {
        draft::save_draft(id, "BODY", None, "t").unwrap();
    }

    // One over the cap: refused, and nothing is deleted.
    let over: Vec<String> = (0..=MAX_DISCARD_IDS).map(|i| format!("d{i}")).collect();
    let gate1 = leak_gate();
    let guard1 = recording_guard(gate1);
    let r1 = later(guard1.begin(&["A"], 0));
    guard1
        .handle_reply("A", r1, QuitAnswer::Dirty, None, 1)
        .unwrap();
    let refused = guard1.handle_reply("A", r1, QuitAnswer::Discard, Some(over), 2);
    let message = refused.expect_err("one id over the cap must be refused");
    assert!(
        message.contains("too many") && message.contains(&MAX_DISCARD_IDS.to_string()),
        "the refusal must name the cap; got {message:?}"
    );
    for id in ["d0", last.as_str(), "keep"] {
        assert!(
            bundle(&drafts, id).exists(),
            "a refused over-cap list deleted {id}"
        );
    }

    // Exactly at the cap: accepted, and those drafts go.
    let at: Vec<String> = (0..MAX_DISCARD_IDS).map(|i| format!("d{i}")).collect();
    let gate2 = leak_gate();
    let guard2 = recording_guard(gate2);
    let r2 = later(guard2.begin(&["A"], 0));
    guard2
        .handle_reply("A", r2, QuitAnswer::Dirty, None, 1)
        .unwrap();
    guard2
        .handle_reply("A", r2, QuitAnswer::Discard, Some(at), 2)
        .expect("exactly MAX_DISCARD_IDS ids must be accepted");
    // ADR-0035 changes the spec: commit is now preceded by a re-check round.
    finish_quit(&guard2, r2, &["A"], 3);
    assert_eq!(effects_of(&guard2).last(), Some(&Effect::Reply(true)));
    assert!(!bundle(&drafts, "d0").exists());
    assert!(!bundle(&drafts, &last).exists());
    assert!(bundle(&drafts, "keep").exists());
}

// D16F WI-6: registered here because `mod.rs` is at its line budget.
#[path = "driver_backstop_log_tests.rs"]
mod driver_backstop_log_tests;
#[path = "driver_backstop_redaction_tests.rs"]
mod driver_backstop_redaction_tests;
#[path = "driver_effect_fail_tests.rs"]
mod driver_effect_fail_tests;
#[path = "driver_fallback_log_tests.rs"]
mod driver_fallback_log_tests;
#[path = "driver_fallback_prop_tests.rs"]
mod driver_fallback_prop_tests;
#[path = "driver_fallback_sink_tests.rs"]
mod driver_fallback_sink_tests;
#[path = "driver_prompt_cause_tests.rs"]
mod driver_prompt_cause_tests;
#[path = "effects_clock_tests.rs"]
mod effects_clock_tests;
#[path = "effects_contract_tests.rs"]
mod effects_contract_tests;
#[path = "effects_tests.rs"]
mod effects_tests;
