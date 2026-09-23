//! WI3-D8: the driver's effect ordering, over the coordinator's whole domain.
//!
//! The scenario space is enumerated rather than sampled: every window kind, one
//! and two windows, driven in given and reversed order. Each run does **real**
//! draft deletion, so the whole test runs under `crate::HOME_LOCK` in a temp
//! `$HOME`, guarded by the `dirs::data_dir()` assertion in `drafts_dir`.
//!
//! The oracle is deliberately its own copy rather than a re-use of
//! `coordinator_domain_tests`: that module is private to `coordinator`, and the
//! laws asserted here are about the *driver's* effects, not the state machine.

use super::driver::*;
use super::driver_tests::{
    bundle, drafts_dir, effects_of, later, leak_flag, make_temp_home, recording_guard, set_home,
    Effect, QuitCommittedReset,
};
use super::on_window_event;
use crate::services::draft;
use crate::HOME_LOCK;
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::atomic::Ordering::SeqCst;

/// What one window does across the whole request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    /// Acks clean in phase 1.
    Clean,
    /// Acks dirty, then discards both of its drafts.
    Discard,
    /// Acks dirty, then answers clean (the user saved in the meantime).
    DirtyThenClean,
    /// Acks dirty, then cancels the quit.
    Cancel,
    /// Acks dirty, then its window is destroyed before it can answer.
    GoneAfterDirtyPhase1,
    /// Discards, then its window is destroyed.
    GoneAfterDiscard,
    /// Never acks at all.
    Timeout,
}

const KINDS: [Kind; 7] = [
    Kind::Clean,
    Kind::Discard,
    Kind::DirtyThenClean,
    Kind::Cancel,
    Kind::GoneAfterDirtyPhase1,
    Kind::GoneAfterDiscard,
    Kind::Timeout,
];

fn acks_dirty(kind: Kind) -> bool {
    !matches!(kind, Kind::Clean | Kind::Timeout)
}

fn draft_ids(index: usize) -> [String; 2] {
    [format!("w{index}-a"), format!("w{index}-b")]
}

