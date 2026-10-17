//! Purpose: the control channel's key table (ADR-0047 WI-009, from
//! candidate B's spike): ANSI (ABC) keyCodes for the keys the journeys press,
//! printable ASCII for `type`, and the four modifier names. Every brief checks
//! the input source is ABC.

use objc2_app_kit::NSEventModifierFlags;

use super::super::proto::Failure;

/// A key: its ANSI keyCode, the characters it types unshifted and shifted.
#[derive(Debug)]
pub struct KeyDef {
    pub code: u16,
    pub plain: String,
    pub shifted: String,
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
#[derive(Debug)]
pub struct Press {
    pub def: KeyDef,
    pub flags: NSEventModifierFlags,
    pub times: usize,
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

#[cfg(test)]
#[path = "keys_tests.rs"]
mod keys_tests;
