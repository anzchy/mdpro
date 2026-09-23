//! D16F WI-4 (audit row 5, limit half): the quit discard cap and the MCP
//! per-window document limit are one number.
//!
//! Law: for every `n`, `validate_discard_ids` accepts `n` ids if and only if MCP
//! accepts `n` documents for one window. A window MCP lets hold 100 dirty
//! documents must be able to discard all 100 on quit.
//!
//! The two driver cases delete **real** drafts, so they run under
//! `crate::HOME_LOCK` in a temp `$HOME` (see `driver_fixtures::mdpro_dir`).

use super::driver::*;
use super::driver_fixtures::*;
use super::CommitReport;
use crate::commands::mcp::MAX_DOCUMENTS_PER_WINDOW;
use crate::services::draft;
use crate::HOME_LOCK;

/// The per-window limit this work item pins. Written as a literal on purpose:
/// the equality test below would still pass if both constants drifted together.
const PER_WINDOW_LIMIT: usize = 100;

fn discard_list(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("w4d{i}")).collect()
}

#[test]
fn w4_discard_cap_is_the_mcp_per_window_limit() {
    assert_eq!(MAX_DOCUMENTS_PER_WINDOW, PER_WINDOW_LIMIT);
    assert_eq!(
        MAX_DISCARD_IDS, MAX_DOCUMENTS_PER_WINDOW,
        "the quit discard cap drifted from the MCP per-window document limit"
    );
}

#[test]
fn w4_discard_validation_agrees_with_the_mcp_count_check_for_every_n() {
    let mut first_rejection = None;
    for n in 0..=PER_WINDOW_LIMIT + 2 {
        let quit_accepts =
            validate_discard_ids(QuitAnswer::Discard, Some(discard_list(n))).is_ok();
        let mcp_accepts = n <= MAX_DOCUMENTS_PER_WINDOW;
        assert_eq!(
            quit_accepts, mcp_accepts,
            "n={n}: quit accepts {quit_accepts}, MCP accepts {mcp_accepts}"
        );
        if !quit_accepts && first_rejection.is_none() {
            first_rejection = Some(n);
        }
    }
    assert_eq!(first_rejection, Some(PER_WINDOW_LIMIT + 1));
}

/// Saves `n` real draft bundles and returns their ids.
fn save_bundles(drafts: &std::path::Path, n: usize) -> Vec<String> {
    let list = discard_list(n);
    for id in &list {
        draft::save_draft(id, "BODY", None, "t").unwrap();
        assert!(bundle(drafts, id).exists(), "setup: {id} was not saved");
    }
    list
}

#[test]
fn w4_one_hundred_ids_are_accepted_and_every_draft_is_deleted() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_w4_accept");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    let list = save_bundles(&drafts, PER_WINDOW_LIMIT);
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["w4a"], 0));
    guard
        .handle_reply("w4a", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    let accepted = guard.handle_reply("w4a", r, QuitAnswer::Discard, Some(list.clone()), 2);

    assert_eq!(accepted, Ok(()), "100 ids must be accepted");
    assert_eq!(
        guard.last_commit_report(),
        Some(CommitReport {
            deleted: PER_WINDOW_LIMIT,
            failed: 0
        })
    );
    assert_eq!(effects_of(&guard).last(), Some(&Effect::Reply(true)));
    let survivors: Vec<&String> = list
        .iter()
        .filter(|id| bundle(&drafts, id).exists())
        .collect();
    assert!(survivors.is_empty(), "drafts survived: {survivors:?}");
}

#[test]
fn w4_one_hundred_and_one_ids_are_refused_and_nothing_is_deleted() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_w4_refuse");
    let _home = set_home(&home);
    let drafts = drafts_dir(&home);
    let _reset = QuitCommittedReset;

    let list = save_bundles(&drafts, PER_WINDOW_LIMIT + 1);
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["w4a"], 0));
    guard
        .handle_reply("w4a", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    let state_before = guard.snapshot();
    let effects_before = effects_of(&guard).len();

    let refused = guard.handle_reply("w4a", r, QuitAnswer::Discard, Some(list.clone()), 2);

    assert_eq!(
        refused,
        Err("too many documentIds: 101 (the limit is 100)".to_string())
    );
    assert_eq!(guard.snapshot(), state_before, "a refusal moved the coordinator");
    let after = effects_of(&guard);
    assert!(
        !after[effects_before..]
            .iter()
            .any(|e| matches!(e, Effect::Reply(_))),
        "a refused list replied to NSApp: {:?}",
        &after[effects_before..]
    );
    assert_eq!(guard.last_commit_report(), None, "a refused list committed");
    let missing: Vec<&String> = list
        .iter()
        .filter(|id| !bundle(&drafts, id).exists())
        .collect();
    assert!(missing.is_empty(), "a refused list deleted: {missing:?}");
}
