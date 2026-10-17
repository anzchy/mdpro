//! Purpose: the control channel's native input on macOS (ADR-0047 WI-009,
//! from candidate B's spike): one `NSEvent` per key or mouse button, handed
//! to the labelled window with `-[NSWindow sendEvent:]` on the main thread.
//! WebKit then makes the DOM events itself, with the modifiers, text input and
//! native selection a person's key would get. This is the Objective-C interop
//! counted apart (S6).
//!
//! Key decisions:
//! - `activate` makes the window key and activates the app. It sends no event
//!   into the page (user ruling 2026-10-17: 「Allow activate, record it (Recommended)」).
//! - Coordinates come in as CSS px from the top-left of the webview, which fills
//!   the window (`titleBarStyle: Overlay`), and become window points from the
//!   bottom-left.

mod keys;

use std::sync::mpsc;
use std::time::Duration;

use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSEvent, NSEventModifierFlags, NSEventType, NSWindow};
use objc2_foundation::{NSPoint, NSProcessInfo, NSString};
use serde_json::{json, Value};
use tauri::{Runtime, WebviewWindow};

use super::proto::Failure;
use super::server::Input;
use keys::{mod_flags, press, text_presses, Press};

const MAIN_THREAD_WAIT: Duration = Duration::from_secs(5);

/// Sends `input` to `win` as native events.
pub fn input<R: Runtime>(win: &WebviewWindow<R>, input: Input) -> Result<Value, Failure> {
    match input {
        Input::Activate => activate(win).map(|key| json!({ "key": key })),
        Input::Key { key, mods, repeat } => {
            let p = press(&key, mod_flags(&mods)?, repeat)?;
            keys(win, vec![p]).map(|()| json!(true))
        }
        Input::Text(text) => keys(win, text_presses(&text)?).map(|()| json!(true)),
        Input::Click { x, y } => {
            click(win, x, y).map(|(wx, wy)| json!({ "css": [x, y], "window": [wx, wy] }))
        }
    }
}

/// Runs `f` with the labelled window's `NSWindow` on the main thread and waits for its result.
fn on_main<R: Runtime, T: Send + 'static>(
    win: &WebviewWindow<R>,
    f: impl FnOnce(&NSWindow, MainThreadMarker) -> Result<T, Failure> + Send + 'static,
) -> Result<T, Failure> {
    let (tx, rx) = mpsc::channel();
    let w = win.clone();
    win.run_on_main_thread(move || {
        let out = match (MainThreadMarker::new(), w.ns_window()) {
            (Some(mtm), Ok(ptr)) if !ptr.is_null() => {
                // SAFETY: Tauri returns the window's live NSWindow, and this closure runs on the main thread.
                let ns: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
                f(ns, mtm)
            }
            _ => Err(Failure::new("no_such_window", "no native window")),
        };
        let _ = tx.send(out);
    })
    .map_err(|e| Failure::new("no_such_window", format!("main thread unavailable: {e}")))?;
    rx.recv_timeout(MAIN_THREAD_WAIT)
        .map_err(|_| Failure::timeout())?
}

fn now() -> f64 {
    NSProcessInfo::processInfo().systemUptime()
}

fn send_key(ns: &NSWindow, p: &Press) -> Result<(), Failure> {
    let chars = if p.flags.contains(NSEventModifierFlags::Shift) {
        &p.def.shifted
    } else {
        &p.def.plain
    };
    let (chars, plain) = (NSString::from_str(chars), NSString::from_str(&p.def.plain));
    for _ in 0..p.times {
        for kind in [NSEventType::KeyDown, NSEventType::KeyUp] {
            let ev = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                kind, NSPoint::new(0.0, 0.0), p.flags, now(), ns.windowNumber(), None, &chars, &plain, false, p.def.code,
            )
            .ok_or_else(|| Failure::new("script_error", "NSEvent key creation failed"))?;
            ns.sendEvent(&ev);
        }
    }
    Ok(())
}

fn keys<R: Runtime>(win: &WebviewWindow<R>, presses: Vec<Press>) -> Result<(), Failure> {
    on_main(win, move |ns, _| {
        presses.iter().try_for_each(|p| send_key(ns, p))
    })
}

/// A left click at CSS (x, y). Returns the window point used.
fn click<R: Runtime>(win: &WebviewWindow<R>, x: f64, y: f64) -> Result<(f64, f64), Failure> {
    on_main(win, move |ns, _| {
        let height = ns
            .contentView()
            .map(|v| v.frame().size.height)
            .ok_or_else(|| Failure::new("no_such_window", "no content view"))?;
        let at = NSPoint::new(x, height - y);
        for (n, kind) in [NSEventType::LeftMouseDown, NSEventType::LeftMouseUp]
            .into_iter()
            .enumerate()
        {
            let ev = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                kind, at, NSEventModifierFlags::empty(), now(), ns.windowNumber(), None, n as isize, 1, 1.0,
            )
            .ok_or_else(|| Failure::new("script_error", "NSEvent mouse creation failed"))?;
            ns.sendEvent(&ev);
        }
        Ok((at.x, at.y))
    })
}

/// Makes the window key and activates the app; no event reaches the page.
fn activate<R: Runtime>(win: &WebviewWindow<R>) -> Result<bool, Failure> {
    on_main(win, |ns, mtm| {
        #[allow(deprecated)]
        // `activate()` (macOS 14) is cooperative and may not take focus from a terminal.
        NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        ns.makeKeyAndOrderFront(None);
        Ok(ns.isKeyWindow())
    })
}
