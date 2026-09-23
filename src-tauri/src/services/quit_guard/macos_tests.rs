//! WI-4, the parts a real Objective-C runtime can answer without an NSApp: the
//! `class_addMethod` contract and the added IMP's behaviour against a real
//! coordinator.
//!
//! What is **not** here, because no headless test can reach it: the real
//! delegate lookup, `replyToApplicationShouldTerminate:`, window activation and
//! the `NSAlert` itself. Those are the WI-10 device gates.

use std::ffi::CString;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, NSObject, Sel};
use objc2::{msg_send, sel, ClassType};

use super::{add_should_terminate, install_on, swap_host, QuitHost, HOST_LOCK};
use crate::services::quit_guard::coordinator::Begin;
use crate::services::quit_guard::driver::{QuitAnswer, QuitEffects, QuitEvent, QuitGuard};
use crate::services::quit_guard::InstallOutcome;

// --- runtime scaffolding -------------------------------------------------

/// ObjC class names are process-global and the test binary may run a name twice,
/// so every class this file builds carries a fresh nonce.
fn unique_class_name(stem: &str) -> CString {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let nonce = NEXT.fetch_add(1, Ordering::SeqCst);
    CString::new(format!("MdproQGTest_{stem}_{}_{nonce}", std::process::id()))
        .expect("a class name never contains a nul byte")
}

fn fresh_class(stem: &str) -> &'static AnyClass {
    let name = unique_class_name(stem);
    ClassBuilder::new(&name, NSObject::class())
        .expect("a nonced class name is always free")
        .register()
}

/// The sentinel a pre-existing implementation returns, so WI4-M2 can tell
/// whether ours replaced it.
const SENTINEL: usize = 42;

extern "C-unwind" fn sentinel_should_terminate(
    _this: &AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) -> usize {
    SENTINEL
}

/// A class that already implements `applicationShouldTerminate:` — the
/// tao-upgrade failure mode, built for real.
fn class_with_existing_implementation(stem: &str) -> &'static AnyClass {
    let name = unique_class_name(stem);
    let mut builder =
        ClassBuilder::new(&name, NSObject::class()).expect("a nonced class name is always free");
    // SAFETY: the function's signature is exactly the one ObjC will invoke for
    // `-(NSUInteger)applicationShouldTerminate:(id)`.
    unsafe {
        builder.add_method(
            sel!(applicationShouldTerminate:),
            sentinel_should_terminate as extern "C-unwind" fn(_, _, _) -> _,
        );
    }
    builder.register()
}

fn new_instance(cls: &AnyClass) -> Retained<AnyObject> {
    // SAFETY: every class here descends from NSObject, so `+new` is defined and
    // hands back a new owned instance.
    unsafe { msg_send![cls, new] }
}

fn send_should_terminate(obj: &AnyObject) -> usize {
    // SAFETY: the receiver's class implements the selector with this exact
    // signature — either the sentinel above or the one we just added.
    unsafe { msg_send![obj, applicationShouldTerminate: std::ptr::null_mut::<AnyObject>()] }
}

fn responds(cls: &AnyClass) -> bool {
    cls.instance_method(sel!(applicationShouldTerminate:))
        .is_some()
}

// --- host scaffolding ----------------------------------------------------

/// Restores whatever host was in the slot, whichever way the test leaves.
struct HostRestorer(Option<Arc<dyn QuitHost>>);

impl Drop for HostRestorer {
    fn drop(&mut self) {
        swap_host(self.0.take());
    }
}

fn install_host(host: Option<Arc<dyn QuitHost>>) -> HostRestorer {
    HostRestorer(swap_host(host))
}

/// A real `QuitEffects`: it records, it does not stand in for our own logic.
#[derive(Default)]
struct RecordingEffects {
    events: Mutex<Vec<String>>,
}

impl RecordingEffects {
    fn recorded(&self) -> Vec<String> {
        self.events.lock().expect("test mutex").clone()
    }

    fn push(&self, entry: String) {
        self.events.lock().expect("test mutex").push(entry);
    }
}

impl QuitEffects for RecordingEffects {
    fn emit_all(&self, event: QuitEvent) {
        self.push(format!("EmitAll({}:{})", event.name(), event.request_id()));
    }

