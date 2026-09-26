//! WI-3 (D24 follow-up) — `get_window_geometry` uses the same alias-tolerant
//! lookup as restore, so what DevTools reports is what a window gets.
//!
//! Cases g1-g3 of `.claude/tdd-guardian/tests-20260926-062337.md`.
//!
//! **Law (round trip across aliases):** `save_window_geometry(k, g)` then
//! `get_window_geometry(q)`, for any `q` naming the same file as `k`, returns
//! `g`'s position and size.
//! **Law (restore agreement):** `get_window_geometry(q).geometry ==
//! read_stored_geometry(q)`, and restore for `q` reports `Stored`.
//!
//! Every case runs in a temp `$HOME` under `HOME_LOCK` (`TestHome`) against a
//! real `config.json` and real symlinks. Nothing is mocked.

use super::window_fixture::Fixture;
use super::*;
use crate::services::window_restore::test_home::{
    read_config_bytes, seed_config, write_raw_config, TestHome,
};
use crate::services::window_restore::{read_stored_geometry, restore_geometry_for, RestoreReason};
use serde_json::Value;

fn geo(x: i32, y: i32, width: u32, height: u32) -> WindowGeometry {
    WindowGeometry {
        x,
        y,
        width,
        height,
        last_accessed: 0,
    }
}

/// Big enough that no geometry in these cases is clamped.
const WIDE: WorkArea = WorkArea {
    x: 0.0,
    y: 0.0,
    width: 4000.0,
    height: 3000.0,
};

fn stored_keys(home: &std::path::Path) -> Vec<String> {
    let v: Value = serde_json::from_slice(&read_config_bytes(home)).expect("config parses");
    let mut keys: Vec<String> = v["windowStates"]
        .as_object()
        .expect("windowStates is an object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn g1_save_under_one_spelling_get_under_every_other() {
    let h = TestHome::new("g1");
    let fx = Fixture::new();
    #[allow(unused_mut)]
    let mut queries = vec![
        fx.a.clone(),
        fx.alias.clone(),
        fx.canon_a.clone(),
        fx.dotted_a.clone(),
    ];
    #[cfg(target_os = "macos")]
    queries.push(fx.private_a.clone());

    for k in [&fx.a, &fx.canon_a, &fx.dotted_a] {
        seed_config(&h.dir, |_| {});
        save_window_geometry(k.clone(), geo(70, 80, 900, 650))
            .await
            .unwrap_or_else(|e| panic!("save under {k} failed: {e}"));
        assert_eq!(stored_keys(&h.dir), vec![k.clone()], "save key is raw");

        for q in &queries {
            let got = get_window_geometry(q.clone())
                .await
                .unwrap_or_else(|e| panic!("get {q} failed: {e}"))
                .geometry;
            let g = got
                .clone()
                .unwrap_or_else(|| panic!("saved under {k}, got None for {q}"));
            assert_eq!(
                (g.x, g.y, g.width, g.height),
                (70, 80, 900, 650),
                "saved under {k}, got under {q}"
            );
            assert_eq!(
                read_stored_geometry(q),
                Ok(got),
                "restore agreement for {q}"
            );
            let (_, outcome) = restore_geometry_for(Some(q.as_str()), WIDE);
            assert_eq!(outcome.reason, RestoreReason::Stored, "restore for {q}");
        }
    }
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn g2_raw_key_round_trip_for_a_missing_file() {
    let _h = TestHome::new("g2");
    let gone = "/tmp/mdpro-gone-7.md";
    assert!(
        !std::path::Path::new(gone).exists(),
        "fixture needs {gone} absent"
    );
    save_window_geometry(gone.to_string(), geo(1, 2, 700, 500))
        .await
        .expect("save succeeds");

    let same = get_window_geometry(gone.to_string())
        .await
        .expect("get succeeds")
        .geometry
        .expect("raw spelling round-trips");
    assert_eq!((same.x, same.y, same.width, same.height), (1, 2, 700, 500));

    let dotted = get_window_geometry("/tmp/./mdpro-gone-7.md".to_string())
        .await
        .expect("get succeeds")
        .geometry;
    assert_eq!(dotted, None, "a missing file matches only its raw spelling");
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn g3_corrupt_config_is_an_error_not_a_fake_none() {
    let h = TestHome::new("g3");
    let before = write_raw_config(&h.dir, "{ this is not json");
    let result = get_window_geometry("/tmp/x.md".to_string()).await;
    match result {
        Err(msg) => assert!(!msg.is_empty(), "error message is empty"),
        Ok(r) => panic!("corrupt config must be Err, got Ok({:?})", r.geometry),
    }
    assert_eq!(
        read_config_bytes(&h.dir),
        before,
        "config.json was rewritten"
    );
}
