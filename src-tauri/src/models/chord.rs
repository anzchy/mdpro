//! Chord parsing and per-platform normalisation (plan M1A-WI-5, C6), the twin
//! of `src/commands/chord.ts`. Both are held to the `parse` rows of
//! `tests/fixtures/binding-owner-cases.json`. No production consumer yet; the
//! conflict filter (M1A-WI-8) is the first.
//!
//! Grammar: `+`-separated; modifiers `Cmd | Ctrl | Option | Shift` (exact
//! case, each at most once) then exactly one key. A key is one printable
//! ASCII character other than `+` (letters are case-insensitive), a named key
//! (exact case; `ArrowUp` etc. alias `Up`), or `F1`–`F12`. A chord with no
//! modifier is valid only for `F1`–`F12`. Anything else, including the
//! sentinels `<unassigned>` / `<system>` and `""`, parses to `None`.
//!
//! Normal form: modifiers ordered Cmd, Ctrl, Option, Shift; letters
//! uppercase; arrows `Up/Down/Left/Right`. Off-Mac, `Cmd`, `Ctrl` or both
//! collapse to `Cmd`; on macOS they stay apart. Validity never depends on the
//! platform. Every function is total: no input panics.

use serde::Deserialize;

/// The platform a chord is normalised for (`commandTable.types.ts` `Platform`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
    Linux,
}

/// A parsed chord. `key` is in canonical spelling once normalised.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Chord {
    pub cmd: bool,
    pub ctrl: bool,
    pub option: bool,
    pub shift: bool,
    pub key: String,
}

const NAMED_KEYS: [&str; 14] = [
    "Up",
    "Down",
    "Left",
    "Right",
    "Space",
    "Backspace",
    "Delete",
    "Enter",
    "Tab",
    "Escape",
    "Home",
    "End",
    "PageUp",
    "PageDown",
];
const MAX_FUNCTION_KEY: u8 = 12;

fn is_function_key(key: &str) -> bool {
    let Some(digits) = key.strip_prefix('F') else {
        return false;
    };
    let well_formed = matches!(digits.len(), 1 | 2)
        && !digits.starts_with('0')
        && digits.bytes().all(|b| b.is_ascii_digit());
    well_formed && digits.parse::<u8>().is_ok_and(|n| n <= MAX_FUNCTION_KEY)
}

fn arrow_alias(token: &str) -> &str {
    match token {
        "ArrowUp" => "Up",
        "ArrowDown" => "Down",
        "ArrowLeft" => "Left",
        "ArrowRight" => "Right",
        other => other,
    }
}

/// The canonical spelling of a key token, or `None` if it is not a key.
fn canonical_key(token: &str) -> Option<String> {
    if let [byte] = token.as_bytes() {
        let printable = (0x21..=0x7e).contains(byte) && *byte != b'+';
        return printable.then(|| token.to_ascii_uppercase());
    }
    let aliased = arrow_alias(token);
    (NAMED_KEYS.contains(&aliased) || is_function_key(aliased)).then(|| aliased.to_string())
}

/// Collapse modifiers for the platform and canonicalise the key spelling.
pub fn normalise_chord(chord: &Chord, platform: Platform) -> Chord {
    let key = canonical_key(&chord.key).unwrap_or_else(|| chord.key.clone());
    match platform {
        Platform::Macos => Chord {
            key,
            ..chord.clone()
        },
        Platform::Windows | Platform::Linux => Chord {
            cmd: chord.cmd || chord.ctrl,
            ctrl: false,
            option: chord.option,
            shift: chord.shift,
            key,
        },
    }
}

/// Parse a stored string and normalise it for `platform`; `None` if unparseable.
pub fn parse_chord(stored: &str, platform: Platform) -> Option<Chord> {
    let (modifiers, key_token) = match stored.rsplit_once('+') {
        Some((mods, key)) => (Some(mods), key),
        None => (None, stored),
    };
    let mut chord = Chord {
        cmd: false,
        ctrl: false,
        option: false,
        shift: false,
        key: canonical_key(key_token)?,
    };
    for token in modifiers.into_iter().flat_map(|m| m.split('+')) {
        let flag = match token {
            "Cmd" => &mut chord.cmd,
            "Ctrl" => &mut chord.ctrl,
            "Option" => &mut chord.option,
            "Shift" => &mut chord.shift,
            _ => return None,
        };
        if *flag {
            return None;
        }
        *flag = true;
    }
    if modifiers.is_none() && !is_function_key(&chord.key) {
        return None;
    }
    Some(normalise_chord(&chord, platform))
}

/// Write a chord in stored syntax, modifiers in canonical order.
pub fn format_chord(chord: &Chord) -> String {
    let modifiers = [
        (chord.cmd, "Cmd"),
        (chord.ctrl, "Ctrl"),
        (chord.option, "Option"),
        (chord.shift, "Shift"),
    ];
    let mut parts: Vec<&str> = modifiers
        .iter()
        .filter(|(on, _)| *on)
        .map(|(_, name)| *name)
        .collect();
    parts.push(&chord.key);
    parts.join("+")
}

/// The normal form of a stored string on `platform`, or `None` if unparseable.
pub fn normalise_stored(stored: &str, platform: Platform) -> Option<String> {
    parse_chord(stored, platform).map(|chord| format_chord(&chord))
}

#[cfg(test)]
#[path = "chord_tests.rs"]
mod tests;
