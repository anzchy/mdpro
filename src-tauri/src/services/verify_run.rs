//! Purpose: the verify-run launch guard (ADR-0047 WI-002). A verify build
//! (`--features verify-run`) refuses to start unless it was launched into a
//! prepared, private run dir, so an agent's verification run can never read
//! or write the user's real home, data dir or preferences. Compiled only with
//! the `verify-run` Cargo feature; a feature-off build has no guard code.
//!
//! Pipeline: `main()` calls `enforce(raw build id)` as its first statement →
//! `guard_inputs()` = `(runs_parent(getuid()), getuid())` (passwd home, pure
//! path computation) → `run(parent, uid, raw)` = `check` (read-only
//! validation of the environment and the run dir) → atomic `instance.json`
//! → one `app.verify_run` log line. Any `Err` → one stderr line + exit 78.
//!
//! Key decisions:
//! - The parent is `<passwd home>/Library/Application Support/mdpro-verify/runs`,
//!   read from passwd (`getpwuid_r`), never from `$HOME`, which the launcher
//!   points into the run dir.
//! - `check` is read-only and deterministic. Presence checks visit the four
//!   variables in the order `Run` → `Nonce` → `Home` → `CfHome`, all before
//!   any canonicalization, any `dirs::` call and any use of `parent`.
//! - `GuardError` carries no strings: a rejection never echoes a path or the
//!   nonce. Logs and outputs name the run dir by basename only.
//! - Rule 60 exception: `enforce` writes its rejection with
//!   `writeln!(std::io::stderr(), …)`, not the logger. The guard runs before
//!   anything may touch `$HOME`, and the logger would create `~/.mdpro`; the
//!   launcher reads exactly one stderr line and exit code 78.
//! - The success log line is written only after `instance.json` is in place,
//!   so a failed write leaves no `.mdpro` in the run dir.
//!
//! @coordinates-with services/verify_run_checks.rs — the individual checks
//! @coordinates-with services/verify_run_instance.rs — `instance.json` and
//!   the rejection text
//! @coordinates-with main.rs — calls `enforce` first, behind the feature

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::{build_info, logger};
use serde_json::json;
use std::ffi::OsStr;
use std::io::Write;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

#[path = "verify_run_checks.rs"]
mod checks;
#[path = "verify_run_instance.rs"]
mod instance;

pub use instance::rejection_line;

/// Exit status of a rejected launch (`EX_CONFIG`); the WI-003 launcher
/// treats it as "the guard refused".
pub const GUARD_EXIT_CODE: i32 = 78;

/// A guard environment variable, in presence-check order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Var {
    /// `MDPRO_VERIFY_RUN`
    Run,
    /// `MDPRO_VERIFY_NONCE`
    Nonce,
    /// `HOME`
    Home,
    /// `CFFIXED_USER_HOME`
    CfHome,
}

/// A guard variable that names a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathVar {
    Run,
    Home,
    CfHome,
}

/// Why the guard refused to start. One variant per check; no payload strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GuardError {
    VarUnset(Var),
    VarEmpty(Var),
    VarNotUtf8(Var),
    NotCanonical(PathVar),
    PathMissing(PathVar),
    ParentUnresolvable,
    RunDirNotDir,
    RunDirNotChildOfParent,
    RunDirMode,
    RunDirNotOwner,
    ParentNotOwner,
    ParentMode,
    LaunchJsonMissing,
    LaunchJsonNotRegular,
    LaunchJsonMalformed,
    NonceMissing,
    NonceMismatch,
    HomeOutsideRun,
    DataDirOutsideRun,
    CfHomeOutsideRun,
    PasswdEntryMissing,
    PasswdHomeNotUtf8,
    PasswdHomeNotAbsolute,
    InstanceWrite,
}

/// A run dir that passed every check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedRun {
    /// Canonical path of the run dir.
    pub run_dir: PathBuf,
    /// The nonce `launch.json` and `MDPRO_VERIFY_NONCE` agree on.
    pub nonce: String,
}

/// `<home>/Library/Application Support/mdpro-verify/runs`.
pub fn runs_parent_in(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Application Support")
        .join("mdpro-verify")
        .join("runs")
}

