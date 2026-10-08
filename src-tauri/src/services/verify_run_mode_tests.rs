//! ADR-0047 WI-002 / WI-4: `verify_run::check` on modes, `launch.json` and
//! containment (matrix WI4-T09, T11..T14). Feature-on only.
use super::verify_run_fixtures::{chmod, Run};
use super::verify_run_launch_rows_fixtures::{rows_t12, rows_t13, rows_t14};
use super::verify_run_rows_fixtures::{assert_rows, PARENT_NAMED};
use super::GuardError;

#[test]
fn wi4_t09_run_dir_mode_accepted_iff_exactly_0700() {
    let fx = Run::valid();
    for m in 0o000u32..=0o777 {
        chmod(&fx.run, m);
        let got = fx.check();
        chmod(&fx.run, 0o700);
        if m == 0o700 {
            assert!(got.is_ok(), "mode {m:o}: {got:?}");
        } else {
            assert_eq!(got.err(), Some(GuardError::RunDirMode), "mode {m:o}");
        }
    }
}

#[test]
fn wi4_t11_parent_mode_accepted_iff_exactly_0700_over_owner_searchable_modes() {
    let fx = Run::valid();
    let mut trials = 0;
    for m in (0o000u32..=0o777).filter(|m| m & 0o100 != 0) {
        chmod(&fx.parent, m);
        let got = fx.check();
        chmod(&fx.parent, 0o700);
        trials += 1;
        if PARENT_NAMED.contains(&m) {
            println!("T11 named row {m:o}: {got:?}");
        }
        if m == 0o700 {
            assert!(got.is_ok(), "parent mode {m:o}: {got:?}");
        } else {
            assert_eq!(got.err(), Some(GuardError::ParentMode), "parent mode {m:o}");
        }
    }
    assert_eq!(trials, 256);
}

#[test]
fn wi4_t12_launch_json_table() {
    assert_rows(&rows_t12());
}

#[test]
fn wi4_t13_extra_keys_in_launch_json_are_accepted() {
    assert_rows(&rows_t13());
}

#[test]
fn wi4_t14_home_and_cf_home_must_be_inside_the_run_dir() {
    assert_rows(&rows_t14());
}
