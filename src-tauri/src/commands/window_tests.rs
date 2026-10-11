//! WI-3 (ADR-0031 step 2, part 2) — the window-geometry guard, clamp and
//! resolve decisions, plus the `save_window_geometry` command.
//!
//! Cases WI3-F1, WI3-F2, WI3-G, WI3-H, WI3-I, WI3-J, WI3-N, WI3-O, WI3-P of
//! `.claude/tdd-guardian/tests-20260923-152800.md`.
//!
//! **Law (`sanitize_geometry`): accept implies identity.** Every geometry the
//! function accepts comes back byte-for-byte unchanged. It validates; it does
//! not repair. Silently clamping an absurd input to something plausible would
//! hide the frontend bug that produced it.
//!
//! **Law (`resolve_window_geometry`): every window opens inside the work
//! area.** For every `stored` — including `None`, and including every inflated
//! pre-fix record now on disk — the returned `size` satisfies the `min` floor,
//! and whenever a `position` is returned the rectangle is contained. There is
//! no input for which this yields a rectangle the user cannot reach.
//!
//! Nothing is mocked. The pure functions are called directly; the command cases
//! run under `crate::HOME_LOCK` in their own temp `$HOME` against a real
//! `config.json` and real serde, so the developer's `~/.mdpro/` is untouched.

use super::*;
use crate::models::UserPreferences;
use crate::HOME_LOCK;
use serde_json::Value;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Harness — the HOME_LOCK / HomeRestorer / temp_home triple, copied from
// commands/logging.rs:142-166 (its helpers are private to that module).
// ---------------------------------------------------------------------------

