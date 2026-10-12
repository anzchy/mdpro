//! ADR-0047 WI-002 fix / WI-3: `publish_or_exit` in a real process (matrix
//! `tests-20261007-230837.md`, WI-3 plus the round-1 and round-2 addenda).
//! Feature-on only.
//!
//! Each parent case re-executes this test binary on the one child test,
//! `wi3_child_publish_or_exit`, which is a no-op unless
//! `MDPRO_VR_SELF_EXEC_CHILD` names a mode:
//! - `publish`: logging ON; publish, then print the returned sentinel.
//! - `publish-refuse`: logging off; publish (expected to exit 78).
//! - `publish-efbig`: logging off; `RLIMIT_FSIZE` = 8 bytes and `SIGXFSZ`
//!   ignored, so `write_all` on the temp fails with EFBIG; publish.
//! - `efbig-probe`: the same limit, then a 64-byte write to `probe.bin`;
//!   prints `PROBE <errno>`. It proves the EFBIG mechanism is alive.
//!
//! Logging is off in every mode but `publish`, because a debug build echoes
//! each log line to stderr and the refusal cases compare stderr exactly. The
//! child primes the logger's settings cache under a throwaway HOME outside
//! the run dir first, so `load_preferences()` never writes into the run dir.
use super::verify_run_fixtures::{Run, CF_HOME, HOME, NONCE, RUN};
use super::verify_run_publish_fixtures::{
    assert_published, entries, fingerprint, hex, names, verify_run_lines,
};
use super::{publish_or_exit, rejection_line, GuardError, VerifiedRun};
use crate::models::{LogLevel, LogSettings};
use crate::services::build_info::normalize_build_id;
use crate::services::logger::set_log_settings;
use rand::SeedableRng;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

const CHILD_MARKER: &str = "MDPRO_VR_SELF_EXEC_CHILD";
const PRIME_HOME: &str = "MDPRO_VR_CHILD_PRIME_HOME";
const CHILD_BUILD_ID: &str = "MDPRO_VR_CHILD_BUILD_ID";
const RETURNED: &str = "MDPRO_VR_CHILD_RETURNED";
/// The file-size limit of the EFBIG modes, far below any `instance.json` body.
const FSIZE_LIMIT: u64 = 8;

/// Prime the logger's settings cache under `PRIME_HOME`, then point HOME back.
fn prime_logging(enabled: bool) {
    let home = std::env::var_os(HOME).expect("child HOME");
    std::env::set_var(HOME, std::env::var_os(PRIME_HOME).expect("prime home"));
    set_log_settings(LogSettings {
        enabled,
        level: LogLevel::Info,
    });
    std::env::set_var(HOME, home);
}

/// Ignore `SIGXFSZ` and cap regular-file size at `FSIZE_LIMIT` bytes.
fn limit_file_size() {
    // SAFETY: installing SIG_IGN for SIGXFSZ has no preconditions.
    let prev = unsafe { libc::signal(libc::SIGXFSZ, libc::SIG_IGN) };
    assert_ne!(prev, libc::SIG_ERR, "signal(SIGXFSZ, SIG_IGN) failed");
    // SAFETY: an all-zero rlimit is a valid out-parameter.
    let mut lim: libc::rlimit = unsafe { std::mem::zeroed() };
    // SAFETY: `lim` is valid for the call.
    assert_eq!(unsafe { libc::getrlimit(libc::RLIMIT_FSIZE, &mut lim) }, 0);
    lim.rlim_cur = FSIZE_LIMIT;
    // SAFETY: `lim` is valid for the call; the hard limit is unchanged.
    assert_eq!(unsafe { libc::setrlimit(libc::RLIMIT_FSIZE, &lim) }, 0);
}

#[test]
fn wi3_child_publish_or_exit() {
    let Some(mode) = std::env::var_os(CHILD_MARKER) else {
        return;
    };
    let mode = mode.to_string_lossy().into_owned();
    prime_logging(mode == "publish");
    let run = PathBuf::from(std::env::var_os(RUN).expect("child RUN"));
    match mode.as_str() {
        "publish" | "publish-refuse" => {}
        "publish-efbig" => limit_file_size(),
        "efbig-probe" => {
            limit_file_size();
            let probe = run.join("probe.bin");
            let mut f = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&probe)
                .expect("create probe.bin");
            let errno = match f.write_all(&[0u8; 64]) {
                Ok(()) => "ok".to_string(),
                Err(e) => e.raw_os_error().map_or("none".into(), |n| n.to_string()),
            };
            println!("PROBE {errno}");
            fs::remove_file(&probe).expect("remove probe.bin");
            return;
        }
        other => panic!("unknown child mode {other:?}"),
    }
    let v = VerifiedRun {
        run_dir: run,
        nonce: std::env::var(NONCE).expect("child NONCE"),
    };
    let raw = std::env::var(CHILD_BUILD_ID).ok();
    publish_or_exit(&v, raw.as_deref());
    println!("{RETURNED} {}", std::process::id());
}

