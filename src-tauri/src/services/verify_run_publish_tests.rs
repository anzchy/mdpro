//! ADR-0047 WI-002 fix / WI-1: `publish` refuses an existing `instance.json`
//! of any kind and never writes through it, a pre-link failure is
//! `InstanceWrite`, and each refusal logs one private fail line (matrix
//! `tests-20261007-230837.md` WI5-T04, T05, T06a, T06b, and the fail-line and
//! rejection-text cases). Feature-on only.
use super::verify_run_fixtures::{chmod, snapshot, Run};
use super::verify_run_publish_fixtures::{
    base, entries, fingerprint, hex, log_text, names, verify_run_lines,
};
use super::{publish, rejection_line, GuardError};
use rand::rngs::StdRng;
use rand::SeedableRng;
use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::symlink;

#[test]
fn wi5_t04_stale_instance_is_refused_and_left_byte_identical() {
    let fx = Run::logged();
    let stale = fx.run.join("instance.json");
    fs::write(&stale, b"junk junk junk").expect("write stale");
    chmod(&stale, 0o644);
    let f0 = fingerprint(&stale);

    let got = publish(&fx.check().expect("check"), 4242, None);

    assert_eq!(got, Err(GuardError::InstanceExists));
    assert_eq!(fingerprint(&stale), f0);
    assert_eq!(f0.bytes.as_deref(), Some(&b"junk junk junk"[..]));
    assert_eq!(f0.mode & 0o777, 0o644);
    assert_eq!(
        entries(&fx.run),
        names(&["launch.json", "instance.json", ".mdpro"])
    );
}

#[test]
fn wi5_t05_symlinked_instance_is_refused_not_followed() {
    for kind in ["inside", "outside", "dangling"] {
        let fx = Run::logged();
        let (target, body): (_, Option<&[u8]>) = match kind {
            "inside" => (fx.run.join("inside.json"), Some(b"I")),
            "outside" => (fx.root.join("outside.json"), Some(b"X")),
            _ => (fx.root.join("nowhere.json"), None),
        };
        if let Some(b) = body {
            fs::write(&target, b).expect("write target");
        }
        let link = fx.run.join("instance.json");
        symlink(&target, &link).expect("symlink instance.json");
        let fl = fingerprint(&link);
        let ft = body.map(|_| fingerprint(&target));

        let got = publish(&fx.check().expect("check"), 4242, None);

        assert_eq!(got, Err(GuardError::InstanceExists), "{kind}");
        assert_eq!(fingerprint(&link), fl, "{kind}: link changed");
        assert_eq!(fl.link.as_deref(), Some(target.as_path()), "{kind}");
        match (body, ft) {
            (Some(b), Some(ft)) => {
                assert_eq!(fingerprint(&target), ft, "{kind}: target changed");
                assert_eq!(fs::read(&target).expect("target"), b, "{kind}");
            }
            _ => assert!(!target.exists(), "{kind}: dangling target created"),
        }
        let mut want = names(&["launch.json", "instance.json", ".mdpro"]);
        if kind == "inside" {
            want.insert("inside.json".into());
        }
        assert_eq!(entries(&fx.run), want, "{kind}: temp left behind");
    }
}

#[test]
fn wi5_t06a_dir_instance_is_instance_exists() {
    let fx = Run::logged();
    let blocker = fx.run.join("instance.json");
    fs::create_dir(&blocker).expect("mkdir instance.json");
    fs::write(blocker.join("keep"), b"k").expect("write keep");
    let before = snapshot(&blocker);

    let got = publish(&fx.check().expect("check"), 4242, None);

    assert_eq!(got, Err(GuardError::InstanceExists));
    assert_eq!(snapshot(&blocker), before, "blocker dir changed");
    assert_eq!(
        entries(&fx.run),
        names(&["launch.json", "instance.json", ".mdpro"])
    );
}

#[test]
fn wi5_t06b_unwritable_run_dir_is_instance_write() {
    // SAFETY: geteuid has no preconditions and cannot fail.
    if unsafe { libc::geteuid() } == 0 {
        println!("SKIPPED: t06b: running as root");
        return;
    }
    let fx = Run::logged();
    let v = fx.check().expect("check");
    fx.mkdir(&fx.run.join(".mdpro"));
    chmod(&fx.run, 0o500);

    let got = publish(&v, 4242, None);

    let after = entries(&fx.run);
    chmod(&fx.run, 0o700);
    assert_eq!(got, Err(GuardError::InstanceWrite));
    assert_eq!(after, names(&["launch.json", ".mdpro"]));
    let lines = verify_run_lines(&fx);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(lines[0]["status"], "fail");
    assert_eq!(lines[0]["context"]["reason"], "instance_write");
}

#[test]
fn wi1_publish_refusal_logs_one_fail_line() {
    let fx = Run::logged();
    fs::write(fx.run.join("instance.json"), b"junk").expect("seed junk");
    let id = hex(&mut StdRng::seed_from_u64(2), 64);

    let got = publish(&fx.check().expect("check"), 4242, Some(&id));

    assert_eq!(got, Err(GuardError::InstanceExists));
    let lines = verify_run_lines(&fx);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(lines[0]["status"], "fail");
    let ctx = lines[0]["context"].as_object().expect("context object");
    let got_keys: BTreeSet<&str> = ctx.keys().map(String::as_str).collect();
    assert_eq!(got_keys, BTreeSet::from(["runDir", "pid", "reason"]));
    assert_eq!(ctx["runDir"], base(&fx).as_str());
    assert!(!base(&fx).contains('/'));
    assert_eq!(ctx["pid"], 4242);
    assert_eq!(ctx["reason"], "instance_exists");
    let success = lines.iter().filter(|l| l["status"] == "success").count();
    assert_eq!(success, 0);
    let text = log_text(&fx);
    let canon = fs::canonicalize(&fx.run).expect("canonical run");
    for secret in [
        canon.to_str().expect("utf8"),
        fx.parent.to_str().expect("utf8"),
        fx.nonce.as_str(),
    ] {
        assert!(!text.contains(secret), "log leaks a path or the nonce");
    }
}

#[test]
fn wi1_instance_exists_rejection_line_text() {
    let line = rejection_line(&GuardError::InstanceExists);
    assert_eq!(
        line,
        "mdpro verify-run guard: refusing to start: instance.json already exists"
    );
    assert_ne!(line, rejection_line(&GuardError::InstanceWrite));
}
