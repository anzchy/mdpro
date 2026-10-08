//! ADR-0047 WI-002 / WI-5: `enforce` in a real process (matrix WI5-T14).
//! WI5-T16 (atomic visibility of `instance.json`) moved to
//! `verify_run_publish_law_tests.rs`; the `publish_or_exit` exec cases (WI-3)
//! live in `verify_run_publish_exec_tests.rs`. Feature-on only.
//!
//! T14 re-executes this test binary on one child test. The child is a no-op
//! unless `MDPRO_VR_SELF_EXEC_CHILD` is set; then it calls `enforce()`
//! with `MDPRO_VERIFY_RUN` unset, so the guard rejects at its first presence
//! check, before anything reads the passwd-home parent.
use super::verify_run_fixtures::{
    canonical_tmp, contains_named, lock_env, snapshot, CF_HOME, NONCE, RUN,
};
use super::{enforce, rejection_line, GuardError, Var};
use std::fs;
use std::process::Command;

const CHILD_MARKER: &str = "MDPRO_VR_SELF_EXEC_CHILD";

#[test]
fn wi5_t14_child_enforce_without_run_var() {
    if std::env::var_os(CHILD_MARKER).is_none() {
        return;
    }
    let _ = enforce();
    panic!("enforce returned");
}

#[test]
fn wi5_t14_enforce_none_exits_78_with_one_stderr_line() {
    let _env = lock_env();
    let t = canonical_tmp().join(format!("mdpro-vr-exec-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir(&t).expect("mkdir T");
    let before = snapshot(&t);
    let module = module_path!();
    let module = module.strip_prefix("tauri_app_lib::").unwrap_or(module);
    let child = format!("{module}::wi5_t14_child_enforce_without_run_var");

    let out = Command::new(std::env::current_exe().expect("current exe"))
        .args(["--exact", &child, "--nocapture", "--test-threads=1"])
        .env("HOME", &t)
        .env(CHILD_MARKER, "1")
        .env_remove(CF_HOME)
        .env_remove(RUN)
        .env_remove(NONCE)
        .output()
        .expect("spawn child");

    let after = snapshot(&t);
    let no_mdpro = !contains_named(&t, ".mdpro");
    let no_library = !contains_named(&t, "Library");
    let _ = fs::remove_dir_all(&t);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(78),
        "status {:?}; stderr {stderr:?}",
        out.status
    );
    let want = format!("{}\n", rejection_line(&GuardError::VarUnset(Var::Run)));
    assert_eq!(stderr, want);
    assert_eq!(after, before, "child wrote under T");
    assert!(no_mdpro && no_library, "child created .mdpro or Library");
}
