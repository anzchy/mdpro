//! ADR-0035 review M-1: a document discarded at the prompt and then edited is
//! redrafted by the backstop, and that draft must survive the commit
//! (DU-1 … DU-6). Shares the real-disk helpers of `draft_backstop_tests`.
//!
//! The `drafted` reply names, in `documentIds`, the ids the window redrafted
//! although it had discarded them in this request. The commit drops such an id
//! from the delete set only when the SAME window discarded it: a sibling's
//! discard stands, an id nobody discarded changes nothing, and junk is refused
//! before the coordinator sees it.

use super::draft::save_draft_gated;
use super::draft_backstop_tests::{
    bundle, discard_then_recheck, guard_over, leak_gate, make_temp_home, recheck_clean, replies,
    set_home, Watch,
};
use crate::services::draft::load_draft;
use crate::services::quit_guard::driver::Begin;
use crate::services::quit_guard::logging::commit_log_context;
use crate::services::quit_guard::{QuitAnswer, QuitGuard};
use crate::HOME_LOCK;

fn drafted_naming(
    guard: &QuitGuard<Watch>,
    label: &str,
    r: u64,
    ids: Option<Vec<&str>>,
    counts: (u32, u32),
    now: u64,
) -> Result<(), String> {
    guard.handle_wire_reply(
        label,
        r,
        QuitAnswer::Drafted,
        ids.map(|ids| ids.into_iter().map(str::to_string).collect()),
        Some(counts.0),
        Some(counts.1),
        None,
        now,
    )
}

/// Windows `a` and `b` are both dirty; `a` discards `a_ids`, then `b` discards
/// `b_ids`; the re-check answers clean from both, which opens the backstop.
fn two_windows_discard(guard: &QuitGuard<Watch>, a_ids: &[&str], b_ids: &[&str]) -> u64 {
    let r = match guard.begin(&["a", "b"], 0) {
        Begin::Later { request_id } => request_id,
        other => panic!("expected Begin::Later, got {other:?}"),
    };
    let own = |ids: &[&str]| Some(ids.iter().map(|s| (*s).to_string()).collect());
    for (label, answer, ids, at) in [
        ("a", QuitAnswer::Dirty, None, 1),
        ("b", QuitAnswer::Dirty, None, 2),
        ("a", QuitAnswer::Delivered, None, 3),
        ("a", QuitAnswer::Discard, own(a_ids), 4),
        ("b", QuitAnswer::Delivered, None, 5),
        ("b", QuitAnswer::Discard, own(b_ids), 6),
        ("a", QuitAnswer::Clean, None, 7),
        ("b", QuitAnswer::Clean, None, 8),
    ] {
        guard
            .handle_reply(label, r, answer, ids, at)
            .unwrap_or_else(|e| panic!("setup {label} {answer:?}: {e}"));
    }
    assert!(replies(guard).is_empty(), "setup: the quit resolved early");
    r
}

// ── DU-1 ──────────────────────────────────────────────────────────────────────

#[test]
fn du1_a_discarded_doc_edited_and_redrafted_by_its_window_survives_the_commit() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_backstop_du1");
    let _home = set_home(&home);

    let gate = leak_gate();
    let guard = guard_over(gate);
    let r = discard_then_recheck(&guard, "X");
    recheck_clean(&guard, r);

    save_draft_gated(gate, "X", "edited after discard", None, "t").expect("the gate is open");
    let sent = drafted_naming(&guard, "a", r, Some(vec!["X"]), (1, 0), 5);
    assert_eq!(
        sent,
        Ok(()),
        "a drafted reply naming its own discard must be accepted"
    );

    assert_eq!(replies(&guard), vec![true], "the quit must commit");
    let kept = load_draft("X")
        .unwrap()
        .expect("the redrafted document's draft was deleted");
    assert_eq!(kept.content, "edited after discard");
    let report = guard.last_commit_report().expect("the commit reports");
    assert_eq!(report.deleted, 0, "{report:?}");
    assert_eq!(report.undiscarded, 1, "{report:?}");
    assert_eq!(commit_log_context(&report, 0)["undiscarded"], 1);
}

// ── DU-2 ──────────────────────────────────────────────────────────────────────

#[test]
fn du2_a_discard_the_drafted_reply_does_not_name_is_still_deleted() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_backstop_du2");
    let _home = set_home(&home);

    let gate = leak_gate();
    let guard = guard_over(gate);
    let r = discard_then_recheck(&guard, "X");
    recheck_clean(&guard, r);

    save_draft_gated(gate, "X", "late", None, "t").expect("the gate is open");
    assert_eq!(drafted_naming(&guard, "a", r, None, (1, 0), 5), Ok(()));

    assert_eq!(replies(&guard), vec![true]);
    assert!(!bundle(&home, "X").exists(), "the discarded draft survived");
    let report = guard.last_commit_report().expect("the commit reports");
    assert_eq!((report.deleted, report.undiscarded), (1, 0), "{report:?}");
    assert_eq!(commit_log_context(&report, 0)["undiscarded"], 0);
}

// ── DU-3 ──────────────────────────────────────────────────────────────────────

