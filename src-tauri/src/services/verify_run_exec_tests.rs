//! ADR-0047 WI-002 / WI-5: `enforce` in a real process, and atomic
//! visibility of `instance.json` (matrix WI5-T14, T16). Feature-on only.
//!
//! T14 re-executes this test binary on one child test. The child is a no-op
//! unless `MDPRO_VR_SELF_EXEC_CHILD` is set; then it calls `enforce(None)`
//! with `MDPRO_VERIFY_RUN` unset, so the guard rejects at its first presence
//! check, before anything reads the passwd-home parent.
use super::verify_run_fixtures::{
    canonical_tmp, contains_named, fresh_nonce, lock_env, set_var, snapshot, Run, CF_HOME, NONCE,
    RUN,
};
use super::{enforce, rejection_line, run, GuardError, Var};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::io::{ErrorKind, Read};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const CHILD_MARKER: &str = "MDPRO_VR_SELF_EXEC_CHILD";

#[test]
fn wi5_t14_child_enforce_without_run_var() {
    if std::env::var_os(CHILD_MARKER).is_none() {
        return;
    }
    enforce(None);
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

#[derive(Debug)]
enum Read1 {
    NotFound,
    Ok(Value),
    Bad(String),
}

#[test]
fn wi5_t16_instance_json_is_never_missing_or_partial() {
    const WRITES: usize = 300;
    let fx = Run::logged();
    let (parent, uid) = fx.args();
    let path = fx.run.join("instance.json");
    let stop = Arc::new(AtomicBool::new(false));
    let reader = {
        let (stop, path) = (Arc::clone(&stop), path.clone());
        std::thread::spawn(move || {
            let mut seen = Vec::new();
            while !stop.load(Ordering::Acquire) {
                let outcome = match fs::File::open(&path) {
                    Err(e) if e.kind() == ErrorKind::NotFound => Read1::NotFound,
                    Err(e) => Read1::Bad(format!("open: {e}")),
                    Ok(mut f) => {
                        let mut s = String::new();
                        match f.read_to_string(&mut s) {
                            Err(e) => Read1::Bad(format!("read: {e}")),
                            Ok(_) => match serde_json::from_str::<Value>(&s) {
                                Ok(v) => Read1::Ok(v),
                                Err(_) => Read1::Bad(format!("parse: {s:?}")),
                            },
                        }
                    }
                };
                seen.push(outcome);
            }
            seen
        })
    };

    let mut nonces = BTreeSet::new();
    let mut last = String::new();
    for i in 0..WRITES {
        let n = fresh_nonce();
        fx.write_launch(&format!("{{\"nonce\":\"{n}\"}}"));
        set_var(NONCE, &n);
        let got = run(&parent, uid, None);
        assert!(got.is_ok(), "write {i}: {got:?}");
        nonces.insert(n.clone());
        last = n;
    }
    stop.store(true, Ordering::Release);
    let seen = reader.join().expect("reader thread");

    let want_keys: BTreeSet<String> = ["nonce", "pid", "buildId"].map(String::from).into();
    let first_ok = seen.iter().position(|r| matches!(r, Read1::Ok(_)));
    let first_ok = first_ok.expect("reader never saw the file");
    for (i, r) in seen.iter().enumerate() {
        match r {
            Read1::NotFound if i < first_ok => {}
            Read1::Ok(v) => {
                let keys: BTreeSet<String> =
                    v.as_object().expect("object").keys().cloned().collect();
                assert_eq!(keys, want_keys, "read {i}");
                assert!(
                    nonces.contains(v["nonce"].as_str().expect("nonce")),
                    "read {i}"
                );
                assert_eq!(v["pid"], std::process::id(), "read {i}");
            }
            Read1::NotFound => panic!("read {i}: NotFound after the first success"),
            Read1::Bad(why) => panic!("read {i}: {why}"),
        }
    }
    let ok = seen.iter().filter(|r| matches!(r, Read1::Ok(_))).count();
    assert!(ok >= WRITES, "only {ok} successful reads");
    let final_v: Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("final")).expect("final JSON");
    assert_eq!(final_v["nonce"], last.as_str());
    let names: BTreeSet<String> = fs::read_dir(&fx.run)
        .expect("run dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    let want: BTreeSet<String> = ["launch.json", "instance.json", ".mdpro"]
        .map(String::from)
        .into();
    assert_eq!(names, want, "temp file left behind");
}
