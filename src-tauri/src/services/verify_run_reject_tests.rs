//! ADR-0047 WI-002 / WI-5: rejections write nothing, the success log line is
//! private, rejection lines are private and distinct, and `enforce`'s inputs
//! do not follow `HOME` / `MDPRO_VERIFY_RUN` (matrix WI5-T07, T08, T09,
//! T15(a)). Feature-on only.
use super::verify_run_defects_fixtures::inject_random;
use super::verify_run_fixtures::{
    canonical_tmp, contains_named, lock_env, set_var, snapshot, Run, HOME, RUN,
};
use super::{guard_inputs, rejection_line, run, runs_parent, GuardError, PathVar, Var};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::MetadataExt;

#[test]
fn wi5_t07_guard_rejection_through_run_writes_nothing() {
    const SEED: u64 = 20261007;
    let mut rng = StdRng::seed_from_u64(SEED);
    for trial in 0..100 {
        let fx = Run::logged();
        let inj = inject_random(&fx, &mut rng);
        let before = fx.snapshot();

        let got = run(&inj.args.0, inj.args.1, None);

        let ctx = format!(
            "seed {SEED} trial {trial} defects {:?}: {got:?}",
            inj.labels
        );
        let err = got
            .as_ref()
            .err()
            .unwrap_or_else(|| panic!("accepted: {ctx}"));
        assert!(inj.allowed.contains(err), "misattributed: {ctx}");
        assert_eq!(fx.snapshot(), before, "tree changed: {ctx}");
        assert!(
            !contains_named(&fx.root, "instance.json"),
            "instance.json: {ctx}"
        );
        assert!(!contains_named(&fx.root, ".mdpro"), ".mdpro: {ctx}");
    }
}

#[test]
fn wi5_t08_one_private_log_line() {
    let fx = Run::logged();
    let (parent, uid) = fx.args();

    run(&parent, uid, None).expect("run");

    let text = fs::read_to_string(fx.run.join(".mdpro").join("mdpro.log")).expect("log file");
    let lines: Vec<Value> = text
        .lines()
        .map(|l| serde_json::from_str(l).expect("JSONL"))
        .filter(|v: &Value| v["event"] == "app.verify_run")
        .collect();
    assert_eq!(lines.len(), 1, "{text}");
    let line = &lines[0];
    assert_eq!(line["status"], "success");
    let ctx = line["context"].as_object().expect("context object");
    let keys: BTreeSet<&str> = ctx.keys().map(String::as_str).collect();
    assert_eq!(keys, BTreeSet::from(["runDir", "pid", "buildId"]));
    let base = fx
        .run
        .file_name()
        .expect("run name")
        .to_str()
        .expect("utf8");
    assert_eq!(ctx["runDir"], base);
    assert!(!base.contains('/'));
    assert_eq!(ctx["pid"], std::process::id());
    let canon = fs::canonicalize(&fx.run).expect("canonical run");
    for secret in [
        canon.to_str().expect("utf8"),
        parent.to_str().expect("utf8"),
        fx.nonce.as_str(),
    ] {
        assert!(!text.contains(secret), "log leaks a path or the nonce");
    }
}

/// Every variant once. `idx` has no `_` arm, so a new variant does not
/// compile until it is listed here.
const ALL: &[GuardError] = {
    use GuardError::*;
    &[
        VarUnset(Var::Run),
        VarUnset(Var::Nonce),
        VarUnset(Var::Home),
        VarUnset(Var::CfHome),
        VarEmpty(Var::Run),
        VarEmpty(Var::Nonce),
        VarEmpty(Var::Home),
        VarEmpty(Var::CfHome),
        VarNotUtf8(Var::Run),
        VarNotUtf8(Var::Nonce),
        VarNotUtf8(Var::Home),
        VarNotUtf8(Var::CfHome),
        NotCanonical(PathVar::Run),
        NotCanonical(PathVar::Home),
        NotCanonical(PathVar::CfHome),
        PathMissing(PathVar::Run),
        PathMissing(PathVar::Home),
        PathMissing(PathVar::CfHome),
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
    ]
};

