//! ADR-0047 WI-002 / WI-4: `verify_run::check` on the env and path rows
//! (matrix WI4-T01..T08, T10; WI-002 fix WI-2 `wi2_valid_check_writes_nothing`).
//! Feature-on only. Every test holds
//! `crate::HOME_LOCK` through `Run`; fixtures live under
//! `canonicalize(temp_dir())` with an injected parent.
use super::verify_run_fixtures::{contains_named, Run};
use super::verify_run_rows_fixtures::{
    assert_rows, rows_t02, rows_t03, rows_t04, rows_t05, rows_t06, rows_t07, rows_t08, rows_t10,
};
use super::VerifiedRun;
use std::fs;

#[test]
fn wi4_t01_valid_fixture_passes_and_writes_nothing() {
    let fx = Run::valid();
    let before = fx.snapshot();

    let got = fx.check();

    assert_eq!(
        got,
        Ok(VerifiedRun {
            run_dir: fs::canonicalize(&fx.run).expect("canonical run"),
            nonce: fx.nonce.clone(),
        })
    );
    assert_eq!(fx.snapshot(), before, "check wrote to the tree");
}

/// The guard's whole in-process body is `check`: with the logger live, a
/// valid run dir is accepted and the tree is byte-identical (no
/// `instance.json`, no `.mdpro`).
#[test]
fn wi2_valid_check_writes_nothing() {
    let fx = Run::logged();
    let before = fx.snapshot();

    let got = fx.check();

    assert_eq!(
        got,
        Ok(VerifiedRun {
            run_dir: fs::canonicalize(&fx.run).expect("canonical run"),
            nonce: fx.nonce.clone(),
        })
    );
    assert_eq!(fx.snapshot(), before, "check wrote to the tree");
    assert!(!contains_named(&fx.root, "instance.json"), "instance.json created");
    assert!(!contains_named(&fx.root, ".mdpro"), ".mdpro created");
}

#[test]
fn wi4_t02_each_var_unset_or_empty_names_that_var() {
    assert_rows(&rows_t02());
}

#[test]
fn wi4_t03_non_utf8_value_names_that_var() {
    assert_rows(&rows_t03());
}

#[test]
fn wi4_t04_path_vars_must_equal_their_canonical_form() {
    assert_rows(&rows_t04());
}

#[test]
fn wi4_t05_missing_path_is_path_missing_not_a_panic() {
    assert_rows(&rows_t05());
}

#[test]
fn wi4_t06_run_dir_that_is_a_file() {
    assert_rows(&rows_t06());
}

#[test]
fn wi4_t07_run_dir_must_be_a_direct_child_of_the_parent() {
    assert_rows(&rows_t07());
}

#[test]
fn wi4_t08_unresolvable_parent() {
    assert_rows(&rows_t08());
}

#[test]
fn wi4_t10_owner_mismatch_is_reported_on_the_run_dir_first() {
    assert_rows(&rows_t10());
}