    fn emit_to(&self, label: &str, event: QuitEvent) {
        self.push(format!(
            "EmitTo({label}:{}:{})",
            event.name(),
            event.request_id()
        ));
    }

    fn activate(&self, label: &str) {
        self.push(format!("Activate({label})"));
    }

    fn arm_timer(&self, request_id: u64, deadline_ms: u64) {
        self.push(format!("ArmTimer({request_id}:{deadline_ms})"));
    }

    fn reply(&self, terminate: bool) {
        self.push(format!("Reply({terminate})"));
    }

    fn native_fallback(&self, request_id: u64, timed_out: Vec<String>) {
        self.push(format!("NativeFallback({request_id}:{})", timed_out.len()));
    }
}

/// A host over a real coordinator, with a settable window list.
struct TestHost {
    guard: QuitGuard<RecordingEffects>,
    labels: Mutex<Vec<String>>,
}

impl TestHost {
    fn new(flag: &'static AtomicBool) -> Arc<Self> {
        Arc::new(Self {
            guard: QuitGuard::with_flag(RecordingEffects::default(), flag),
            labels: Mutex::new(Vec::new()),
        })
    }

    fn set_labels(&self, labels: &[&str]) {
        *self.labels.lock().expect("test mutex") =
            labels.iter().map(|l| (*l).to_string()).collect();
    }

    fn recorded(&self) -> Vec<String> {
        self.guard.effects().recorded()
    }
}

impl QuitHost for TestHost {
    fn window_labels(&self) -> Vec<String> {
        self.labels.lock().expect("test mutex").clone()
    }

    fn begin(&self, labels: &[String], now_ms: u64) -> Begin {
        self.guard.begin(labels, now_ms)
    }
}

// --- WI4-M1 --------------------------------------------------------------

/// A fresh class gains the selector, on a real runtime with no NSApp.
#[test]
fn adding_to_a_fresh_class_reports_added_and_the_class_then_responds() {
    let cls = fresh_class("Fresh");
    assert!(
        !responds(cls),
        "the fixture must start without applicationShouldTerminate:"
    );

    let outcome = add_should_terminate(cls);

    assert_eq!(outcome, InstallOutcome::Added);
    assert!(
        responds(cls),
        "an Added outcome must mean the selector is really there"
    );
}

// --- WI4-M2 --------------------------------------------------------------

/// The tao-upgrade failure mode: we report it, and we do not shadow the class's
/// own implementation.
#[test]
fn adding_to_a_class_that_already_implements_it_leaves_the_original_imp() {
    let cls = class_with_existing_implementation("Existing");

    let outcome = add_should_terminate(cls);

    assert_eq!(outcome, InstallOutcome::AlreadyDefined);
    let obj = new_instance(cls);
    assert_eq!(
        send_should_terminate(&obj),
        SENTINEL,
        "class_replaceMethod would silently override a future tao's handler"
    );
}

// --- WI4-M3 --------------------------------------------------------------

/// Installation is not repeatable, and the second attempt changes nothing.
#[test]
fn a_second_add_is_already_defined_and_does_not_move_the_imp() {
    let cls = fresh_class("Twice");

    let first = add_should_terminate(cls);
    let imp_after_first = cls
        .instance_method(sel!(applicationShouldTerminate:))
        .expect("the selector is present after the first add")
        .implementation();

    let second = add_should_terminate(cls);
    let imp_after_second = cls
        .instance_method(sel!(applicationShouldTerminate:))
        .expect("the selector is still present")
        .implementation();

    assert_eq!(
        (first, second),
        (InstallOutcome::Added, InstallOutcome::AlreadyDefined)
    );
    assert!(
        std::ptr::fn_addr_eq(imp_after_first, imp_after_second),
        "a repeat install must not swap the implementation out from under AppKit"
    );
}

// --- WI4-M4 --------------------------------------------------------------

/// No delegate to hook is a reported failure, not a panic.
#[test]
fn install_on_none_reports_no_delegate() {
    assert_eq!(install_on(None), InstallOutcome::NoDelegate);
}

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
    static FLAG: AtomicBool = AtomicBool::new(false);
    FLAG.store(false, Ordering::SeqCst);

    let _lock = HOST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let host = TestHost::new(&FLAG);
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

    FLAG.store(false, Ordering::SeqCst);
}
