//! Purpose: publish and unpublish the MCP server files (`server.port`,
//! `server.token`) that the `mdpro-mcp` sidecar reads to find the app.
//!
//! Pipeline: `publish(dir, port, token)` -> token tmp (0600) -> rename ->
//! port tmp -> rename. `unpublish(dir)` -> remove port -> remove token.
//!
//! Key decisions:
//! - Parameterised by directory, never `dirs::data_dir()`: the caller
//!   (`http_server`) supplies the real dir, and tests supply a temp dir.
//! - Invariant "`server.port` present => `server.token` present" (ADR-0040):
//!   publish writes the token first and the port second; unpublish removes
//!   the port first. A failed token write also removes a stale port, so a
//!   sidecar never finds a port whose token is missing.
//! - Each file is written to a tmp name in the same dir and renamed into
//!   place, so a reader never sees a half-written file.
//! - The token is opened only through `open_owner_only` (PC-6). It removes
//!   any existing entry first, because `mode(0o600)` does not change the mode
//!   of a file that already exists (a stale 0644 tmp from a crash), and an fd
//!   opened on the old inode while it was 0644 must not see the new token.
//!   The file is 0600 before any byte is written; the rename keeps the mode.
//! - `FilesError` carries no path and no OS text: it reaches logs and status.
//! - `unpublish` touches only the two files. It never removes the dir or any
//!   sibling (drafts, preferences), and a missing dir is not created.
//!
//! @coordinates-with src/services/mcp_controller/transitions.rs,
//!   launch.rs, controller.rs (the only callers)
//! @coordinates-with src/services/http_server.rs (`app_controller_env` names
//!   the app's dir)
//! @coordinates-with src/bin/mdpro_mcp.rs (reads the two files)

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;

/// File the sidecar reads the port from.
pub(crate) const PORT_FILE: &str = "server.port";
/// File the sidecar reads the auth token from.
pub(crate) const TOKEN_FILE: &str = "server.token";
/// Temp name the token is written under before the rename.
pub(crate) const TOKEN_TMP_NAME: &str = "server.token.tmp";
/// Temp name the port is written under before the rename.
pub(crate) const PORT_TMP_NAME: &str = "server.port.tmp";
/// Owner read/write only.
#[cfg(unix)]
const OWNER_ONLY_MODE: u32 = 0o600;

/// Why `publish` failed. Deliberately payload-free: no path, no OS text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilesError {
    CreateDir,
    WriteToken,
    WritePort,
}

impl std::fmt::Display for FilesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            FilesError::CreateDir => "could not create the server config directory",
            FilesError::WriteToken => "could not write the server token file",
            FilesError::WritePort => "could not write the server port file",
        };
        f.write_str(text)
    }
}

/// Open `path` as a new, empty, owner-only (0600) file for writing.
///
/// Any existing entry at `path` is removed first and the file is created with
/// `create_new`, so the handle never refers to a pre-existing inode. The mode
/// is 0600 before this returns, i.e. before any byte is written. Fails if the
/// entry cannot be removed (e.g. it is a directory).
pub fn open_owner_only(path: &Path) -> io::Result<File> {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(OWNER_ONLY_MODE);
    let file = options.open(path)?;
    // The create mode is masked by the umask; pin it to exactly 0600 so a
    // stricter umask cannot leave the owner unable to read its own token.
    #[cfg(unix)]
    file.set_permissions(fs::Permissions::from_mode(OWNER_ONLY_MODE))?;
    Ok(file)
}

/// Write `bytes` to `dir/tmp_name` through `open`, then rename it to
/// `dir/final_name`. The tmp file is removed if any step fails.
fn write_via_tmp(
    dir: &Path,
    tmp_name: &str,
    final_name: &str,
    bytes: &[u8],
    open: fn(&Path) -> io::Result<File>,
) -> io::Result<()> {
    let tmp = dir.join(tmp_name);
    let result = open(&tmp)
        .and_then(|mut f| f.write_all(bytes).and_then(|()| f.sync_all()))
        .and_then(|()| fs::rename(&tmp, dir.join(final_name)));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Open a plain (umask-mode) file for the port, replacing any stale tmp.
fn open_plain(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
}

/// Publish `port` and `token` into `dir`: the token first, then the port.
///
/// On `Err(WriteToken)` no `server.port` exists afterwards, even a stale one.
/// On `Err(WritePort)` the new token is removed again, so nothing is left
/// half-published.
pub fn publish(dir: &Path, port: u16, token: &str) -> Result<(), FilesError> {
    fs::create_dir_all(dir).map_err(|_| FilesError::CreateDir)?;

    if write_via_tmp(
        dir,
        TOKEN_TMP_NAME,
        TOKEN_FILE,
        token.as_bytes(),
        open_owner_only,
    )
    .is_err()
    {
        let _ = fs::remove_file(dir.join(PORT_FILE));
        return Err(FilesError::WriteToken);
    }

    let port_text = port.to_string();
    if write_via_tmp(
        dir,
        PORT_TMP_NAME,
        PORT_FILE,
        port_text.as_bytes(),
        open_plain,
    )
    .is_err()
    {
        unpublish(dir);
        return Err(FilesError::WritePort);
    }
    Ok(())
}

/// Remove `server.port`, then `server.token`, from `dir`.
///
/// Idempotent and infallible: a missing dir or missing file is the goal
/// state. Nothing else in `dir` is touched, and `dir` is never created.
pub fn unpublish(dir: &Path) {
    let _ = fs::remove_file(dir.join(PORT_FILE));
    let _ = fs::remove_file(dir.join(TOKEN_FILE));
}

#[cfg(test)]
#[cfg(unix)]
#[path = "files_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "files_unpublish_tests.rs"]
mod unpublish_tests;
