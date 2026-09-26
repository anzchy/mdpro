//! WI-2 (D24 follow-up) — `decide_window_geometry`, the pure half of restore.
//!
//! Cases d1-d7 of `.claude/tdd-guardian/tests-20260926-062337.md`.
//!
//! **Law (containment):** every `Stored` result lies inside the work area
//! whenever a rectangle of at least `MIN_WINDOW_SIZE` fits there (WI3-O).
//! **Law (`clamped` is truthful):** `clamped == (clamp(g) != g)`.
//! **Law (coherence):** `source == Stored` iff `reason == Stored`.
//! **Law (default):** every non-`Stored` result is exactly
//! `resolve_window_geometry(None, w, MIN_WINDOW_SIZE)`, with no position.
//!
//! Pure calls, nothing mocked.

use super::*;
use crate::services::window_geometry::{resolve_window_geometry, MIN_WINDOW_SIZE};

fn geo(x: i32, y: i32, width: u32, height: u32) -> WindowGeometry {
    WindowGeometry {
        x,
        y,
        width,
        height,
        last_accessed: 0,
    }
}

fn work(x: f64, y: f64, width: f64, height: f64) -> WorkArea {
    WorkArea {
        x,
        y,
        width,
        height,
    }
}

const P: &str = "/x/b.md";

fn stored(clamped: bool) -> RestoreOutcome {
    RestoreOutcome {
        source: GeometrySource::Stored,
        reason: RestoreReason::Stored,
        clamped,
    }
}

fn default_for(reason: RestoreReason) -> RestoreOutcome {
    RestoreOutcome {
        source: GeometrySource::Default,
        reason,
        clamped: false,
    }
}

/// `clamp_domain()` of `window_tests.rs:102-119`, transcribed (that fn is
/// private and the file must stay unedited), plus the d4 additions.
fn records() -> Vec<WindowGeometry> {
    vec![
        geo(200, 200, 2400, 1600),
        geo(100, 100, 1200, 800),
        geo(-500, -200, 1200, 800),
        geo(5000, 5000, 800, 600),
        geo(0, 0, 1, 1),
        geo(0, 0, 30000, 30000),
        geo(240, 100, 1200, 800),
        geo(333, 177, 1011, 655),
        geo(i32::MAX, i32::MIN, u32::MAX, 1),
    ]
}

fn work_areas() -> Vec<WorkArea> {
    vec![
        work(0.0, 0.0, 1440.0, 900.0),
        work(0.0, 0.0, 1728.0, 1117.0),
        work(1440.0, -200.0, 1920.0, 1080.0),
        work(0.0, 0.0, 320.0, 240.0),
        work(0.0, 37.0, 1512.0, 945.0),
    ]
}

/// Every `RestoreReadError` variant. The `match` makes adding a variant a
/// compile error here until it is listed.
fn all_errors() -> Vec<RestoreReadError> {
    let v = vec![
        RestoreReadError::LockPoisoned,
        RestoreReadError::Io("x".into()),
        RestoreReadError::Parse("x".into()),
    ];
    for e in &v {
        match e {
            RestoreReadError::LockPoisoned
            | RestoreReadError::Io(_)
            | RestoreReadError::Parse(_) => {}
        }
    }
    v
}

#[test]
fn d1_device_numbers_restore_exactly() {
    let got = decide_window_geometry(
        Some(P),
        Ok(Some(geo(333, 177, 1011, 655))),
        work(0.0, 37.0, 1512.0, 945.0),
    );
    assert_eq!(
        got,
        (
            ResolvedGeometry {
                position: Some((333.0, 177.0)),
                size: (1011.0, 655.0),
            },
            stored(false),
        )
    );
}

#[test]
fn d2_legacy_2x_record_is_clamped_to_full_work_area() {
    let got = decide_window_geometry(
        Some(P),
        Ok(Some(geo(200, 200, 2400, 1600))),
        work(0.0, 0.0, 1440.0, 900.0),
    );
    assert_eq!(
        got,
        (
            ResolvedGeometry {
                position: Some((0.0, 0.0)),
                size: (1440.0, 900.0),
            },
            stored(true),
        )
    );
}

