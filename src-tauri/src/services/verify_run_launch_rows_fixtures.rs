//! Test-only single-defect rows for `launch.json` and containment (ADR-0047
//! WI-002 / WI-4, matrix WI4-T12..T14), and `all_rows()`, the union WI4-T15
//! runs. Row shape and runner: `verify_run_rows_fixtures.rs`.
#![allow(dead_code)]
use super::verify_run_fixtures::{set_var, Run, CF_HOME, HOME, NONCE};
use super::verify_run_rows_fixtures::{
    rows_t02, rows_t03, rows_t04, rows_t05, rows_t06, rows_t07, rows_t08, rows_t09_named, rows_t10,
    rows_t11_named, Row,
};
use super::GuardError;
use std::fs;
use std::os::unix::fs::symlink;

fn launch_row(name: &str, expect: Option<GuardError>, f: fn(&Run)) -> Row {
    Row {
        name: name.to_string(),
        apply: Box::new(move |fx| {
            f(fx);
            fx.args()
        }),
        expect,
    }
}

pub(super) fn rows_t12() -> Vec<Row> {
    use GuardError::*;
    vec![
        launch_row("T12 missing", Some(LaunchJsonMissing), |fx| {
            fs::remove_file(fx.launch()).expect("remove launch.json");
        }),
        launch_row("T12 symlink", Some(LaunchJsonNotRegular), |fx| {
            let real = fx.run.join("real.json");
            fs::write(&real, format!("{{\"nonce\":\"{}\"}}", fx.nonce)).expect("write real");
            fs::remove_file(fx.launch()).expect("remove launch.json");
            symlink(&real, fx.launch()).expect("symlink launch.json");
        }),
        launch_row("T12 directory", Some(LaunchJsonNotRegular), |fx| {
            fs::remove_file(fx.launch()).expect("remove launch.json");
            fs::create_dir(fx.launch()).expect("mkdir launch.json");
        }),
        launch_row("T12 truncated", Some(LaunchJsonMalformed), |fx| {
            fx.write_launch("{nonce:")
        }),
        launch_row("T12 empty file", Some(LaunchJsonMalformed), |fx| {
            fx.write_launch("")
        }),
        launch_row("T12 array", Some(NonceMissing), |fx| fx.write_launch("[]")),
        launch_row("T12 no nonce", Some(NonceMissing), |fx| {
            fx.write_launch("{}")
        }),
        launch_row("T12 nonce 42", Some(NonceMissing), |fx| {
            fx.write_launch(r#"{"nonce":42}"#)
        }),
        launch_row("T12 nonce null", Some(NonceMissing), |fx| {
            fx.write_launch(r#"{"nonce":null}"#)
        }),
        launch_row("T12 nonce differs", Some(NonceMismatch), |fx| {
            set_var(NONCE, format!("b{}", &fx.nonce[1..]));
        }),
        launch_row("T12 env nonce is a prefix", Some(NonceMismatch), |fx| {
            set_var(NONCE, "abc");
            fx.write_launch(r#"{"nonce":"abcd"}"#);
        }),
        launch_row("T12 case differs", Some(NonceMismatch), |fx| {
            fx.write_launch(&format!("{{\"nonce\":\"{}\"}}", fx.nonce.to_uppercase()));
        }),
    ]
}

pub(super) fn rows_t13() -> Vec<Row> {
    vec![launch_row("T13 extra keys accepted", None, |fx| {
        fx.write_launch(&format!("{{\"nonce\":\"{}\",\"x\":1,\"pid\":2}}", fx.nonce));
    })]
}

pub(super) fn rows_t14() -> Vec<Row> {
    use GuardError::*;
    vec![
        launch_row("T14(a) HOME sibling", Some(HomeOutsideRun), |fx| {
            set_var(HOME, fx.mkdir(&fx.parent.join("r-other")));
        }),
        launch_row(
            "T14(b) HOME string-prefix sibling",
            Some(HomeOutsideRun),
            |fx| {
                set_var(HOME, fx.mkdir(&sibling_x(fx)));
            },
        ),
        launch_row("T14(c) CF sibling", Some(CfHomeOutsideRun), |fx| {
            set_var(CF_HOME, fx.mkdir(&fx.parent.join("r-other")));
        }),
        launch_row(
            "T14(d) CF string-prefix sibling",
            Some(CfHomeOutsideRun),
            |fx| {
                set_var(CF_HOME, fx.mkdir(&sibling_x(fx)));
            },
        ),
        launch_row("T14(e) HOME inside run", None, |fx| {
            set_var(HOME, fx.mkdir(&fx.run.join("sub")));
        }),
        launch_row("T14(f) CF inside run", None, |fx| {
            set_var(CF_HOME, fx.mkdir(&fx.run.join("cf")));
        }),
    ]
}

/// `<run>X`: shares the run dir's string prefix, not its path prefix.
fn sibling_x(fx: &Run) -> std::path::PathBuf {
    let mut s = fx.run.clone().into_os_string();
    s.push("X");
    s.into()
}

/// Every single-defect row of T02..T14 (T09 and T11 through their named rows).
pub(super) fn all_rows() -> Vec<Row> {
    [
        rows_t02(),
        rows_t03(),
        rows_t04(),
        rows_t05(),
        rows_t06(),
        rows_t07(),
        rows_t08(),
        rows_t09_named(),
        rows_t10(),
        rows_t11_named(),
        rows_t12(),
        rows_t13(),
        rows_t14(),
    ]
    .into_iter()
    .flatten()
    .collect()
}