#[test]
fn du3_a_window_cannot_cancel_a_siblings_discard() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_backstop_du3");
    let _home = set_home(&home);

    let gate = leak_gate();
    let guard = guard_over(gate);
    let r = two_windows_discard(&guard, &["X"], &["Y"]);

    save_draft_gated(gate, "X", "a's edit", None, "t").expect("the gate is open");
    save_draft_gated(gate, "Y", "b's late write", None, "t").expect("the gate is open");
    // `a` names its own X and b's Y; only X is a's to cancel.
    assert_eq!(
        drafted_naming(&guard, "a", r, Some(vec!["X", "Y"]), (2, 0), 9),
        Ok(())
    );
    assert_eq!(drafted_naming(&guard, "b", r, None, (0, 0), 10), Ok(()));

    assert_eq!(replies(&guard), vec![true]);
    assert!(
        bundle(&home, "X").exists(),
        "a's redraft of its own discard was deleted"
    );
    assert!(
        !bundle(&home, "Y").exists(),
        "a sibling cancelled b's discard"
    );
    let report = guard.last_commit_report().expect("the commit reports");
    assert_eq!((report.deleted, report.undiscarded), (1, 1), "{report:?}");
}

// ── DU-4 ──────────────────────────────────────────────────────────────────────

#[test]
fn du4_an_id_both_windows_discarded_stays_deleted_when_only_one_redrafts_it() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_backstop_du4");
    let _home = set_home(&home);

    let gate = leak_gate();
    let guard = guard_over(gate);
    let r = two_windows_discard(&guard, &["X"], &["X"]);

    save_draft_gated(gate, "X", "a's edit", None, "t").expect("the gate is open");
    assert_eq!(
        drafted_naming(&guard, "a", r, Some(vec!["X"]), (1, 0), 9),
        Ok(())
    );
    assert_eq!(drafted_naming(&guard, "b", r, None, (0, 0), 10), Ok(()));

    assert_eq!(replies(&guard), vec![true]);
    assert!(
        !bundle(&home, "X").exists(),
        "b's discard of X did not stand"
    );
    let report = guard.last_commit_report().expect("the commit reports");
    assert_eq!((report.deleted, report.undiscarded), (1, 0), "{report:?}");
}

// ── DU-5 ──────────────────────────────────────────────────────────────────────

#[test]
fn du5_junk_ids_on_a_drafted_reply_are_refused_without_quoting_them() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_backstop_du5");
    let _home = set_home(&home);

    let gate = leak_gate();
    let guard = guard_over(gate);
    let r = discard_then_recheck(&guard, "X");
    recheck_clean(&guard, r);
    save_draft_gated(gate, "X", "late", None, "t").expect("the gate is open");

    let long = "k".repeat(129);
    let many: Vec<String> = (0..101).map(|i| format!("m{i}")).collect();
    let junk: Vec<(Vec<String>, &str)> = vec![
        (vec!["../X".to_string()], "../X"),
        (vec![String::new()], "index 0"),
        (vec!["X".to_string(), "a/b".to_string()], "a/b"),
        (vec![long.clone()], &long),
        (many, "m100"),
    ];
    for (ids, secret) in junk {
        let before = guard.snapshot();
        let err = guard
            .handle_wire_reply(
                "a",
                r,
                QuitAnswer::Drafted,
                Some(ids),
                Some(1),
                Some(0),
                None,
                5,
            )
            .expect_err("junk ids must be refused");
        if secret != "index 0" {
            assert!(!err.contains(secret), "the refusal quoted an id: {err}");
        }
        assert_eq!(
            guard.snapshot(),
            before,
            "a refused reply changed the state"
        );
    }
    assert!(
        replies(&guard).is_empty(),
        "a refused reply committed the quit"
    );

    // The window can still answer properly, and X is still deleted.
    assert_eq!(drafted_naming(&guard, "a", r, None, (1, 0), 6), Ok(()));
    assert!(!bundle(&home, "X").exists(), "junk cancelled the discard");
}

// ── DU-6 ──────────────────────────────────────────────────────────────────────

#[test]
fn du6_ids_are_accepted_only_with_drafted_and_never_with_discard_semantics_elsewhere() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("draft_backstop_du6");
    let _home = set_home(&home);

    let gate = leak_gate();
    let guard = guard_over(gate);
    let r = discard_then_recheck(&guard, "X");
    // A re-check `clean` carrying ids is still refused.
    let refused = guard.handle_reply("a", r, QuitAnswer::Clean, Some(vec!["X".to_string()]), 4);
    assert!(refused.is_err(), "ids on clean must stay refused");
    recheck_clean(&guard, r);

    // An id nobody discarded is harmless: nothing is cancelled and nothing added.
    save_draft_gated(gate, "X", "late", None, "t").expect("the gate is open");
    save_draft_gated(gate, "Z", "never discarded", None, "t").expect("the gate is open");
    assert_eq!(
        drafted_naming(&guard, "a", r, Some(vec!["Z"]), (2, 0), 5),
        Ok(())
    );
    assert!(
        !bundle(&home, "X").exists(),
        "X's discard was cancelled by Z"
    );
    assert!(bundle(&home, "Z").exists(), "naming Z deleted it");
    let report = guard.last_commit_report().expect("the commit reports");
    assert_eq!((report.deleted, report.undiscarded), (1, 0), "{report:?}");
}