/// The runs parent of `uid`, from its passwd home. Pure path computation:
/// touches no file and reads no environment variable.
pub fn runs_parent(uid: u32) -> Result<PathBuf, GuardError> {
    let raw = checks::passwd_home(|buf, pwd, out| {
        // SAFETY: the pointers are valid for the call and `buf` outlives `pwd`.
        unsafe { libc::getpwuid_r(uid, pwd, buf.as_mut_ptr().cast(), buf.len(), out) }
    })?;
    std::str::from_utf8(&raw).map_err(|_| GuardError::PasswdHomeNotUtf8)?;
    let home = Path::new(OsStr::from_bytes(&raw));
    if !home.is_absolute() {
        return Err(GuardError::PasswdHomeNotAbsolute);
    }
    Ok(runs_parent_in(home))
}

/// Validate the environment and the run dir against `parent`, owned by `uid`.
/// Read-only: writes nothing, creates nothing.
pub fn check(parent: &Path, uid: u32) -> Result<VerifiedRun, GuardError> {
    let run = checks::present(Var::Run)?;
    let nonce = checks::present(Var::Nonce)?;
    let home = checks::present(Var::Home)?;
    let cf_home = checks::present(Var::CfHome)?;

    let run = checks::canonical(PathVar::Run, &run)?;
    checks::canonical(PathVar::Home, &home)?;
    let cf_home = checks::canonical(PathVar::CfHome, &cf_home)?;

    checks::run_dir_and_parent(&run, parent, uid)?;
    checks::launch_nonce(&run.join("launch.json"), &nonce)?;

    if !dirs::home_dir().is_some_and(|h| h.starts_with(&run)) {
        return Err(GuardError::HomeOutsideRun);
    }
    if !dirs::data_dir().is_some_and(|d| d.starts_with(&run)) {
        return Err(GuardError::DataDirOutsideRun);
    }
    if !cf_home.starts_with(&run) {
        return Err(GuardError::CfHomeOutsideRun);
    }
    Ok(VerifiedRun {
        run_dir: run,
        nonce,
    })
}

/// `check`, then write `instance.json` (`buildId` normalized from `raw`),
/// then log one `app.verify_run` line naming the run dir by basename.
pub fn run(parent: &Path, uid: u32, raw: Option<&str>) -> Result<VerifiedRun, GuardError> {
    let verified = check(parent, uid)?;
    let pid = std::process::id();
    let build_id = build_info::normalize_build_id(raw);
    instance::write_instance(&verified.run_dir, &verified.nonce, pid, build_id)?;
    let base = verified
        .run_dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    logger::log_event(LogEntryPayload {
        level: LogLevel::Info,
        event: "app.verify_run".to_string(),
        status: LogStatus::Success,
        action_id: None,
        context: Some(json!({ "runDir": base, "pid": pid, "buildId": build_id })),
        duration_ms: None,
        error: None,
    });
    Ok(verified)
}

/// The guard's injected inputs: the passwd-home runs parent and this uid.
pub fn guard_inputs() -> Result<(PathBuf, u32), GuardError> {
    // SAFETY: getuid has no preconditions and cannot fail.
    let uid = unsafe { libc::getuid() };
    Ok((runs_parent(uid)?, uid))
}

/// Refuse to start unless this is a prepared verify run: on any rejection,
/// print one stderr line and exit with `GUARD_EXIT_CODE`.
pub fn enforce(raw: Option<&str>) {
    let outcome = guard_inputs().and_then(|(parent, uid)| run(&parent, uid, raw));
    if let Err(e) = outcome {
        let _ = writeln!(std::io::stderr(), "{}", rejection_line(&e));
        std::process::exit(GUARD_EXIT_CODE);
    }
}

#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_defects_fixtures.rs"]
mod verify_run_defects_fixtures;
#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_exec_tests.rs"]
mod verify_run_exec_tests;
#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_fixtures.rs"]
mod verify_run_fixtures;
#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_guard_tests.rs"]
mod verify_run_guard_tests;
#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_instance_tests.rs"]
mod verify_run_instance_tests;
#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_launch_rows_fixtures.rs"]
mod verify_run_launch_rows_fixtures;
#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_law_tests.rs"]
mod verify_run_law_tests;
#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_mode_tests.rs"]
mod verify_run_mode_tests;
#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_parent_tests.rs"]
mod verify_run_parent_tests;
#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_reject_tests.rs"]
mod verify_run_reject_tests;
#[cfg(all(test, feature = "verify-run"))]
#[path = "verify_run_rows_fixtures.rs"]
mod verify_run_rows_fixtures;
