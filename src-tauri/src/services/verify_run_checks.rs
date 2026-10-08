//! Purpose: the individual checks behind `verify_run::check` (ADR-0047
//! WI-002). Each returns the one `GuardError` variant it owns. All of them
//! are read-only.
//!
//! @coordinates-with services/verify_run.rs — runs these in its fixed order

use super::{GuardError, PathVar, Var};
use std::ffi::CStr;
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

/// The only accepted mode, for the run dir and its parent.
const PRIVATE_DIR_MODE: u32 = 0o700;
/// Permission, setuid/setgid and sticky bits.
const MODE_BITS: u32 = 0o7777;
/// Starting `getpwuid_r` buffer; doubled on `ERANGE` up to the cap.
const PASSWD_BUF_START: usize = 4 * 1024;
const PASSWD_BUF_MAX: usize = 1024 * 1024;

fn name(var: Var) -> &'static str {
    match var {
        Var::Run => "MDPRO_VERIFY_RUN",
        Var::Nonce => "MDPRO_VERIFY_NONCE",
        Var::Home => "HOME",
        Var::CfHome => "CFFIXED_USER_HOME",
    }
}

/// The variable's value: set, non-empty and UTF-8.
pub(super) fn present(var: Var) -> Result<String, GuardError> {
    let raw = std::env::var_os(name(var)).ok_or(GuardError::VarUnset(var))?;
    if raw.is_empty() {
        return Err(GuardError::VarEmpty(var));
    }
    raw.into_string().map_err(|_| GuardError::VarNotUtf8(var))
}

/// The value as a path that is absolute and equal to its own canonical form.
pub(super) fn canonical(var: PathVar, value: &str) -> Result<PathBuf, GuardError> {
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err(GuardError::NotCanonical(var));
    }
    let canon = fs::canonicalize(path).map_err(|_| GuardError::PathMissing(var))?;
    if canon != path {
        return Err(GuardError::NotCanonical(var));
    }
    Ok(canon)
}

/// `run` (canonical) is a directory, a direct child of `canonicalize(parent)`,
/// and both are mode 0700 and owned by `uid`.
pub(super) fn run_dir_and_parent(run: &Path, parent: &Path, uid: u32) -> Result<(), GuardError> {
    let run_md = fs::symlink_metadata(run).map_err(|_| GuardError::PathMissing(PathVar::Run))?;
    if !run_md.is_dir() {
        return Err(GuardError::RunDirNotDir);
    }
    let parent = fs::canonicalize(parent).map_err(|_| GuardError::ParentUnresolvable)?;
    if run.parent() != Some(parent.as_path()) {
        return Err(GuardError::RunDirNotChildOfParent);
    }
    if run_md.mode() & MODE_BITS != PRIVATE_DIR_MODE {
        return Err(GuardError::RunDirMode);
    }
    if run_md.uid() != uid {
        return Err(GuardError::RunDirNotOwner);
    }
    let parent_md = fs::metadata(&parent).map_err(|_| GuardError::ParentUnresolvable)?;
    if parent_md.uid() != uid {
        return Err(GuardError::ParentNotOwner);
    }
    if parent_md.mode() & MODE_BITS != PRIVATE_DIR_MODE {
        return Err(GuardError::ParentMode);
    }
    Ok(())
}

/// `launch.json` is a regular file (not followed if a symlink) whose JSON
/// object has a string `nonce` equal to `expected`.
pub(super) fn launch_nonce(launch: &Path, expected: &str) -> Result<(), GuardError> {
    let md = fs::symlink_metadata(launch).map_err(|_| GuardError::LaunchJsonMissing)?;
    if !md.file_type().is_file() {
        return Err(GuardError::LaunchJsonNotRegular);
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(launch)
        .map_err(|_| GuardError::LaunchJsonMissing)?;
    let opened = file.metadata().map_err(|_| GuardError::LaunchJsonMissing)?;
    if !opened.file_type().is_file() {
        return Err(GuardError::LaunchJsonNotRegular);
    }
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|_| GuardError::LaunchJsonMalformed)?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| GuardError::LaunchJsonMalformed)?;
    let nonce = value
        .as_object()
        .and_then(|o| o.get("nonce"))
        .and_then(|n| n.as_str())
        .ok_or(GuardError::NonceMissing)?;
    if nonce != expected {
        return Err(GuardError::NonceMismatch);
    }
    Ok(())
}

/// Drive a `getpwuid_r` call (made by `call`) with a growing buffer and
/// return the entry's `pw_dir` bytes.
pub(super) fn passwd_home<F>(mut call: F) -> Result<Vec<u8>, GuardError>
where
    F: FnMut(&mut Vec<u8>, &mut libc::passwd, &mut *mut libc::passwd) -> libc::c_int,
{
    let mut buf = vec![0u8; PASSWD_BUF_START];
    loop {
        // SAFETY: an all-zero `passwd` is a valid out-parameter.
        let mut pwd: libc::passwd = unsafe { std::mem::zeroed() };
        let mut out: *mut libc::passwd = std::ptr::null_mut();
        let rc = call(&mut buf, &mut pwd, &mut out);
        if rc == libc::ERANGE && buf.len() < PASSWD_BUF_MAX {
            let grown = buf.len() * 2;
            buf.resize(grown, 0);
            continue;
        }
        if rc != 0 || out.is_null() || pwd.pw_dir.is_null() {
            return Err(GuardError::PasswdEntryMissing);
        }
        // SAFETY: `pw_dir` is a NUL-terminated string inside `buf`.
        return Ok(unsafe { CStr::from_ptr(pwd.pw_dir) }.to_bytes().to_vec());
    }
}