#[test]
fn d3_position_only_clamp_sets_clamped() {
    let got = decide_window_geometry(
        Some(P),
        Ok(Some(geo(5000, 100, 800, 600))),
        work(0.0, 0.0, 1440.0, 900.0),
    );
    assert_eq!(
        got,
        (
            ResolvedGeometry {
                position: Some((640.0, 100.0)),
                size: (800.0, 600.0),
            },
            stored(true),
        )
    );
}

#[test]
fn d4_stored_law_over_transcribed_clamp_domain() {
    for g in records() {
        for w in work_areas() {
            let pair = format!("{g:?} on {w:?}");
            let (r, o) = decide_window_geometry(Some(P), Ok(Some(g.clone())), w);
            assert_eq!(o.source, GeometrySource::Stored, "source: {pair}");
            assert_eq!(o.reason, RestoreReason::Stored, "reason: {pair}");
            assert_eq!(
                r,
                resolve_window_geometry(Some(g.clone()), w, MIN_WINDOW_SIZE),
                "resolve equality: {pair}"
            );
            let changed = r.position != Some((g.x as f64, g.y as f64))
                || r.size != (g.width as f64, g.height as f64);
            assert_eq!(o.clamped, changed, "clamped truthful: {pair}");
            if w.width >= MIN_WINDOW_SIZE.0 && w.height >= MIN_WINDOW_SIZE.1 {
                let Some((x, y)) = r.position else {
                    panic!("stored result without position: {pair}");
                };
                assert!(x >= w.x, "left edge: {pair}");
                assert!(y >= w.y, "top edge: {pair}");
                assert!(x + r.size.0 <= w.x + w.width, "right edge: {pair}");
                assert!(y + r.size.1 <= w.y + w.height, "bottom edge: {pair}");
            }
            assert!(r.size.0 >= MIN_WINDOW_SIZE.0, "min width: {pair}");
            assert!(r.size.1 >= MIN_WINDOW_SIZE.1, "min height: {pair}");
        }
    }
}

#[test]
fn d5_no_path_is_no_path_and_todays_default_even_with_a_read() {
    for w in work_areas() {
        let expected = resolve_window_geometry(None, w, MIN_WINDOW_SIZE);
        for read in [Ok(Some(geo(10, 10, 800, 600))), Ok(None)] {
            let (r, o) = decide_window_geometry(None, read.clone(), w);
            assert_eq!(
                (r, o),
                (expected, default_for(RestoreReason::NoPath)),
                "{read:?} on {w:?}"
            );
            assert_eq!(r.position, None);
        }
    }
    let (r, _) = decide_window_geometry(None, Ok(None), work(0.0, 0.0, 1440.0, 900.0));
    assert_eq!(r.size, (1200.0, 800.0));
}

#[test]
fn d6_no_record_and_read_failure_give_default_with_distinct_reasons() {
    for w in work_areas() {
        let expected = resolve_window_geometry(None, w, MIN_WINDOW_SIZE);
        assert_eq!(expected.position, None);
        assert_eq!(
            decide_window_geometry(Some(P), Ok(None), w),
            (expected, default_for(RestoreReason::NoRecord)),
            "no record on {w:?}"
        );
        for e in all_errors() {
            assert_eq!(
                decide_window_geometry(Some(P), Err(e.clone()), w),
                (expected, default_for(RestoreReason::ReadFailed)),
                "{e:?} on {w:?}"
            );
        }
    }
}

#[test]
fn d7_source_reason_coherence_over_full_input_product() {
    let mut reads: Vec<Result<Option<WindowGeometry>, RestoreReadError>> = vec![
        Ok(None),
        Ok(Some(geo(100, 100, 800, 600))),
        Ok(Some(geo(200, 200, 2400, 1600))),
    ];
    reads.extend(all_errors().into_iter().map(Err));
    for path in [None, Some(P)] {
        for read in &reads {
            for w in work_areas() {
                let case = format!("{path:?} {read:?} {w:?}");
                let (r, o) = decide_window_geometry(path, read.clone(), w);
                assert_eq!(
                    o.source == GeometrySource::Stored,
                    o.reason == RestoreReason::Stored,
                    "coherence: {case}"
                );
                if o.source == GeometrySource::Default {
                    assert!(r.position.is_none(), "default has no position: {case}");
                    assert!(!o.clamped, "default is never clamped: {case}");
                } else {
                    assert!(r.position.is_some(), "stored has a position: {case}");
                }
            }
        }
    }
}
