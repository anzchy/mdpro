//! Purpose: candidate B's native input (ADR-0047 WI-007 spike): one `NSEvent`
//! per key or mouse button, handed to the labelled window with
//! `-[NSWindow sendEvent:]` on the main thread. WebKit then makes the DOM
//! events itself, with the modifiers, text input and native selection a
//! person's key would get. This is the Objective-C interop S6 counts apart.
//!
//! Key decisions:
//! - The key table covers what the journeys press: letters, digits, arrows,
//!   Backspace, Enter, Escape, Tab, Space and printable ASCII for `type`.
//!   keyCodes are the ANSI (ABC) layout's; every brief checks the input source.
//! - `activate` makes the window key and activates the app. It sends no event
//!   into the page (user ruling 2026-10-17: 「Allow activate, record it (Recommended)」).
//! - Coordinates come in as CSS px from the top-left of the webview, which fills
//!   the window (`titleBarStyle: Overlay`), and become window points from the
//!   bottom-left.

use std::sync::mpsc;
use std::time::Duration;

use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSEvent, NSEventModifierFlags, NSEventType, NSWindow};
use objc2_foundation::{NSPoint, NSProcessInfo, NSString};
use tauri::{Runtime, WebviewWindow};

use super::proto::Failure;

const MAIN_THREAD_WAIT: Duration = Duration::from_secs(5);

/// A key: its ANSI keyCode, the characters it types unshifted and shifted.
struct KeyDef {
    code: u16,
    plain: String,
    shifted: String,
}

fn named(name: &str) -> Option<KeyDef> {
    let (code, ch): (u16, char) = match name {
        "ArrowLeft" => (123, '\u{F702}'),
        "ArrowRight" => (124, '\u{F703}'),
        "ArrowDown" => (125, '\u{F701}'),
        "ArrowUp" => (126, '\u{F700}'),
        "Backspace" => (51, '\u{7F}'),
        "Enter" => (36, '\r'),
        "Escape" => (53, '\u{1B}'),
        "Tab" => (48, '\t'),
        "Space" => (49, ' '),
        _ => return None,
    };
    Some(KeyDef {
        code,
        plain: ch.to_string(),
        shifted: ch.to_string(),
    })
}

/// ANSI keyCode, unshifted and shifted character, for printable ASCII.
const ANSI: &[(u16, char, char)] = &[
    (0, 'a', 'A'),
    (11, 'b', 'B'),
    (8, 'c', 'C'),
    (2, 'd', 'D'),
    (14, 'e', 'E'),
    (3, 'f', 'F'),
    (5, 'g', 'G'),
    (4, 'h', 'H'),
    (34, 'i', 'I'),
    (38, 'j', 'J'),
    (40, 'k', 'K'),
    (37, 'l', 'L'),
    (46, 'm', 'M'),
    (45, 'n', 'N'),
    (31, 'o', 'O'),
    (35, 'p', 'P'),
    (12, 'q', 'Q'),
    (15, 'r', 'R'),
    (1, 's', 'S'),
    (17, 't', 'T'),
    (32, 'u', 'U'),
    (9, 'v', 'V'),
    (13, 'w', 'W'),
    (7, 'x', 'X'),
    (16, 'y', 'Y'),
    (6, 'z', 'Z'),
    (29, '0', ')'),
    (18, '1', '!'),
    (19, '2', '@'),
    (20, '3', '#'),
    (21, '4', '$'),
    (23, '5', '%'),
    (22, '6', '^'),
    (26, '7', '&'),
    (28, '8', '*'),
    (25, '9', '('),
    (27, '-', '_'),
    (24, '=', '+'),
    (33, '[', '{'),
    (30, ']', '}'),
    (42, '\\', '|'),
    (41, ';', ':'),
    (39, '\'', '"'),
    (43, ',', '<'),
    (47, '.', '>'),
    (44, '/', '?'),
    (50, '`', '~'),
    (49, ' ', ' '),
];

/// A printable character: its key and whether Shift is needed to type it.
fn printable(c: char) -> Option<(KeyDef, bool)> {
    ANSI.iter().find_map(|&(code, lo, hi)| {
        let def = || KeyDef {
            code,
            plain: lo.to_string(),
            shifted: hi.to_string(),
        };
        if c == lo {
            Some((def(), false))
        } else if c == hi {
            Some((def(), true))
        } else {
            None
        }
    })
}

fn key_def(name: &str) -> Option<KeyDef> {
    named(name).or_else(|| {
        let mut it = name.chars();
        match (it.next(), it.next()) {
            (Some(c), None) => printable(c).map(|(k, _)| k),
            _ => None,
        }
    })
}

pub fn mod_flags(mods: &[String]) -> Result<NSEventModifierFlags, Failure> {
    let mut f = NSEventModifierFlags::empty();
    for m in mods {
        f |= match m.as_str() {
            "shift" => NSEventModifierFlags::Shift,
            "cmd" => NSEventModifierFlags::Command,
            "ctrl" => NSEventModifierFlags::Control,
            "alt" => NSEventModifierFlags::Option,
            other => {
                return Err(Failure::new(
                    "bad_request",
                    format!("unknown modifier {other}"),
                ))
            }
        };
    }
    Ok(f)
}

/// One planned key press: definition, flags, repeat count.
pub struct Press {
    def: KeyDef,
    flags: NSEventModifierFlags,
    times: usize,
}

pub fn press(name: &str, flags: NSEventModifierFlags, times: usize) -> Result<Press, Failure> {
    let def =
        key_def(name).ok_or_else(|| Failure::new("bad_request", format!("unknown key {name}")))?;
    Ok(Press { def, flags, times })
}

pub fn text_presses(text: &str) -> Result<Vec<Press>, Failure> {
    text.chars()
        .map(|c| {
            let (def, shift) = printable(c).ok_or_else(|| {
                Failure::new(
                    "bad_request",
                    format!("cannot type {c:?} (printable ASCII only)"),
                )
            })?;
            let flags = if shift {
                NSEventModifierFlags::Shift
            } else {
                NSEventModifierFlags::empty()
            };
            Ok(Press {
                def,
                flags,
                times: 1,
            })
        })
        .collect()
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

pub fn keys<R: Runtime>(win: &WebviewWindow<R>, presses: Vec<Press>) -> Result<(), Failure> {
    on_main(win, move |ns, _| {
        presses.iter().try_for_each(|p| send_key(ns, p))
    })
}

/// A left click at CSS (x, y). Returns the window point used.
pub fn click<R: Runtime>(win: &WebviewWindow<R>, x: f64, y: f64) -> Result<(f64, f64), Failure> {
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
pub fn activate<R: Runtime>(win: &WebviewWindow<R>) -> Result<bool, Failure> {
    on_main(win, |ns, mtm| {
        #[allow(deprecated)]
        // `activate()` (macOS 14) is cooperative and may not take focus from a terminal.
        NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        ns.makeKeyAndOrderFront(None);
        Ok(ns.isKeyWindow())
    })
}