/// Spawn the child in `mode` with `RUN = run`, `HOME = CFFIXED_USER_HOME =
/// fx.run`; returns the child's pid and its output.
fn spawn(fx: &Run, mode: &str, run: &Path, build_id: Option<&str>) -> (u32, Output) {
    let prime = fx.mkdir(&fx.root.join("child-prime"));
    let module = module_path!();
    let module = module.strip_prefix("tauri_app_lib::").unwrap_or(module);
    let test = format!("{module}::wi3_child_publish_or_exit");
    let mut cmd = Command::new(std::env::current_exe().expect("current exe"));
    cmd.args(["--exact", &test, "--nocapture", "--test-threads=1"])
        .env(HOME, &fx.run)
        .env(CF_HOME, &fx.run)
        .env(RUN, run)
        .env(NONCE, &fx.nonce)
        .env(PRIME_HOME, &prime)
        .env(CHILD_MARKER, mode)
        .env_remove(CHILD_BUILD_ID)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(id) = build_id {
        cmd.env(CHILD_BUILD_ID, id);
    }
    let child = cmd.spawn().expect("spawn child");
    let pid = child.id();
    (pid, child.wait_with_output().expect("wait child"))
}

fn text(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

#[test]
fn wi3_publish_or_exit_refuses_existing_instance_exits_78() {
    let fx = Run::logged();
    let inst = fx.run.join("instance.json");
    fs::write(&inst, br#"{"nonce":"old","pid":1}"#).expect("seed instance.json");
    fs::set_permissions(&inst, fs::Permissions::from_mode(0o644)).expect("chmod");
    let f0 = fingerprint(&inst);

    let (_, out) = spawn(&fx, "publish-refuse", &fx.run, None);
    let stderr = text(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(78),
        "status {:?}; stderr {stderr:?}",
        out.status
    );
    assert_eq!(
        stderr,
        format!("{}\n", rejection_line(&GuardError::InstanceExists))
    );
    assert_eq!(fingerprint(&inst), f0, "instance.json changed");
    assert_eq!(entries(&fx.run), names(&["launch.json", "instance.json"]));
}

#[test]
fn wi3_publish_or_exit_publishes_child_pid() {
    let fx = Run::logged();
    let id = hex(&mut rand::rngs::StdRng::seed_from_u64(2), 64);

    let (pid, out) = spawn(&fx, "publish", &fx.run, Some(&id));
    let stdout = text(&out.stdout);
    let stderr = text(&out.stderr);
    let ctx = format!(
        "status {:?}; stdout {stdout:?}; stderr {stderr:?}",
        out.status
    );
    assert_eq!(out.status.code(), Some(0), "{ctx}");
    assert!(
        stdout.contains(&format!("{RETURNED} {pid}")),
        "no sentinel: {ctx}"
    );
    assert!(
        stdout.contains("test result: ok. 1 passed"),
        "no summary: {ctx}"
    );
    assert!(!stderr.contains("refusing"), "{ctx}");
    assert_ne!(pid, std::process::id());
    let build_id = normalize_build_id(Some(&id));
    assert_published(&fx.run.join("instance.json"), &fx.nonce, pid, build_id);
    assert_eq!(
        entries(&fx.run),
        names(&["launch.json", "instance.json", ".mdpro"])
    );

    let lines = verify_run_lines(&fx);
    assert_eq!(lines.len(), 1, "app.verify_run lines: {lines:?}");
    let line = &lines[0];
    assert_eq!(line["status"], "success", "{line}");
    assert_eq!(line["level"], "info", "{line}");
    let base = fx.run.file_name().expect("name").to_str().expect("utf8");
    assert_eq!(line["context"]["runDir"], base, "{line}");
    assert_eq!(line["context"]["pid"], pid, "{line}");
    assert_eq!(line["context"]["buildId"], build_id, "{line}");
}

#[test]
fn wi3_publish_or_exit_write_failure_exits_78() {
    let fx = Run::logged();
    let gone = fx.run.join("gone");

    let (_, out) = spawn(&fx, "publish-refuse", &gone, None);
    let stderr = text(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(78),
        "status {:?}; stderr {stderr:?}",
        out.status
    );
    assert_eq!(
        stderr,
        format!("{}\n", rejection_line(&GuardError::InstanceWrite))
    );
    assert!(!gone.exists(), "publish created the vanished run dir");
    assert_eq!(entries(&fx.run), names(&["launch.json"]));
}

#[test]
fn wi3_publish_or_exit_write_failure_after_temp_exits_78() {
    let fx = Run::logged();

    // Precondition: the EFBIG mechanism is alive. A dead mechanism panics,
    // never skips, so it cannot read as a pass.
    let (_, probe) = spawn(&fx, "efbig-probe", &fx.run, None);
    let probe_out = text(&probe.stdout);
    // libtest prints `test <name> ... ` first, so the line is shared: match
    // the `PROBE <errno>` token pair, not the whole line.
    let want = format!("PROBE {}", libc::EFBIG);
    let efbig = libc::EFBIG.to_string();
    let probed = probe_out.lines().any(|l| {
        let words: Vec<&str> = l.split_whitespace().collect();
        words.windows(2).any(|w| w[0] == "PROBE" && w[1] == efbig)
    });
    assert!(
        probe.status.success() && probed,
        "EFBIG mechanism is dead: want {want:?}; status {:?}; stdout {probe_out:?}; stderr {:?}",
        probe.status,
        text(&probe.stderr)
    );

    let (_, out) = spawn(&fx, "publish-efbig", &fx.run, None);
    let stderr = text(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(78),
        "status {:?}; stdout {:?}; stderr {stderr:?}",
        out.status,
        text(&out.stdout)
    );
    assert_eq!(
        stderr,
        format!("{}\n", rejection_line(&GuardError::InstanceWrite))
    );
    assert_eq!(entries(&fx.run), names(&["launch.json"]));
}
