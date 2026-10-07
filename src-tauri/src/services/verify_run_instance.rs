//! Purpose: the write and message halves of the verify-run guard (ADR-0047
//! WI-002): `instance.json`, written atomically into the run dir, and the
//! one-line rejection text.
//!
//! Key decisions:
//! - `instance.json` is written to a fresh temp file in the run dir itself
//!   (same filesystem), mode 0600, `sync_all`, then renamed over the target.
//!   A reader sees either no file or a complete one; a pre-existing symlink
//!   or stale file is replaced, never written through.
//! - Rejection lines name the check and the variable, never a value.
//!
//! @coordinates-with services/verify_run.rs — `run` and `enforce` call these

use super::{GuardError, PathVar, Var};
use serde_json::json;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

/// Mode of `instance.json`.
const INSTANCE_MODE: u32 = 0o600;

/// Write `{nonce, pid, buildId}` to `<run_dir>/instance.json` atomically.
pub(super) fn write_instance(
    run_dir: &Path,
    nonce: &str,
    pid: u32,
    build_id: &str,
) -> Result<(), GuardError> {
    let body = json!({ "nonce": nonce, "pid": pid, "buildId": build_id }).to_string();
    let tmp = run_dir.join(format!(
        ".instance.json.{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let written = (|| -> std::io::Result<()> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(INSTANCE_MODE)
            .open(&tmp)?;
        f.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(INSTANCE_MODE))?;
        f.write_all(body.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, run_dir.join("instance.json"))
    })();
    written.map_err(|_| {
        let _ = fs::remove_file(&tmp);
        GuardError::InstanceWrite
    })
}

fn var_name(v: Var) -> &'static str {
    match v {
        Var::Run => "MDPRO_VERIFY_RUN",
        Var::Nonce => "MDPRO_VERIFY_NONCE",
        Var::Home => "HOME",
        Var::CfHome => "CFFIXED_USER_HOME",
    }
}

fn path_var_name(v: PathVar) -> &'static str {
    match v {
        PathVar::Run => "MDPRO_VERIFY_RUN",
        PathVar::Home => "HOME",
        PathVar::CfHome => "CFFIXED_USER_HOME",
    }
}

/// The one stderr line `enforce` prints before exiting.
pub fn rejection_line(e: &GuardError) -> String {
    use GuardError::*;
    let reason = match e {
        VarUnset(v) => format!("{} is not set", var_name(*v)),
        VarEmpty(v) => format!("{} is empty", var_name(*v)),
        VarNotUtf8(v) => format!("{} is not UTF-8", var_name(*v)),
        NotCanonical(v) => format!("{} is not a canonical absolute path", path_var_name(*v)),
        PathMissing(v) => format!("{} names a path that does not exist", path_var_name(*v)),
        ParentUnresolvable => "the runs parent cannot be resolved".into(),
        RunDirNotDir => "the run dir is not a directory".into(),
        RunDirNotChildOfParent => "the run dir is not a direct child of the runs parent".into(),
        RunDirMode => "the run dir mode is not 0700".into(),
        RunDirNotOwner => "the run dir is not owned by this user".into(),
        ParentNotOwner => "the runs parent is not owned by this user".into(),
        ParentMode => "the runs parent mode is not 0700".into(),
        LaunchJsonMissing => "launch.json is missing".into(),
        LaunchJsonNotRegular => "launch.json is not a regular file".into(),
        LaunchJsonMalformed => "launch.json is not valid JSON".into(),
        NonceMissing => "launch.json has no string nonce".into(),
        NonceMismatch => "the launch.json nonce does not match MDPRO_VERIFY_NONCE".into(),
        HomeOutsideRun => "the home dir is outside the run dir".into(),
        DataDirOutsideRun => "the data dir is outside the run dir".into(),
        CfHomeOutsideRun => "CFFIXED_USER_HOME is outside the run dir".into(),
        PasswdEntryMissing => "this user has no passwd entry".into(),
        PasswdHomeNotUtf8 => "the passwd home is not UTF-8".into(),
        PasswdHomeNotAbsolute => "the passwd home is not absolute".into(),
        InstanceWrite => "instance.json could not be written".into(),
    };
    format!("mdpro verify-run guard: refusing to start: {reason}")
}
