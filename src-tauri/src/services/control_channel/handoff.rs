//! Purpose: the control channel's per-launch credential and its handoff
//! (ADR-0047 WI-009): the token, `control.json` and the bound socket, all
//! inside the verified run dir.
//!
//! Key decisions:
//! - The token is 32 bytes from the OS RNG, new every launch, so a token from
//!   an earlier run is refused. It reaches only `control.json`, never the log,
//!   stdout or an env var.
//! - `control.json` is `create_new` and 0600: an existing file is never
//!   replaced. The socket is 0600 too.
//! - A socket path that does not fit `sun_path` keeps the channel closed; it
//!   never moves outside the run dir.

use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::net::UnixListener;
use std::path::Path;

use rand::RngCore;
use serde_json::json;

pub const HANDOFF_FILE: &str = "control.json";
/// The name `scripts/control/runDir.mjs` budgets the runs path for.
pub const SOCKET_FILE: &str = "ctl.sock";
/// `sizeof(sockaddr_un.sun_path)` on macOS, including the terminating NUL.
pub const SUN_PATH_MAX: usize = 104;
const TOKEN_BYTES: usize = 32;

/// A fresh per-launch token, hex-encoded.
pub fn new_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// True if `socket` fits `sun_path` with its terminating NUL.
pub fn socket_fits(socket: &Path) -> bool {
    socket.as_os_str().len() < SUN_PATH_MAX
}

/// Writes `{socket, token, eval}` to a new 0600 file; fails if it exists.
pub fn write_handoff(path: &Path, socket: &Path, token: &str, eval: bool) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(
        json!({ "socket": socket, "token": token, "eval": eval })
            .to_string()
            .as_bytes(),
    )?;
    f.sync_all()
}

/// Binds the socket and narrows it to 0600.
pub fn bind(socket: &Path) -> std::io::Result<UnixListener> {
    let listener = UnixListener::bind(socket)?;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// Removes the socket and `control.json` at exit; either may already be gone.
pub fn remove_handoff(run_dir: &Path) {
    for name in [SOCKET_FILE, HANDOFF_FILE] {
        let _ = std::fs::remove_file(run_dir.join(name));
    }
}

#[cfg(test)]
#[path = "handoff_tests.rs"]
mod handoff_tests;