struct HomeRestorer(Option<String>);
impl Drop for HomeRestorer {
    fn drop(&mut self) {
        match &self.0 {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

/// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
fn set_home(path: &Path) -> HomeRestorer {
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", path.to_str().expect("temp dir path is non-UTF-8")) };
    HomeRestorer(prev)
}

/// Its own prefix, so parallel test binaries cannot collide on one temp dir.
fn temp_home(label: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join("mdpro_window_cmd_test")
        .join(format!("{label}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn config_file(home: &Path) -> PathBuf {
    home.join(".mdpro").join("config.json")
}

/// A complete, correctly-cased document built by round-tripping
/// `UserPreferences::default()` through serde, then mutated. Built rather than
/// hand-written so it stays complete as fields are added.
fn seed_config(home: &Path, mutate: impl FnOnce(&mut Value)) -> Vec<u8> {
    let dir = home.join(".mdpro");
    std::fs::create_dir_all(&dir).unwrap();
    let mut v = serde_json::to_value(UserPreferences::default()).unwrap();
    mutate(&mut v);
    let raw = serde_json::to_string(&v).unwrap();
    std::fs::write(dir.join("config.json"), &raw).unwrap();
    raw.into_bytes()
}

fn read_config_bytes(home: &Path) -> Vec<u8> {
    std::fs::read(config_file(home)).expect("config.json must still exist")
}

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

/// The `G x W` domain shape shared with WI2-F on the unit lane, transcribed.
/// A divergence between the two clamps shows up as one lane red, one green.
fn clamp_domain() -> (Vec<WindowGeometry>, Vec<WorkArea>) {
    (
        vec![
            geo(200, 200, 2400, 1600),
            geo(100, 100, 1200, 800),
            geo(-500, -200, 1200, 800),
            geo(5000, 5000, 800, 600),
            geo(0, 0, 1, 1),
            geo(0, 0, 30000, 30000),
        ],
        vec![
            work(0.0, 0.0, 1440.0, 900.0),
            work(0.0, 0.0, 1728.0, 1117.0),
            work(1440.0, -200.0, 1920.0, 1080.0),
            work(0.0, 0.0, 320.0, 240.0),
        ],
    )
}

// ---------------------------------------------------------------------------
// WI3-F1 — `sanitize_geometry` rejects zero and absurd dimensions, and returns
// everything it accepts unchanged.
// ---------------------------------------------------------------------------

/// Level 3 on the rejections (`matches!` on the variant, not `is_err()` alone —
/// `is_err()` would pass for a catch-all) + Level 1 on the acceptances.
#[test]
fn wi3_f1_sanitize_geometry_rejects_zero_and_absurd_dimensions() {
    let rejected = [
        ("width", geo(0, 0, 0, 800)),
        ("height", geo(0, 0, 1200, 0)),
        ("width", geo(0, 0, 0, 0)),
        ("width", geo(0, 0, u32::MAX, 800)),
        ("height", geo(0, 0, 1200, u32::MAX)),
        // The first value *above* the maximum: `>` vs `>=` at the boundary.
        ("width", geo(0, 0, MAX_WINDOW_DIMENSION + 1, 800)),
        ("height", geo(0, 0, 1200, MAX_WINDOW_DIMENSION + 1)),
    ];

    for (field, g) in rejected {
        let err =
            sanitize_geometry(g.clone()).expect_err(&format!("{g:?} must be rejected on {field}"));
        assert!(
            matches!(err, GeometryError::InvalidDimension { field: f, .. } if f == field),
            "{g:?} rejected with the wrong error: {err:?}"
        );
        assert!(
            err.to_string().contains(field),
            "error message must name the offending field, got {err}"
        );
    }

    // Accept implies identity — including exactly at the maximum and exactly at
    // the 600x400 floor.
    let accepted = [
        geo(100, 100, 1200, 800),
        geo(0, 0, MAX_WINDOW_DIMENSION, MAX_WINDOW_DIMENSION),
        geo(-1600, -200, 600, 400),
    ];
    for g in accepted {
        let out = sanitize_geometry(g.clone()).expect("must be accepted");
        assert_eq!(out, g, "sanitize_geometry repaired an accepted geometry");
    }
}

// ---------------------------------------------------------------------------
// WI3-N — out-of-range x/y are rejected on write, and the clamp cannot panic on
// a value already on disk.
// ---------------------------------------------------------------------------

/// Part 2 is the load-bearing half: `get_stored_geometry` hands `create_window`
/// a record straight off disk with no validation, so a write-path guard can
/// never protect it. `cargo test` builds debug, where an integer overflow
/// aborts the thread — so the no-panic claim is asserted by this test
/// *completing*, which is a real observation.
#[test]
fn wi3_n_out_of_range_positions_are_rejected_and_never_panic_the_clamp() {
    let extremes: [(&str, i32); 6] = [
        ("x", i32::MAX),
        ("x", i32::MIN),
        ("y", i32::MAX),
        ("y", i32::MIN),
        ("x", i32::MAX - 600),
        ("x", MAX_WINDOW_COORDINATE + 1),
    ];

    // Part 1 — rejection.
    for (field, value) in extremes {
        let g = if field == "x" {
            geo(value, 0, 1200, 800)
        } else {
            geo(0, value, 1200, 800)
        };
        let err =
            sanitize_geometry(g.clone()).expect_err(&format!("{field} = {value} must be rejected"));
        assert!(
            matches!(err, GeometryError::InvalidCoordinate { field: f, .. } if f == field),
            "{field} = {value} rejected with the wrong error: {err:?}"
        );
        assert!(
            err.to_string().contains(field),
            "error message must name the offending coordinate, got {err}"
        );
    }
    assert_eq!(
        sanitize_geometry(geo(MIN_WINDOW_COORDINATE, 0, 1200, 800)),
        Ok(geo(MIN_WINDOW_COORDINATE, 0, 1200, 800)),
        "the minimum coordinate is in range"
    );
    for g in [geo(0, 0, 1200, 800), geo(-1600, -1600, 1200, 800)] {
        assert_eq!(
            sanitize_geometry(g.clone()),
            Ok(g.clone()),
            "an in-range position must be accepted unchanged"
        );
    }

    // Part 2 — the clamp returns for every extreme, on every work area.
    let (_, work_areas) = clamp_domain();
    for (field, value) in extremes {
        for w in &work_areas {
            let g = if field == "x" {
                geo(value, 0, 1200, 800)
            } else {
                geo(0, value, 1200, 800)
            };
            let r = clamp_geometry(g, *w, MIN_WINDOW_SIZE);
            let label = format!("{field} = {value} against {w:?}");
            assert!(
                f64::from(r.width) >= MIN_WINDOW_SIZE.0 && f64::from(r.height) >= MIN_WINDOW_SIZE.1,
                "min floor lost for {label} -> {r:?}"
            );
            if w.width >= MIN_WINDOW_SIZE.0 && w.height >= MIN_WINDOW_SIZE.1 {
                assert!(
                    f64::from(r.x) >= w.x,
                    "left edge escaped for {label} -> {r:?}"
                );
                assert!(
                    f64::from(r.y) >= w.y,
                    "top edge escaped for {label} -> {r:?}"
                );
                assert!(
                    f64::from(r.x) + f64::from(r.width) <= w.x + w.width,
                    "right edge escaped for {label} -> {r:?}"
                );
                assert!(
                    f64::from(r.y) + f64::from(r.height) <= w.y + w.height,
                    "bottom edge escaped for {label} -> {r:?}"
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// WI3-H — `clamp_geometry`: idempotence, the size floor, and the `min`
// *parameter* (not a module constant).
// ---------------------------------------------------------------------------

#[test]
fn wi3_h_clamp_geometry_is_idempotent_and_honours_the_min_parameter() {
    let (geometries, work_areas) = clamp_domain();
    let mins = [(600.0_f64, 400.0_f64), (800.0_f64, 600.0_f64)];

    for g in &geometries {
        for w in &work_areas {
            for m in mins {
                let label = format!("g={g:?} w={w:?} m={m:?}");
                let r = clamp_geometry(g.clone(), *w, m);

                assert_eq!(
                    clamp_geometry(r.clone(), *w, m),
                    r,
                    "idempotence broken for {label}"
                );
                assert!(
                    f64::from(r.width) >= m.0 && f64::from(r.height) >= m.1,
                    "min floor lost for {label} -> {r:?}"
                );
                if w.width >= m.0 && w.height >= m.1 {
                    assert!(
                        f64::from(r.x) >= w.x
                            && f64::from(r.y) >= w.y
                            && f64::from(r.x) + f64::from(r.width) <= w.x + w.width
                            && f64::from(r.y) + f64::from(r.height) <= w.y + w.height,
                        "containment broken for {label} -> {r:?}"
                    );
                }
            }
        }
    }

    // The literal witnesses.
    let w = work(0.0, 0.0, 1440.0, 900.0);
    let reduced = clamp_geometry(geo(200, 200, 2400, 1600), w, MIN_WINDOW_SIZE);
    assert!(
        reduced.width <= 1440 && reduced.height <= 900,
        "not reduced: {reduced:?}"
    );
    assert!(
        reduced.width >= 600 && reduced.height >= 400,
        "below floor: {reduced:?}"
    );

    let fitting = geo(240, 100, 1200, 800);
    assert_eq!(
        clamp_geometry(fitting.clone(), w, MIN_WINDOW_SIZE),
        fitting,
        "an already-fitting record, flush edge included, must come back untouched"
    );

    // The WI2-J pair, transcribed: the floor is read from the parameter.
    let grown = clamp_geometry(geo(0, 0, 600, 400), w, (800.0, 600.0));
    assert!(
        grown.width >= 800 && grown.height >= 600,
        "min parameter ignored: {grown:?}"
    );
    assert_eq!(
        clamp_geometry(geo(0, 0, 600, 400), w, (320.0, 240.0)),
        geo(0, 0, 600, 400),
        "a smaller floor must not touch a rectangle already above it"
    );
}

// ---------------------------------------------------------------------------
// WI3-O / WI3-P — `resolve_window_geometry`.
// ---------------------------------------------------------------------------

/// Witness (3) is not decorative: without it, a body of
/// `ResolvedGeometry { position: None, size: (1200.0, 800.0) }` would satisfy
/// (1), (2) and all of WI3-P, and the whole unit could be a constant.
#[test]
fn wi3_o_an_inflated_record_is_clamped_and_a_fitting_one_is_not() {
    let inflated = geo(200, 200, 2400, 1600);
    inflated_fits(inflated.clone(), work(0.0, 0.0, 1440.0, 900.0));
    inflated_fits(inflated, work(0.0, 0.0, 1728.0, 1117.0));

    let r = resolve_window_geometry(
        Some(geo(240, 100, 1200, 800)),
        work(0.0, 0.0, 1440.0, 900.0),
        MIN_WINDOW_SIZE,
    );
    assert_eq!(
        r.position,
        Some((240.0, 100.0)),
        "a fitting record was moved"
    );
    assert_eq!(r.size, (1200.0, 800.0), "a fitting record was resized");
}

/// Each edge inequality asserted individually, so a failure names the edge.
fn inflated_fits(stored: WindowGeometry, w: WorkArea) {
    let r = resolve_window_geometry(Some(stored.clone()), w, MIN_WINDOW_SIZE);
    let (width, height) = r.size;
    let (x, y) = r.position.unwrap_or_else(|| {
        panic!("a stored record must yield a position; stored={stored:?} work={w:?}")
    });
    let label = format!("stored={stored:?} work={w:?} -> {r:?}");

    assert!(width <= w.width, "width exceeds the work area for {label}");
    assert!(
        height <= w.height,
        "height exceeds the work area for {label}"
    );
    assert!(
        width >= MIN_WINDOW_SIZE.0,
        "width below the floor for {label}"
    );
    assert!(
        height >= MIN_WINDOW_SIZE.1,
        "height below the floor for {label}"
    );
    assert!(x >= w.x, "left edge escaped for {label}");
    assert!(y >= w.y, "top edge escaped for {label}");
    assert!(x + width <= w.x + w.width, "right edge escaped for {label}");
    assert!(
        y + height <= w.y + w.height,
        "bottom edge escaped for {label}"
    );
}

/// The `None` branch must not invent a position: `create_window`'s else branch
/// calls `inner_size` and no `position`, which is what makes successive new
/// windows cascade instead of stacking at the top-left.
#[test]
fn wi3_p_no_stored_record_yields_the_default_and_no_position() {
    let big = resolve_window_geometry(None, work(0.0, 0.0, 1440.0, 900.0), MIN_WINDOW_SIZE);
    assert_eq!(
        big.size, DEFAULT_WINDOW_SIZE,
        "the first-ever window changed size"
    );
    assert_eq!(big.position, None, "the None branch invented a position");

    let small = resolve_window_geometry(None, work(0.0, 0.0, 1024.0, 640.0), MIN_WINDOW_SIZE);
    assert_eq!(small.position, None, "the None branch invented a position");
    assert!(
        small.size.0 <= 1024.0 && small.size.1 <= 640.0,
        "the default was not reduced to fit a small display: {small:?}"
    );
    assert!(
        small.size.0 >= MIN_WINDOW_SIZE.0 && small.size.1 >= MIN_WINDOW_SIZE.1,
        "the default fell below the floor: {small:?}"
    );
}

// ---------------------------------------------------------------------------
// WI3-F2 — `save_window_geometry` rejects a zero dimension and leaves the file
// byte-identical. The byte assertion is what forces the guard to the top.
// ---------------------------------------------------------------------------

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi3_f2_save_window_geometry_rejects_a_zero_dimension_without_touching_the_file() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi3f2_zero_dimension");
    let _home_guard = set_home(&home);

    let before = seed_config(&home, |v| {
        v["windowStates"] = serde_json::json!({
            "/tmp/existing.md": { "x": 10, "y": 20, "width": 800, "height": 600, "lastAccessed": 42 }
        });
    });

    let res = save_window_geometry("/tmp/a.md".to_string(), geo(0, 0, 0, 600)).await;

    let err = res.expect_err("a zero-width geometry must be rejected");
    assert!(
        err.contains("width"),
        "the error must name the dimension, got {err}"
    );
    assert_eq!(
        read_config_bytes(&home),
        before,
        "config.json was rewritten despite the rejection"
    );
}

// ---------------------------------------------------------------------------
// WI3-G — Law: save -> get round-trips every field but `lastAccessed`.
// ---------------------------------------------------------------------------

/// The named real-path pairing for the Level 5 assertions in
/// `tests/window-geometry-save-path.test.tsx`: real serde, real filesystem.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi3_g_save_then_get_round_trips_every_field_but_last_accessed() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi3g_round_trip");
    let _home_guard = set_home(&home);
    seed_config(&home, |_| {});

    let domain = [
        geo(0, 0, 600, 400),
        geo(100, 100, 1200, 800),
        // A negative origin: the left-hand-monitor case `i32` exists for.
        geo(-1600, -200, 1440, 900),
        geo(1439, 899, 601, 401),
    ];

    for (i, g) in domain.iter().enumerate() {
        let path = format!("/tmp/round-trip-{i}.md");
        save_window_geometry(path.clone(), g.clone())
            .await
            .unwrap_or_else(|e| panic!("{g:?} must save, got {e}"));

        let stored = get_window_geometry(path.clone())
            .await
            .expect("get must succeed")
            .geometry
            .unwrap_or_else(|| panic!("{path} must round-trip"));

        assert_eq!((stored.x, stored.y), (g.x, g.y), "position lost for {g:?}");
        assert_eq!(
            (stored.width, stored.height),
            (g.width, g.height),
            "size lost for {g:?}"
        );
        // Asserted as *set*, not equal to any clock value, so this cannot flake.
        assert_ne!(
            stored.last_accessed, 0,
            "lastAccessed was not stamped for {g:?}"
        );
    }
}

// ---------------------------------------------------------------------------
// WI3-I / WI3-J — LRU eviction.
// ---------------------------------------------------------------------------

/// 100 seeded entries with distinct `lastAccessed` 1000..1099, so the ordering
/// is total and the outcome deterministic.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi3_i_eviction_keeps_the_hundred_most_recent_by_last_accessed() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("wi3i_lru");
    let _home_guard = set_home(&home);

    seed_config(&home, |v| {
        let mut states = serde_json::Map::new();
        for i in 0..100u32 {
            states.insert(
                format!("/tmp/seed-{i}.md"),
                serde_json::json!({
                    "x": 0, "y": 0, "width": 800, "height": 600,
                    "lastAccessed": 1000 + i as i64
                }),
            );
        }
        v["windowStates"] = Value::Object(states);
    });

    save_window_geometry("/tmp/new.md".to_string(), geo(10, 10, 1200, 800))
        .await
        .expect("a valid geometry must save");

    let prefs = load_preferences().expect("config must reload");
    assert_eq!(prefs.window_states.len(), 100, "capacity is not 100");
    assert!(
        !prefs.window_states.contains_key("/tmp/seed-0.md"),
        "the oldest entry (lastAccessed 1000) survived eviction"
    );
    assert!(
        prefs.window_states.contains_key("/tmp/new.md"),
        "the entry just inserted was evicted"
    );
    for i in 1..100u32 {
        assert!(
            prefs
                .window_states
                .contains_key(&format!("/tmp/seed-{i}.md")),
            "/tmp/seed-{i}.md was evicted but was not the oldest"
        );
    }
}

/// The record a user just produced is the one record eviction must never
/// choose. Quantified over the tie structure of the existing timestamps —
/// today's comparator sorts by `lastAccessed` alone and breaks ties on
/// `HashMap` iteration order, which is not deterministic.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn wi3_j_eviction_never_drops_the_entry_the_call_just_inserted() {
    let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let now = chrono::Utc::now().timestamp();
    type StampFn = Box<dyn Fn(u32) -> i64>;
    let structures: [(&str, StampFn); 4] = [
        ("all distinct and older", Box::new(|i: u32| 1000 + i as i64)),
        ("all identical to each other", Box::new(|_| 1_500)),
        ("all identical and equal to now", Box::new(move |_| now)),
        ("all in the future", Box::new(move |_| now + 86_400)),
    ];

    for (label, stamp) in structures {
        let home = temp_home(&format!("wi3j_{}", label.replace(' ', "_")));
        let _home_guard = set_home(&home);

        seed_config(&home, |v| {
            let mut states = serde_json::Map::new();
            for i in 0..100u32 {
                states.insert(
                    format!("/tmp/seed-{i}.md"),
                    serde_json::json!({
                        "x": 0, "y": 0, "width": 800, "height": 600,
                        "lastAccessed": stamp(i)
                    }),
                );
            }
            v["windowStates"] = Value::Object(states);
        });

        save_window_geometry("/tmp/just-saved.md".to_string(), geo(10, 10, 1200, 800))
            .await
            .unwrap_or_else(|e| panic!("[{label}] a valid geometry must save, got {e}"));

        let found = get_window_geometry("/tmp/just-saved.md".to_string())
            .await
            .expect("get must succeed")
            .geometry;
        assert!(
            found.is_some(),
            "[{label}] eviction dropped the entry the call had just inserted"
        );
    }
}
