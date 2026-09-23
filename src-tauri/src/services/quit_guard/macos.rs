//! Purpose: give the quit coordinator its caller — the `applicationShouldTerminate:`
//! that tao's delegate class does not implement (ADR-0025 §1).
//!
//! Pipeline: `setup()` -> `install` -> `class_addMethod` on the **running**
//! delegate class -> the added IMP -> `HOST` -> `QuitGuard::begin` ->
//! `ns_reply_for` -> AppKit.
//!
//! Key decisions:
//! - **Add, never replace.** `class_addMethod` fails if the class already
//!   defines the selector, and that failure is reported as `AlreadyDefined`
//!   rather than overridden. A future tao that implements the method itself must
//!   show up in the log, not be silently shadowed.
//! - **The host lives in a swappable `RwLock` slot**, not a `OnceLock`, so a
//!   test can drive the real IMP against a real coordinator. An empty slot fails
//!   open to `NSTerminateNow`: the app stays quittable.
//! - **Every AppKit call is posted to the main thread.** `quit_guard_reply`
//!   arrives on a command thread, and `replyToApplicationShouldTerminate:`,
//!   activation and `NSAlert` are all main-thread-only.
//! - **The alert is presented outside the coordinator lock.** `run_on_main_thread`
//!   posts and returns, so `native_fallback` never holds a guard across
//!   `runModal`, whose nested run loop can re-enter the driver.
//!
//! @coordinates-with docs/adr/0025-app-quit-is-deferred-through-a-native-terminate-hook.md
//! @coordinates-with docs/adr/0027-a-quit-ack-timeout-draws-a-native-alert.md

use std::ffi::CString;
use std::fmt::Write as _;
use std::sync::{Arc, RwLock};

use objc2::encode::{Encode, Encoding};
use objc2::ffi;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{sel, MainThreadMarker};
use objc2_app_kit::{NSAlert, NSAlertStyle, NSApplication};
use objc2_foundation::NSString;
use tauri::{AppHandle, Manager};

use super::coordinator::Begin;
use super::effects::{now_ms, AppQuitGuard};
use super::{fallback_answer_for, logging, ns_reply_for, InstallOutcome, NS_TERMINATE_NOW};

/// The alert's wording (ADR-0027 §2). It names no document and offers no save:
/// at timeout the coordinator does not know which windows are dirty, so the text
/// has to state the worst case.
const ALERT_TITLE: &str = "mdpro isn’t responding to the quit request";
const ALERT_BODY: &str = "One or more editor windows didn’t answer in time, so mdpro can’t check them for unsaved changes.\n\nQuitting now will discard unsaved changes in every window. Drafts are kept, so you may be able to recover them the next time you open mdpro.";
const KEEP_OPEN_TITLE: &str = "Keep Open";
const QUIT_ANYWAY_TITLE: &str = "Quit Without Saving";

/// What the added IMP needs from the app. A trait so the IMP can be driven in a
/// test against a real coordinator without a running NSApp.
pub trait QuitHost: Send + Sync + 'static {
    /// The windows open right now, in a stable order.
    fn window_labels(&self) -> Vec<String>;
    fn begin(&self, labels: &[String], now_ms: u64) -> Begin;
}

/// The IMP's host. A slot rather than a `OnceLock` so tests can swap a real
/// coordinator in and put the previous host back.
static HOST: RwLock<Option<Arc<dyn QuitHost>>> = RwLock::new(None);

/// A poisoned slot means another thread panicked while swapping; the value
/// behind it is a plain `Option` the panic cannot have torn.
fn set_host(host: Option<Arc<dyn QuitHost>>) -> Option<Arc<dyn QuitHost>> {
    let mut slot = HOST.write().unwrap_or_else(|e| e.into_inner());
    std::mem::replace(&mut *slot, host)
}

