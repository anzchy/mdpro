//! WI4-M6 and M7 (the added IMP against a host), split out of `macos_tests.rs` and registered from it.
//!
//! WI-4, the parts a real Objective-C runtime can answer without an NSApp: the
//! `class_addMethod` contract and the added IMP's behaviour against a real
//! coordinator.
//!
//! What is **not** here, because no headless test can reach it: the real
//! delegate lookup, `replyToApplicationShouldTerminate:`, window activation and
//! the `NSAlert` itself. Those are the WI-10 device gates.

use super::*;

// --- WI4-M6 --------------------------------------------------------------

/// The documented-unreachable path: an empty slot fails open, so the app stays
/// quittable rather than wedging on a `Later` nobody will answer.
#[test]
fn the_imp_fails_open_when_no_host_is_installed() {
    let _lock = HOST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _restore = install_host(None);

    let cls = fresh_class("NoHost");
    assert_eq!(add_should_terminate(cls), InstallOutcome::Added);

    let obj = new_instance(cls);
    assert_eq!(
        send_should_terminate(&obj),
        crate::services::quit_guard::NS_TERMINATE_NOW
    );
}

// --- WI4-M7 --------------------------------------------------------------

/// The added IMP, the objc dispatch and the coordinator are all real. Only the
/// platform effects are recorded.
#[test]
fn the_imp_maps_every_begin_outcome_from_a_real_coordinator() {
    static GATE: DraftGate = DraftGate::new();
    GATE.reopen_for_tests();

    let _lock = HOST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let host = TestHost::new(&GATE);
    let _restore = install_host(Some(host.clone() as Arc<dyn QuitHost>));

    let cls = fresh_class("RealHost");
    assert_eq!(add_should_terminate(cls), InstallOutcome::Added);
    let obj = new_instance(cls);

    // 1. No window open: nothing to guard, so quit straight away.
    host.set_labels(&[]);
    let no_windows = send_should_terminate(&obj);
    assert!(
        host.recorded().is_empty(),
        "an empty snapshot must not open a request"
    );

    // 2. One window: defer, ask it, and arm the ack deadline.
    host.set_labels(&["a"]);
    let one_window = send_should_terminate(&obj);
    let after_begin = host.recorded();
    assert_eq!(
        after_begin
            .iter()
            .filter(|e| e.starts_with("EmitAll(app:quit-requested"))
            .count(),
        1,
        "exactly one quit-requested went out: {after_begin:?}"
    );

    // 3. A nested terminate while that request is live: cancel the nested one
    //    and leave the pending request alone.
    let nested = send_should_terminate(&obj);
    assert_eq!(
        host.recorded(),
        after_begin,
        "a nested terminate must not disturb the live request"
    );

    assert_eq!(
        vec![no_windows, one_window, nested],
        vec![
            crate::services::quit_guard::NS_TERMINATE_NOW,
            crate::services::quit_guard::NS_TERMINATE_LATER,
            crate::services::quit_guard::NS_TERMINATE_CANCEL,
        ],
        "the IMP must follow the coordinator, not a constant"
    );

    // 4. Once the window answers and the quit commits, a fresh terminate opens a
    //    new request rather than reporting the old one as still pending.
    host.guard
        .handle_reply("a", 1, QuitAnswer::Clean, None, 0)
        .expect("a clean answer is accepted");
    assert!(
        host.recorded().iter().any(|e| e == "Reply(true)"),
        "the clean answer commits the quit: {:?}",
        host.recorded()
    );

    let after_commit = send_should_terminate(&obj);
    assert_eq!(
        after_commit,
        crate::services::quit_guard::NS_TERMINATE_LATER,
        "the request id must advance so the next quit is guarded too"
    );

    GATE.reopen_for_tests();
}
