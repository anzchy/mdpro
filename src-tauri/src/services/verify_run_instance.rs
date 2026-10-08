//! Purpose: the publication and message halves of the verify-run guard
//! (ADR-0047 WI-002): `publish`, which creates `<run dir>/instance.json`
//! exclusively and logs the one `app.verify_run` line, and the one-line
//! rejection text.
//!
//! Pipeline: `publish` → body to a fresh `.instance.json.<uuid>.tmp` in the
//! run dir (`create_new`, mode 0600, `write_all`, `sync_all`) → `hard_link`
//! the temp to `instance.json` → remove the temp on every outcome → one
//! `app.verify_run` line: `success {runDir, pid, buildId}` or
//! `fail {runDir, pid, reason}`.
//!
//! Key decisions:
//! - Publication is exclusive, never a replace: `link(2)` fails with EEXIST
//!   when anything already sits at `instance.json` (a file, a directory, a
//!   FIFO, or a symlink of any kind, which is never followed). That one
//!   error, `ErrorKind::AlreadyExists` on the link, is `InstanceExists`;
//!   every other failure is `InstanceWrite`. A second process on the same
//!   run dir is therefore refused and the first publication is left
//!   byte-identical.
//! - The temp lives in the run dir (same filesystem, so the link cannot be
//!   EXDEV) and is complete and synced before it is linked: a reader sees no
//!   file or a whole one, never a partial one.
//! - A failure to remove the temp after a successful link is not fatal: it
//!   logs a warn (`app.verify_run.temp_cleanup`) and returns Ok, because
//!   `instance.json` is already correct and failing would recreate the
//!   defect. Leftover temps are the doctor/clean tools' job (WI-003).
//! - Log lines name the run dir by basename only, never its path, its
//!   parent, or the nonce. Rejection lines name the check, never a value.
//!
//! @coordinates-with services/verify_run.rs — re-exports `publish` and
//!   `rejection_line`; `enforce` prints `rejection_line`, `publish_or_exit`
//!   calls `publish` and prints `rejection_line` on `Err`

use super::{GuardError, PathVar, Var, VerifiedRun};
use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::build_info::normalize_build_id;
use crate::services::logger;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{self, ErrorKind, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;

/// Mode of `instance.json`.
const INSTANCE_MODE: u32 = 0o600;

/// Publish `{nonce, pid, buildId}` (`buildId` normalized from `raw`) as
/// `<verified.run_dir>/instance.json`, exclusively. `Err(InstanceExists)`
/// when any entry already exists there (it is left untouched),
/// `Err(InstanceWrite)` on any other failure. The temp is removed on every
/// outcome; a failed removal after a successful link is logged and left for
/// the doctor/clean tools (WI-003).
/// Logs exactly one `app.verify_run` line, success or fail.
pub fn publish(verified: &VerifiedRun, pid: u32, raw: Option<&str>) -> Result<(), GuardError> {
    let run_dir = &verified.run_dir;
    let build_id = normalize_build_id(raw);
    let body = json!({ "nonce": verified.nonce, "pid": pid, "buildId": build_id }).to_string();
    let tmp = run_dir.join(format!(
        ".instance.json.{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let write_failed = |_: io::Error| (GuardError::InstanceWrite, "instance_write");
    let linked = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(INSTANCE_MODE)
            .open(&tmp)
            .map_err(write_failed)?;
        f.set_permissions(fs::Permissions::from_mode(INSTANCE_MODE))
            .map_err(write_failed)?;
        f.write_all(body.as_bytes()).map_err(write_failed)?;
        f.sync_all().map_err(write_failed)?;
        match fs::hard_link(&tmp, run_dir.join("instance.json")) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                Err((GuardError::InstanceExists, "instance_exists"))
            }
            Err(_) => Err((GuardError::InstanceWrite, "instance_write")),
        }
    })();
    let unlinked = fs::remove_file(&tmp);
    let base = basename(run_dir);
    if linked.is_ok() && unlinked.is_err() {
        log(
            LogLevel::Warn,
            "app.verify_run.temp_cleanup",
            LogStatus::Fail,
            json!({ "runDir": base, "pid": pid }),
        );
    }
    match linked {
        Ok(()) => {
            log(
                LogLevel::Info,
                "app.verify_run",
                LogStatus::Success,
                json!({ "runDir": base, "pid": pid, "buildId": build_id }),
            );
            Ok(())
        }
        Err((e, reason)) => {
            log(
                LogLevel::Error,
                "app.verify_run",
                LogStatus::Fail,
                json!({ "runDir": base, "pid": pid, "reason": reason }),
            );
            Err(e)
        }
    }
}

/// The last component of the run dir, the only form a log line may carry.
fn basename(run_dir: &Path) -> String {
    run_dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn log(level: LogLevel, event: &str, status: LogStatus, context: Value) {
    logger::log_event(LogEntryPayload {
        level,
        event: event.to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error: None,
    });
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

/// The one stderr line a refused launch prints before exiting.
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
        InstanceExists => "instance.json already exists".into(),
    };
    format!("mdpro verify-run guard: refusing to start: {reason}")
}
