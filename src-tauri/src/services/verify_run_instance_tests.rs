//! ADR-0047 WI-002 / WI-5: `verify_run::run` writes `instance.json`
//! atomically after a passing check (matrix WI5-T01..T06, T10). Every fixture
//! is `Run::logged()`: the logger is primed outside the tree, and the success
//! log line lands in `<run>/.mdpro/mdpro.log` because HOME = run.
//! Feature-on only.
use super::verify_run_fixtures::{chmod, fresh_nonce, set_var, snapshot, Run, NONCE};
use super::{run, GuardError, GUARD_EXIT_CODE};
use crate::services::build_info::normalize_build_id;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::Path;

const HEX: &[u8] = b"0123456789abcdef";

fn hex(rng: &mut StdRng, n: usize) -> String {
    (0..n).map(|_| HEX[rng.gen_range(0..16)] as char).collect()
}

fn instance(fx: &Run) -> Value {
    let text = fs::read_to_string(fx.run.join("instance.json")).expect("read instance.json");
    serde_json::from_str(&text).expect("instance.json is JSON")
}

fn keys(v: &Value) -> BTreeSet<String> {
    v.as_object().expect("object").keys().cloned().collect()
}

fn entries(dir: &Path) -> BTreeSet<String> {
    fs::read_dir(dir)
        .expect("read run dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect()
}

fn expected_entries() -> BTreeSet<String> {
    ["launch.json", "instance.json", ".mdpro"]
        .map(String::from)
        .into()
}

/// T01's postcondition: exact content, mode 0600, no leftovers.
fn assert_written(fx: &Run, nonce: &str, build_id: &str) {
    let v = instance(fx);
    let want: BTreeSet<String> = ["nonce", "pid", "buildId"].map(String::from).into();
    assert_eq!(keys(&v), want);
    assert_eq!(v["nonce"], nonce);
    assert_eq!(v["pid"], std::process::id());
    assert_eq!(v["buildId"], build_id);
    let md = fs::symlink_metadata(fx.run.join("instance.json")).expect("instance.json");
    assert!(
        md.file_type().is_file(),
        "instance.json is not a regular file"
    );
    assert_eq!(md.permissions().mode() & 0o777, 0o600);
    assert_eq!(entries(&fx.run), expected_entries());
}

#[test]
fn wi5_t01_pass_writes_instance_json() {
    let fx = Run::logged();
    let id = hex(&mut StdRng::seed_from_u64(1), 64);
    let (parent, uid) = fx.args();

    let got = run(&parent, uid, Some(&id));

    assert!(got.is_ok(), "{got:?}");
    assert_written(&fx, &fx.nonce, &id);
}

#[test]
fn wi5_t02_build_id_round_trips_through_normalize() {
    const SEED: u64 = 20261006;
    let mut rng = StdRng::seed_from_u64(SEED);
    let fx = Run::logged();
    let (parent, uid) = fx.args();
    for trial in 0..200 {
        let raw: Option<String> = match rng.gen_range(0..8) {
            0 => Some(hex(&mut rng, 64)),
            1 => Some(hex(&mut rng, 63)),
            2 => Some(hex(&mut rng, 65)),
            3 => Some(hex(&mut rng, 64).to_uppercase().replace('0', "A")),
            4 => {
                let mut s = hex(&mut rng, 64);
                let at = rng.gen_range(0..64);
                s.replace_range(at..=at, "g");
                Some(s)
            }
            5 => Some(format!("{}\n", hex(&mut rng, 64))),
            6 => Some(String::new()),
            _ => None,
        };
        let got = run(&parent, uid, raw.as_deref());
        assert!(
            got.is_ok(),
            "seed {SEED} trial {trial} raw {raw:?}: {got:?}"
        );
        let v = instance(&fx);
        let ctx = format!("seed {SEED} trial {trial} raw {raw:?}");
        assert_eq!(v["buildId"], normalize_build_id(raw.as_deref()), "{ctx}");
        assert_eq!(v["nonce"], fx.nonce.as_str(), "{ctx}");
        assert_eq!(v["pid"], std::process::id(), "{ctx}");
    }
}

#[test]
fn wi5_t03_second_run_replaces() {
    let fx = Run::logged();
    let (parent, uid) = fx.args();
    run(&parent, uid, None).expect("run 1");
    let n2 = fresh_nonce();
    fx.write_launch(&format!("{{\"nonce\":\"{n2}\"}}"));
    set_var(NONCE, &n2);

    run(&parent, uid, None).expect("run 2");

    assert_written(&fx, &n2, "unknown");
}

#[test]
fn wi5_t04_stale_instance_with_wrong_mode_is_replaced() {
    let fx = Run::logged();
    let stale = fx.run.join("instance.json");
    fs::write(&stale, b"junk junk junk").expect("write stale");
    chmod(&stale, 0o644);
    let (parent, uid) = fx.args();

    run(&parent, uid, None).expect("run");

    assert_written(&fx, &fx.nonce, "unknown");
}

#[test]
fn wi5_t05_symlinked_instance_is_not_followed() {
    let fx = Run::logged();
    let outside = fx.root.join("outside.json");
    fs::write(&outside, b"X").expect("write outside");
    symlink(&outside, fx.run.join("instance.json")).expect("symlink instance.json");
    let (parent, uid) = fx.args();

    run(&parent, uid, None).expect("run");

    assert_written(&fx, &fx.nonce, "unknown");
    assert_eq!(fs::read(&outside).expect("read outside"), b"X");
}

#[test]
fn wi5_t06_write_failure_is_instance_write_and_leaves_nothing() {
    let fx = Run::logged();
    let blocker = fx.run.join("instance.json");
    fs::create_dir(&blocker).expect("mkdir instance.json");
    fs::write(blocker.join("keep"), b"k").expect("write keep");
    let before = snapshot(&blocker);
    let (parent, uid) = fx.args();

    let got = run(&parent, uid, None);

    assert_eq!(got.err(), Some(GuardError::InstanceWrite));
    assert_eq!(snapshot(&blocker), before, "blocker dir changed");
    let want: BTreeSet<String> = ["launch.json", "instance.json"].map(String::from).into();
    assert_eq!(entries(&fx.run), want, "temp file or .mdpro left behind");
}

#[test]
fn wi5_t10_guard_exit_code_is_78() {
    assert_eq!(GUARD_EXIT_CODE, 78);
}