fn idx(e: &GuardError) -> usize {
    use GuardError::*;
    let v = |v: &Var| match v {
        Var::Run => 0,
        Var::Nonce => 1,
        Var::Home => 2,
        Var::CfHome => 3,
    };
    let p = |p: &PathVar| match p {
        PathVar::Run => 0,
        PathVar::Home => 1,
        PathVar::CfHome => 2,
    };
    match e {
        VarUnset(x) => v(x),
        VarEmpty(x) => 4 + v(x),
        VarNotUtf8(x) => 8 + v(x),
        NotCanonical(x) => 12 + p(x),
        PathMissing(x) => 15 + p(x),
        ParentUnresolvable => 18,
        RunDirNotDir => 19,
        RunDirNotChildOfParent => 20,
        RunDirMode => 21,
        RunDirNotOwner => 22,
        ParentNotOwner => 23,
        ParentMode => 24,
        LaunchJsonMissing => 25,
        LaunchJsonNotRegular => 26,
        LaunchJsonMalformed => 27,
        NonceMissing => 28,
        NonceMismatch => 29,
        HomeOutsideRun => 30,
        DataDirOutsideRun => 31,
        CfHomeOutsideRun => 32,
        PasswdEntryMissing => 33,
        PasswdHomeNotUtf8 => 34,
        PasswdHomeNotAbsolute => 35,
        InstanceWrite => 36,
    }
}

#[test]
fn wi5_t09_rejection_lines_are_single_private_and_distinct() {
    const SEED: u64 = 20261008;
    let idxs: BTreeSet<usize> = ALL.iter().map(idx).collect();
    assert_eq!(idxs.len(), ALL.len(), "ALL has a duplicate");
    assert_eq!(idxs, (0..ALL.len()).collect(), "ALL misses a variant");

    let lines: Vec<String> = ALL.iter().map(rejection_line).collect();
    let distinct: BTreeSet<&String> = lines.iter().collect();
    assert_eq!(distinct.len(), lines.len(), "two variants share a line");

    let fx = Run::valid();
    let mut secrets = vec![
        fx.root.display().to_string(),
        fx.parent.display().to_string(),
        fx.run.display().to_string(),
        fx.nonce.clone(),
    ];
    // GuardError carries no strings, so random values cannot reach a line;
    // the rounds pin that a line never echoes path- or nonce-like input.
    let mut rng = StdRng::seed_from_u64(SEED);
    for _ in 0..60 {
        let seg: String = (0..12)
            .map(|_| rng.gen_range(b'a'..=b'z') as char)
            .collect();
        secrets.push(format!("/Users/{seg}/Library/{seg}"));
        secrets.push(format!("{seg}{:016x}", rng.gen::<u64>()));
    }
    for (e, line) in ALL.iter().zip(&lines) {
        assert!(!line.is_empty(), "{e:?}: empty line");
        assert!(
            !line.contains('\n') && !line.contains('\r'),
            "{e:?}: multi-line"
        );
        for s in &secrets {
            assert!(!line.contains(s.as_str()), "{e:?}: line echoes {s:?}");
        }
    }
}

#[test]
fn wi5_t15a_guard_inputs_do_not_follow_home_or_run() {
    let _env = lock_env();
    let root = canonical_tmp().join(format!("mdpro-vr-t15-{}", uuid::Uuid::new_v4().simple()));
    let (a, b) = (root.join("A"), root.join("B"));
    fs::create_dir_all(a.join("r")).expect("mkdir A/r");
    fs::create_dir_all(b.join("r")).expect("mkdir B/r");
    let probe = root.join("probe");
    fs::write(&probe, b"p").expect("probe file");
    let uid_t = fs::metadata(&probe).expect("probe").uid();
    let (snap_a, snap_b) = (snapshot(&a), snapshot(&b));

    set_var(HOME, &a);
    set_var(RUN, a.join("r"));
    let under_a = guard_inputs();
    set_var(HOME, &b);
    set_var(RUN, b.join("r"));
    let under_b = guard_inputs();

    let (snap_a2, snap_b2) = (snapshot(&a), snapshot(&b));
    let _ = fs::remove_dir_all(&root);
    let want = runs_parent(uid_t).map(|p| (p, uid_t));
    assert!(want.is_ok(), "{want:?}");
    assert_eq!(under_a, want);
    assert_eq!(under_b, want);
    let (p, _) = want.expect("checked");
    assert!(
        !p.starts_with(&a) && !p.starts_with(&b),
        "parent follows HOME"
    );
    assert_eq!(snap_a2, snap_a, "A changed");
    assert_eq!(snap_b2, snap_b, "B changed");
}