/// Drives one scenario and checks every law against the effects and the disk.
fn check(kinds: &[Kind], reversed: bool, home: &Path) {
    let scenario = format!("{kinds:?} reversed={reversed}");
    let drafts = drafts_dir(home);
    let labels: Vec<String> = (0..kinds.len()).map(|i| format!("w{i}")).collect();

    // Every window owns two drafts, and `keep` belongs to nobody.
    let mut all_ids = vec!["keep".to_string()];
    for i in 0..kinds.len() {
        all_ids.extend(draft_ids(i));
    }
    for id in &all_ids {
        draft::save_draft(id, "BODY", None, "t").unwrap();
    }

    let flag = leak_flag();
    let guard = recording_guard(flag);
    let r = later(guard.begin(&labels, 0));

    let mut expected_gone: BTreeSet<String> = BTreeSet::new();
    let mut aborted = false;
    let mut answered: BTreeSet<String> = BTreeSet::new();

    let mut order: Vec<usize> = (0..kinds.len()).collect();
    if reversed {
        order.reverse();
    }

    // Phase 1: the acks.
    for &i in &order {
        match kinds[i] {
            Kind::Timeout => {}
            Kind::Clean => guard
                .handle_reply(&labels[i], r, QuitAnswer::Clean, None, 1)
                .unwrap(),
            _ => guard
                .handle_reply(&labels[i], r, QuitAnswer::Dirty, None, 1)
                .unwrap(),
        }
    }
    // The windows that vanish before they can be prompted.
    for &i in &order {
        if kinds[i] == Kind::GoneAfterDirtyPhase1 {
            answered.insert(labels[i].clone());
            on_window_event(&guard, &labels[i], &tauri::WindowEvent::Destroyed);
        }
    }

    if kinds.contains(&Kind::Timeout) {
        // A silent window keeps the request in phase 1 forever, so the deadline
        // is the only thing that can resolve it (ADR-0027).
        guard.tick(QUIT_ACK_TIMEOUT_MS);
        assert!(
            effects_of(&guard)
                .iter()
                .any(|e| matches!(e, Effect::NativeFallback(..))),
            "{scenario}: a silent window did not reach the native alert"
        );
        guard.fallback_answer(r, FallbackAnswer::KeepOpen);
        aborted = true;
    } else {
        // Phase 2: answer whichever window the driver prompts, until it replies.
        loop {
            let effects = effects_of(&guard);
            if effects.iter().any(|e| matches!(e, Effect::Reply(_))) {
                break;
            }
            let next = effects.iter().find_map(|e| match e {
                Effect::EmitTo(label, QuitEvent::Prompt { .. }) if !answered.contains(label) => {
                    Some(label.clone())
                }
                _ => None,
            });
            let label = next.unwrap_or_else(|| panic!("{scenario}: stalled at {effects:?}"));
            answered.insert(label.clone());
            let i = labels.iter().position(|l| *l == label).unwrap();
            let ids = draft_ids(i);
            match kinds[i] {
                Kind::Discard | Kind::GoneAfterDiscard => {
                    guard
                        .handle_reply(&label, r, QuitAnswer::Discard, Some(ids.to_vec()), 2)
                        .unwrap();
                    expected_gone.extend(ids);
                    if kinds[i] == Kind::GoneAfterDiscard {
                        on_window_event(&guard, &label, &tauri::WindowEvent::Destroyed);
                    }
                }
                Kind::DirtyThenClean => guard
                    .handle_reply(&label, r, QuitAnswer::Clean, None, 2)
                    .unwrap(),
                Kind::Cancel => {
                    guard
                        .handle_reply(&label, r, QuitAnswer::Cancel, None, 2)
                        .unwrap();
                    aborted = true;
                }
                other => panic!("{scenario}: {other:?} must never be prompted"),
            }
        }
    }

    let effects = effects_of(&guard);

    // Law 1: the request opens by asking everyone, then arming the ack timer.
    assert_eq!(
        effects[0],
        Effect::EmitAll(QuitEvent::Requested { request_id: r }),
        "{scenario}"
    );
    assert_eq!(
        effects[1],
        Effect::ArmTimer(r, QUIT_ACK_TIMEOUT_MS),
        "{scenario}"
    );

    // Law 2: AppKit is answered exactly once, and last.
    let replies: Vec<bool> = effects
        .iter()
        .filter_map(|e| match e {
            Effect::Reply(v) => Some(*v),
            _ => None,
        })
        .collect();
    assert_eq!(replies.len(), 1, "{scenario}: replies {replies:?}");
    assert!(
        matches!(effects.last(), Some(Effect::Reply(_))),
        "{scenario}: an effect ran after the reply: {effects:?}"
    );
    assert_eq!(replies[0], !aborted, "{scenario}");

    // Law 3: an abort closes every open dialog immediately before it refuses.
    if aborted {
        assert_eq!(
            effects[effects.len() - 2],
            Effect::EmitAll(QuitEvent::Cancelled { request_id: r }),
            "{scenario}: the abort did not close the dialogs first"
        );
    }
    assert!(
        !effects
            .iter()
            .any(|e| matches!(e, Effect::EmitAll(QuitEvent::Cancelled { .. })))
            || aborted,
        "{scenario}: a committing quit told the windows it was cancelled"
    );

    // Law 4: a prompt is always preceded immediately by activating that window,
    // no window is prompted twice, and only a dirty window is ever prompted.
    let mut prompted: Vec<String> = Vec::new();
    for (at, effect) in effects.iter().enumerate() {
        if let Effect::EmitTo(label, QuitEvent::Prompt { .. }) = effect {
            assert!(at > 0, "{scenario}: a prompt was the first effect");
            assert_eq!(
                effects[at - 1],
                Effect::Activate(label.clone()),
                "{scenario}: {label} was prompted without being brought to the front"
            );
            assert!(
                !prompted.contains(label),
                "{scenario}: {label} was prompted twice"
            );
            let i = labels.iter().position(|l| l == label).unwrap();
            assert!(
                acks_dirty(kinds[i]),
                "{scenario}: {label} ({:?}) was prompted",
                kinds[i]
            );
            prompted.push(label.clone());
        }
    }

    // Law 5: the disk matches. Exactly the discarded ids are gone, and only
    // when the quit committed.
    for id in &all_ids {
        let should_exist = aborted || !expected_gone.contains(id);
        assert_eq!(
            bundle(&drafts, id).exists(),
            should_exist,
            "{scenario}: wrong disk state for {id} (expected_gone={expected_gone:?})"
        );
    }
    assert!(
        bundle(&drafts, "keep").exists(),
        "{scenario}: keep was deleted"
    );

    // Law 6: the quit-committed flag tracks the reply.
    assert_eq!(flag.load(SeqCst), !aborted, "{scenario}");

    // Clean the slate for the next run.
    for id in &all_ids {
        let _ = std::fs::remove_file(bundle(&drafts, id));
    }
}

#[test]
fn d8_driver_effect_ordering_holds_across_the_coordinator_domain() {
    let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = make_temp_home("qg_d8");
    let _home = set_home(&home);
    let _reset = QuitCommittedReset;

    let mut scenarios: Vec<Vec<Kind>> = Vec::new();
    for a in KINDS {
        scenarios.push(vec![a]);
        for b in KINDS {
            scenarios.push(vec![a, b]);
        }
    }

    // The two rows the test matrix names by hand; enumeration covers them, and
    // this makes it impossible to drop them by shrinking the space later.
    assert!(scenarios.contains(&vec![Kind::GoneAfterDiscard, Kind::Discard]));
    assert!(scenarios.contains(&vec![Kind::GoneAfterDirtyPhase1, Kind::Discard]));
    assert_eq!(scenarios.len(), 56);

    for kinds in &scenarios {
        for reversed in [false, true] {
            check(kinds, reversed, &home);
        }
    }
}
