//! ADR-0047 WI-002 / WI-4: the guard's laws (matrix WI4-T15, T16, T20, T21).
//! Acceptance is the conjunction of every check: removing one satisfied
//! condition flips to the named rejection (T15); any non-empty defect set is
//! rejected, attributed to one of its defects, with no filesystem side effect
//! (T16); `check` is read-only and so idempotent (T20). Feature-on only.
use super::verify_run_defects_fixtures::inject_random;
use super::verify_run_fixtures::{canonical_tmp, contains_named, snapshot, Run};
use super::verify_run_launch_rows_fixtures::{all_rows, rows_t12};
use super::verify_run_rows_fixtures::{assert_rows, Row};
use super::{check, VerifiedRun};
use rand::rngs::StdRng;
use rand::SeedableRng;
use std::fs;
use std::os::unix::fs::symlink;

#[test]
fn wi4_t15_single_defect_metamorphic_table() {
    let mut rows = vec![Row {
        name: "control (no defect)".to_string(),
        apply: Box::new(|fx| fx.args()),
        expect: None,
    }];
    rows.extend(all_rows());
    println!("T15: control + {} single-defect rows", rows.len() - 1);
    assert_rows(&rows);
}

#[test]
fn wi4_t16_random_defect_subsets_always_rejected_by_an_injected_check() {
    const SEED: u64 = 20261004;
    let mut rng = StdRng::seed_from_u64(SEED);
    for trial in 0..300 {
        let fx = Run::valid();
        let inj = inject_random(&fx, &mut rng);
        let before = fx.snapshot();

        let got = check(&inj.args.0, inj.args.1);

        let ctx = format!(
            "seed {SEED} trial {trial} defects {:?}: {got:?}",
            inj.labels
        );
        let err = got
            .as_ref()
            .err()
            .unwrap_or_else(|| panic!("accepted: {ctx}"));
        assert!(inj.allowed.contains(err), "misattributed: {ctx}");
        assert_eq!(snapshot(&fx.root), before, "tree changed: {ctx}");
        assert!(!contains_named(&fx.root, ".mdpro"), ".mdpro created: {ctx}");
        assert!(
            !contains_named(&fx.root, "Library"),
            "Library created: {ctx}"
        );
    }
}

#[test]
fn wi4_t20_check_is_deterministic_and_read_only() {
    let fx = Run::valid();
    let before = fx.snapshot();
    let (a, b) = (fx.check(), fx.check());
    assert!(a.is_ok(), "{a:?}");
    assert_eq!(a, b);
    assert_eq!(fx.snapshot(), before);
    drop(fx);

    let rows = rows_t12();
    let fx = Run::valid();
    let (parent, uid) = (rows[0].apply)(&fx);
    let before = fx.snapshot();
    let (a, b) = (check(&parent, uid), check(&parent, uid));
    assert_eq!(a.as_ref().err(), rows[0].expect.as_ref());
    assert_eq!(a, b);
    assert_eq!(fx.snapshot(), before);
}

#[test]
fn wi4_t21_non_canonical_parent_spelling_still_accepts_a_valid_child() {
    let fx = Run::valid();
    let want = Ok(VerifiedRun {
        run_dir: fs::canonicalize(&fx.run).expect("canonical run"),
        nonce: fx.nonce.clone(),
    });

    let link = fx.root.join("runs-link");
    symlink(&fx.parent, &link).expect("symlink parent");
    let before = fx.snapshot();
    assert_eq!(check(&link, fx.uid), want, "(a) symlinked parent");
    assert_eq!(fx.snapshot(), before, "(a) tree changed");

    if canonical_tmp() == std::env::temp_dir() {
        println!("SKIPPED: T21(b): temp_dir() is already canonical");
        return;
    }
    let rel = fx.parent.strip_prefix(canonical_tmp()).expect("under tmp");
    let spelled = std::env::temp_dir().join(rel);
    assert_eq!(check(&spelled, fx.uid), want, "(b) temp_dir() spelling");
    assert_eq!(fx.snapshot(), before, "(b) tree changed");
}
