//! WI-4, the parts that need no AppKit: the two tables the native hook reads,
//! and the shape of the install log line.
//!
//! These run on every platform. `ns_reply_for` and `fallback_answer_for` are the
//! decisions; everything around them in `macos.rs` is presentation that only a
//! real device can exercise.

use super::coordinator::{Begin, FallbackAnswer};
use super::{
    fallback_answer_for, logging, ns_reply_for, InstallOutcome, NS_ALERT_FIRST_BUTTON,
    NS_TERMINATE_CANCEL, NS_TERMINATE_LATER, NS_TERMINATE_NOW,
};

/// WI4-M5: the whole `Begin` domain, against the raw AppKit values.
#[test]
fn ns_reply_for_maps_every_begin_outcome() {
    let mapped: Vec<usize> = [
        Begin::TerminateNow,
        Begin::Later { request_id: 7 },
        Begin::AlreadyPending,
    ]
    .iter()
    .map(ns_reply_for)
    .collect();

    assert_eq!(
        mapped,
        vec![NS_TERMINATE_NOW, NS_TERMINATE_LATER, NS_TERMINATE_CANCEL],
        "the IMP's return values are AppKit's ABI, not a preference"
    );
}

/// The constants are the numbers AppKit actually reads. A rename that quietly
/// renumbered them would compile and quit the app unguarded.
#[test]
fn ns_terminate_constants_are_appkits_values() {
    assert_eq!(
        (NS_TERMINATE_CANCEL, NS_TERMINATE_NOW, NS_TERMINATE_LATER),
        (0, 1, 2)
    );
}

/// ADR-0027 §2: the first button keeps the app open, the second quits.
#[test]
fn fallback_answer_for_maps_the_two_buttons() {
    assert_eq!(
        fallback_answer_for(NS_ALERT_FIRST_BUTTON),
        FallbackAnswer::KeepOpen,
        "the first button is Keep Open"
    );
    assert_eq!(
        fallback_answer_for(NS_ALERT_FIRST_BUTTON + 1),
        FallbackAnswer::QuitAnyway,
        "the second button is Quit Without Saving"
    );
}

/// Everything else falls to `KeepOpen` — the direction that never discards.
#[test]
fn fallback_answer_for_is_safe_outside_the_two_buttons() {
    for response in [
        isize::MIN,
        -1,
        0,
        1,
        999,
        NS_ALERT_FIRST_BUTTON + 2,
        NS_ALERT_FIRST_BUTTON + 3,
        isize::MAX,
    ] {
        assert_eq!(
            fallback_answer_for(response),
            FallbackAnswer::KeepOpen,
            "an out-of-range modal response ({response}) must not discard work"
        );
    }
}

/// `NS_ALERT_FIRST_BUTTON` is AppKit's `NSAlertFirstButtonReturn`.
#[test]
fn alert_first_button_is_appkits_value() {
    assert_eq!(NS_ALERT_FIRST_BUTTON, 1000);
}

/// WI4-M4 (the pure half): only `Added` counts as guarded, and every other
/// outcome carries a reason the log can print.
#[test]
fn only_added_counts_as_installed_and_the_rest_explain_themselves() {
    assert!(InstallOutcome::Added.installed());
    assert!(!InstallOutcome::AlreadyDefined.installed());
    assert!(!InstallOutcome::NoDelegate.installed());

    assert_eq!(InstallOutcome::Added.failure_reason(), None);
    for outcome in [InstallOutcome::AlreadyDefined, InstallOutcome::NoDelegate] {
        let reason = outcome
            .failure_reason()
            .unwrap_or_else(|| panic!("{outcome:?} must say why the quit is unguarded"));
        assert!(
            !reason.trim().is_empty(),
            "{outcome:?} must carry a non-empty reason"
        );
    }

    let names: Vec<&str> = [
        InstallOutcome::Added,
        InstallOutcome::AlreadyDefined,
        InstallOutcome::NoDelegate,
    ]
    .iter()
    .map(|o| o.as_str())
    .collect();
    assert_eq!(names, vec!["added", "alreadyDefined", "noDelegate"]);
}

/// ADR-0025 §1: the delegate class name and the outcome both reach the log. The
/// class name is the only warning a tao upgrade gives.
#[test]
fn the_install_log_context_carries_the_class_name_and_the_outcome() {
    let context =
        logging::hook_install_log_context(Some("TaoAppDelegateParent"), InstallOutcome::Added);
    assert_eq!(context["delegateClass"], "TaoAppDelegateParent");
    assert_eq!(context["outcome"], "added");

    let missing = logging::hook_install_log_context(None, InstallOutcome::NoDelegate);
    assert!(
        missing["delegateClass"].is_null(),
        "no delegate means no class name, not an empty string"
    );
    assert_eq!(missing["outcome"], "noDelegate");
}
