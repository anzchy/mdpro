//! D74 — the new-window gate: while a quit request is live, no new window may
//! open, because the request snapshotted its windows at `begin` and a window it
//! does not know about is never asked, never prompted and never waited for.
//!
//! The guard is a real `QuitGuard` over recording effects; only the platform
//! effects are faked. Every request here commits an empty discard list, so no
//! draft on disk is touched.

use super::super::driver::*;
use super::super::driver_fixtures::*;
use super::{new_window_gate, QUIT_PENDING_REFUSAL};

fn refused() -> Result<(), &'static str> {
    Err(QUIT_PENDING_REFUSAL)
}

#[test]
fn d74_no_guard_managed_yet_allows_a_new_window() {
    // Before `setup()` manages the guard there is no quit to protect.
    assert_eq!(new_window_gate::<RecordingEffects>(None), Ok(()));
}

#[test]
fn d74_an_idle_guard_allows_a_new_window() {
    let guard = recording_guard(leak_gate());
    assert!(!guard.is_request_live());
    assert_eq!(new_window_gate(Some(&guard)), Ok(()));
}

#[test]
fn d74_a_live_request_refuses_a_new_window_in_every_phase() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["A"], 0));

    // Phase 1: the snapshot has been asked, nobody has answered.
    assert!(guard.is_request_live());
    assert_eq!(new_window_gate(Some(&guard)), refused(), "phase 1");

    // Phase 2: A is dirty and its dialog is up — the window the defect is about.
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    assert_eq!(new_window_gate(Some(&guard)), refused(), "phase 2 prompt");

    // Re-check round (ADR-0035): A discarded, the request re-asks A.
    guard
        .handle_reply("A", r, QuitAnswer::Discard, Some(vec![]), 2)
        .unwrap();
    assert_eq!(new_window_gate(Some(&guard)), refused(), "re-check round");
}

#[test]
fn d74_a_request_owned_by_the_native_alert_still_refuses() {
    let guard = recording_guard(leak_gate());
    let _r = later(guard.begin(&["A"], 0));
    // A never acks: the deadline hands the request to the ADR-0027 alert.
    guard.tick(QUIT_ACK_TIMEOUT_MS);
    assert!(guard.is_request_live(), "the alert owns a live request");
    assert_eq!(new_window_gate(Some(&guard)), refused());
}

#[test]
fn d74_a_cancelled_request_allows_new_windows_again() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["A"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    assert_eq!(new_window_gate(Some(&guard)), refused());

    guard
        .handle_reply("A", r, QuitAnswer::Cancel, None, 2)
        .unwrap();
    assert!(!guard.is_request_live());
    assert_eq!(new_window_gate(Some(&guard)), Ok(()));
}

#[test]
fn d74_a_committed_request_no_longer_refuses() {
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["A"], 0));
    guard
        .handle_reply("A", r, QuitAnswer::Clean, None, 1)
        .unwrap();
    assert_eq!(new_window_gate(Some(&guard)), refused(), "re-check pending");

    finish_quit(&guard, r, &["A"], 2);
    assert!(
        guard.last_commit_report().is_some(),
        "the request committed"
    );
    assert!(!guard.is_request_live());
    assert_eq!(new_window_gate(Some(&guard)), Ok(()));
}

#[test]
fn d74_a_window_outside_the_snapshot_is_handled_no_worse_than_before() {
    // The gate is checked before the window is built, so a window could still
    // slip in between the check and the build (the coordinator lock cannot be
    // held across `build()`). Such a window must not derail the request: its
    // answers are refused without an effect, and the snapshot still resolves.
    let guard = recording_guard(leak_gate());
    let r = later(guard.begin(&["A"], 0));
    let before = effects_of(&guard);

    guard
        .handle_reply("late", r, QuitAnswer::Dirty, None, 1)
        .unwrap();
    assert_eq!(
        effects_of(&guard),
        before,
        "an answer from a window outside the snapshot must produce no effect"
    );
    assert!(guard.is_request_live());

    guard
        .handle_reply("A", r, QuitAnswer::Clean, None, 2)
        .unwrap();
    finish_quit(&guard, r, &["A"], 3);
    assert!(guard.last_commit_report().is_some());
    assert!(!guard.is_request_live());
}
