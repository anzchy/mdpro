//! D24 review follow-up — `work_area_from_physical` (the scale arithmetic behind
//! `primary_work_area`) and the disk-free / I-O-error edges of restore.
//!
//! **Law (inverse scale):** for any finite `s > 0`,
//! `work_area_from_physical(x, y, w, h, s) * s == (x, y, w, h)` within f64
//! rounding.
//! **Guard:** a scale that is non-finite or `<= 0` is treated as `1.0`.
//!
//! The HOME cases run in a temp `$HOME` under `HOME_LOCK` ([`TestHome`]) with
//! the real `load_preferences`. Nothing is mocked.

use super::test_home::{config_file, TestHome};
use super::*;

fn area(x: f64, y: f64, width: f64, height: f64) -> WorkArea {
    WorkArea {
        x,
        y,
        width,
        height,
    }
}

#[test]
fn wa1_scale_two_halves_every_field() {
    assert_eq!(
        work_area_from_physical(0, 50, 2880, 1750, 2.0),
        area(0.0, 25.0, 1440.0, 875.0)
    );
    assert_eq!(
        work_area_from_physical(-2880, -100, 3840, 2160, 2.0),
        area(-1440.0, -50.0, 1920.0, 1080.0)
    );
}

#[test]
fn wa2_scale_one_is_identity() {
    assert_eq!(
        work_area_from_physical(-1920, 25, 1920, 1055, 1.0),
        area(-1920.0, 25.0, 1920.0, 1055.0)
    );
}

#[test]
fn wa3_bad_scale_is_treated_as_one() {
    let expected = area(100.0, 30.0, 2880.0, 1750.0);
    for s in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -0.0, -1.0] {
        assert_eq!(
            work_area_from_physical(100, 30, 2880, 1750, s),
            expected,
            "scale {s}"
        );
    }
}

#[test]
fn wa4_law_result_times_scale_is_input() {
    let samples: [(i32, i32, u32, u32); 4] = [
        (0, 0, 2880, 1750),
        (-3840, 37, 3840, 2123),
        (1, -1, 1, 1),
        (i32::MIN, i32::MAX, u32::MAX, 7),
    ];
    let close = |got: f64, want: f64| (got - want).abs() <= want.abs() * 1e-12 + 1e-9;
    for (x, y, w, h) in samples {
        for s in [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0] {
            let r = work_area_from_physical(x, y, w, h, s);
            let ctx = format!("({x},{y},{w},{h}) at scale {s}: {r:?}");
            assert!(close(r.x * s, f64::from(x)), "x {ctx}");
            assert!(close(r.y * s, f64::from(y)), "y {ctx}");
            assert!(close(r.width * s, f64::from(w)), "width {ctx}");
            assert!(close(r.height * s, f64::from(h)), "height {ctx}");
        }
    }
}

#[test]
fn nd1_no_path_never_touches_disk() {
    let h = TestHome::new("nd1");
    assert!(
        !config_file(&h.dir).exists(),
        "precondition: no config.json"
    );
    let (r, o) = restore_geometry_for(None, area(0.0, 0.0, 1440.0, 900.0));
    assert_eq!(
        o,
        RestoreOutcome {
            source: GeometrySource::Default,
            reason: RestoreReason::NoPath,
            clamped: false,
        }
    );
    assert_eq!(r.position, None);
    assert!(!config_file(&h.dir).exists(), "config.json was created");
    assert!(!h.dir.join(".mdpro").exists(), ".mdpro was created");
}

#[test]
fn io1_config_that_is_a_directory_is_an_io_error() {
    let h = TestHome::new("io1");
    std::fs::create_dir_all(config_file(&h.dir)).expect("create config.json dir");
    let result = read_stored_geometry("/tmp/x.md");
    assert!(
        matches!(result, Err(RestoreReadError::Io(_))),
        "expected an Io error, got {result:?}"
    );
    assert!(config_file(&h.dir).is_dir(), "config.json dir left alone");
}
