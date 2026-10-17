//! Purpose: reads the control channel's opt-in marker (ADR-0047 WI-009
//! WI 3, decision 6's explicit opt-in). `launch --control on|eval` writes
//! `control-optin.json` into the run dir (`scripts/control/controlOptin.mjs`);
//! without it the channel stays closed.
//!
//! Key decisions:
//! - Fail closed: only a regular file owned by this uid, mode 0600 or
//!   narrower, holding exactly `{"eval": bool}`, opens the channel. Anything
//!   else is `Refused` with a reason for the log, and the channel stays shut.
//! - Opened with `O_NOFOLLOW`, then judged on the opened file's own metadata,
//!   so a symlink is refused and nothing can be swapped in between the check
//!   and the read.
//! - `eval` rides on the same marker; there is no second switch.

use std::io::Read;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

use serde::Deserialize;

pub const OPTIN_FILE: &str = "control-optin.json";
/// The bits the marker may carry: owner read and write.
const ALLOWED_MODE: u32 = 0o600;
/// More than the launcher ever writes.
const MAX_BYTES: u64 = 256;

/// What the marker says about this launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptIn {
    Absent,
    Open { eval: bool },
    Refused(&'static str),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    eval: bool,
}

/// Reads `<run_dir>/control-optin.json`, which must belong to `uid`.
pub fn read(run_dir: &Path, uid: u32) -> OptIn {
    let file = match std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(run_dir.join(OPTIN_FILE))
    {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return OptIn::Absent,
        Err(e) if e.raw_os_error() == Some(libc::ELOOP) => return OptIn::Refused("symlink"),
        Err(_) => return OptIn::Refused("unreadable"),
    };
    let meta = match file.metadata() {
        Ok(m) => m,
        Err(_) => return OptIn::Refused("unreadable"),
    };
    if !meta.is_file() {
        return OptIn::Refused("not_file");
    }
    if meta.uid() != uid {
        return OptIn::Refused("owner");
    }
    if meta.mode() & 0o777 & !ALLOWED_MODE != 0 {
        return OptIn::Refused("mode");
    }
    let mut body = String::new();
    if file.take(MAX_BYTES).read_to_string(&mut body).is_err() {
        return OptIn::Refused("content");
    }
    // An object only: serde would also take a struct written as `[true]`.
    match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(v @ serde_json::Value::Object(_)) => match serde_json::from_value::<Marker>(v) {
            Ok(m) => OptIn::Open { eval: m.eval },
            Err(_) => OptIn::Refused("content"),
        },
        _ => OptIn::Refused("content"),
    }
}

#[cfg(test)]
#[path = "optin_tests.rs"]
mod optin_tests;
