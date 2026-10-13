//! Plain spelling of a Windows verbatim path (D190-WI-5, audit W5).
//!
//! Purpose: turn the `\\?\C:\…` / `\\?\UNC\server\share\…` form that
//! `std::fs::canonicalize` returns on Windows into the ordinary `C:\…` /
//! `\\server\share\…` spelling the rest of mdpro (tab titles, drafts, MCP,
//! recent files) expects, and leave every other string alone.
//!
//! @coordinates-with launch_args.rs (`accepted_path_string` applies it to the
//! canonical path of every accepted launch argument)
//!
//! Key decisions:
//! - **String rules, not `std::path::Prefix`.** Prefix parsing only exists on
//!   Windows; working on the string keeps the rules testable on macOS. On a
//!   Unix path (never `\\?\`-prefixed) it is the identity, so callers apply
//!   it on every platform.
//! - **Same rules as the `dunce` crate, without the dependency.** Only the
//!   exact `\\?\` prefix followed by a drive (`C:\`) or `UNC\server\share` is
//!   simplified, and only when the plain spelling names the same file: every
//!   component is a valid Win32 name (not empty, `.` or `..`, at most 255
//!   chars, no trailing dot or space, none of `<>:"/\|?*` or control chars,
//!   not a reserved device stem such as `CON` or `com1.md`) and the plain
//!   path fits MAX_PATH (at most 259 chars). Anything else stays verbatim.

/// Longest plain path Win32 accepts without the verbatim prefix: MAX_PATH
/// (260) less the terminating NUL.
const MAX_PLAIN_LEN: usize = 259;
/// Longest single path component NTFS accepts.
const MAX_COMPONENT_LEN: usize = 255;
const VERBATIM: &str = r"\\?\";
const RESERVED_STEMS: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];

/// The plain spelling of `p` when `p` is a verbatim disk or UNC path whose
/// plain spelling means the same file; `p` unchanged otherwise.
pub fn simplify_verbatim(p: &str) -> String {
    plain_form(p).unwrap_or_else(|| p.to_string())
}

/// `Some(plain)` only when `p` is a verbatim path that is safe to strip.
fn plain_form(p: &str) -> Option<String> {
    let rest = p.strip_prefix(VERBATIM)?;
    let plain = match unc_tail(rest) {
        Some(tail) => {
            let mut parts = tail.splitn(3, '\\');
            let (server, share) = (parts.next()?, parts.next()?);
            if !valid_component(server) || !valid_component(share) {
                return None;
            }
            components_ok(parts.next())?;
            format!(r"\\{tail}")
        }
        None => {
            let bytes = rest.as_bytes();
            let is_drive = bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && bytes[2] == b'\\';
            if !is_drive {
                return None;
            }
            let body = &rest[3..];
            components_ok((!body.is_empty()).then_some(body))?;
            rest.to_string()
        }
    };
    (plain.chars().count() <= MAX_PLAIN_LEN).then_some(plain)
}

/// The part after `UNC\` (case-insensitive), when `rest` starts with it.
fn unc_tail(rest: &str) -> Option<&str> {
    let head = rest.get(..4)?;
    head.eq_ignore_ascii_case(r"UNC\").then(|| &rest[4..])
}

/// `Some(())` when there is no remainder or every `\`-separated component of
/// it is a valid name.
fn components_ok(remainder: Option<&str>) -> Option<()> {
    match remainder {
        None => Some(()),
        Some(r) => r.split('\\').all(valid_component).then_some(()),
    }
}

/// A component the plain spelling cannot reinterpret.
fn valid_component(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    if name.chars().count() > MAX_COMPONENT_LEN || name.ends_with(['.', ' ']) {
        return false;
    }
    if name
        .chars()
        .any(|c| c < ' ' || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
    {
        return false;
    }
    !is_reserved_stem(name.split('.').next().unwrap_or(name))
}

/// `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, any case.
fn is_reserved_stem(stem: &str) -> bool {
    let upper = stem.trim_end_matches(' ').to_ascii_uppercase();
    if RESERVED_STEMS.contains(&upper.as_str()) {
        return true;
    }
    match upper.as_bytes() {
        [a, b, c, d] => {
            let head = [*a, *b, *c];
            (&head == b"COM" || &head == b"LPT") && (b'1'..=b'9').contains(d)
        }
        _ => false,
    }
}

#[cfg(test)]
#[path = "path_plain_tests.rs"]
mod tests;