fn host() -> Option<Arc<dyn QuitHost>> {
    HOST.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Tests serialise on this, because `HOST` is process-global.
#[cfg(test)]
pub(crate) static HOST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
pub(crate) fn swap_host(host: Option<Arc<dyn QuitHost>>) -> Option<Arc<dyn QuitHost>> {
    set_host(host)
}

/// The production host: the app's windows, and the guard in managed state.
struct AppQuitHost {
    app: AppHandle,
}

impl QuitHost for AppQuitHost {
    fn window_labels(&self) -> Vec<String> {
        // Sorted, because `webview_windows()` is a `HashMap` and ADR-0025 §2
        // promises the dirty windows are prompted in a fixed snapshot order.
        let mut labels: Vec<String> = self.app.webview_windows().into_keys().collect();
        labels.sort();
        labels
    }

    fn begin(&self, labels: &[String], now_ms: u64) -> Begin {
        match self.app.try_state::<AppQuitGuard>() {
            Some(guard) => guard.begin(labels, now_ms),
            // No guard means setup never finished. Quitting is the safe answer:
            // there is no document state to lose yet.
            None => Begin::TerminateNow,
        }
    }
}

/// The implementation added to the delegate class.
///
/// `extern "C-unwind"` to match `objc2::runtime::Imp`.
extern "C-unwind" fn should_terminate(
    _this: &AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) -> usize {
    // Read the slot and drop the lock before calling out: `begin` emits events
    // and arms a timer, and neither may run under this lock.
    let Some(host) = host() else {
        // Unreachable by construction — `install` fills the slot before adding
        // the method. If it ever happens, staying quittable beats hanging on a
        // `Later` that nobody will answer.
        logging::log_hook_no_host();
        return FAIL_OPEN;
    };
    ns_reply_for(&host.begin(&host.window_labels(), now_ms()))
}

/// The ObjC type encoding for `-(NSUInteger)applicationShouldTerminate:(id)`.
///
/// Built from `objc2`'s own `Encode` impls rather than a hard-coded `"Q@:@"`, so
/// a pointer-width or ABI change cannot leave a stale string behind.
fn should_terminate_type_encoding() -> CString {
    let ret = <usize as Encode>::ENCODING;
    let args: [Encoding; 1] = [<*mut AnyObject as Encode>::ENCODING];
    let mut types = format!(
        "{ret}{}{}",
        <*mut AnyObject as Encode>::ENCODING,
        <Sel as Encode>::ENCODING
    );
    for arg in &args {
        let _ = write!(&mut types, "{arg}");
    }
    CString::new(types).expect("an ObjC type encoding never contains a nul byte")
}

/// Add `applicationShouldTerminate:` to `cls`, without replacing an existing one.
pub fn add_should_terminate(cls: &AnyClass) -> InstallOutcome {
    let types = should_terminate_type_encoding();
    // SAFETY: `should_terminate` is an `extern "C-unwind"` function whose
    // signature — `(id self, SEL _cmd, id sender) -> NSUInteger` — matches both
    // `Imp`'s shape and the `types` encoding built above from the same Rust
    // types. `cls` is a live, registered class, and `class_addMethod` mutates
    // only the class's own method list; it returns NO rather than replacing
    // anything when the class already defines the selector.
    let added = unsafe {
        let imp: Imp = std::mem::transmute::<
            extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize,
            Imp,
        >(should_terminate);
        ffi::class_addMethod(
            (cls as *const AnyClass).cast_mut(),
            sel!(applicationShouldTerminate:),
            imp,
            types.as_ptr(),
        )
    };
    if added.as_bool() {
        InstallOutcome::Added
    } else {
        // The only way `class_addMethod` refuses is that the class already
        // defines the selector itself. Reported, never replaced.
        InstallOutcome::AlreadyDefined
    }
}

/// Add the hook to the delegate class we were handed, and log the result.
///
/// The lookup is a parameter so the no-delegate path is testable without an
/// NSApp. A failure is logged at error level: an install that silently did
/// nothing looks like a working app and discards unsaved work.
pub fn install_on(delegate_class: Option<&AnyClass>) -> InstallOutcome {
    let outcome = match delegate_class {
        Some(cls) => add_should_terminate(cls),
        None => InstallOutcome::NoDelegate,
    };
    let name = delegate_class.map(|cls| cls.name().to_string_lossy().into_owned());
    logging::log_hook_installed(name.as_deref(), outcome);
    outcome
}

/// The class of the running `NSApp` delegate — tao's private
/// `TaoAppDelegateParent` today, which is why the name is logged.
fn delegate_class() -> Option<&'static AnyClass> {
    let mtm = MainThreadMarker::new()?;
    let delegate = NSApplication::sharedApplication(mtm).delegate()?;
    let object: &AnyObject = delegate.as_ref();
    Some(object.class())
}

/// Fill the host slot, then add the method. The order matters: the IMP can be
/// called the instant it exists.
pub fn install(app: &AppHandle) {
    set_host(Some(Arc::new(AppQuitHost { app: app.clone() })));
    install_on(delegate_class());
}

/// Bring the app forward before a window is prompted (ADR-0025 §2). A dialog in
/// a hidden app is never painted, which reads as a hang.
pub fn activate_app(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        ns_app.unhide(None);
        #[allow(deprecated)]
        ns_app.activateIgnoringOtherApps(true);
    });
}

/// Resolve the pending `NSTerminateLater`. Called exactly once per request,
/// from either the ordinary path or the fallback, never both.
pub fn reply_to_should_terminate(app: &AppHandle, terminate: bool) {
    let _ = app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        NSApplication::sharedApplication(mtm).replyToApplicationShouldTerminate(terminate);
    });
}

/// The ADR-0027 timeout alert.
///
/// `run_on_main_thread` posts and returns, so the caller's coordinator lock is
/// long released before `runModal` spins its nested run loop. A webview that
/// recovers mid-alert can therefore call `quit_guard_reply` without deadlocking;
/// the coordinator ignores it, because the fallback owns the request.
pub fn present_timeout_alert(app: &AppHandle, request_id: u64) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        ns_app.unhide(None);
        #[allow(deprecated)]
        ns_app.activateIgnoringOtherApps(true);

        let alert = NSAlert::new(mtm);
        alert.setAlertStyle(NSAlertStyle::Warning);
        alert.setMessageText(&NSString::from_str(ALERT_TITLE));
        alert.setInformativeText(&NSString::from_str(ALERT_BODY));
        // Added first, so AppKit makes it the default (Return) button.
        let _keep_open = alert.addButtonWithTitle(&NSString::from_str(KEEP_OPEN_TITLE));
        let quit_anyway = alert.addButtonWithTitle(&NSString::from_str(QUIT_ANYWAY_TITLE));
        // No keystroke may land on the discarding button. AppKit only assigns
        // Escape to a button titled "Cancel", but clearing it costs nothing and
        // the cost of being wrong is unsaved work.
        quit_anyway.setKeyEquivalent(&NSString::from_str(""));

        let answer = fallback_answer_for(alert.runModal());
        if let Some(guard) = app.try_state::<AppQuitGuard>() {
            guard.fallback_answer(request_id, answer);
        }
    });
}

/// The IMP's fail-open value, named so the unreachable empty-slot path reads as
/// a decision rather than a stray constant.
const FAIL_OPEN: usize = NS_TERMINATE_NOW;

#[cfg(test)]
#[path = "macos_tests.rs"]
mod macos_tests;
