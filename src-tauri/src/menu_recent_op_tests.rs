//! D43 WI-3: `MenuState::publish_op` (PO-01..PO-08) of
//! `.claude/tdd-guardian/tests-20261007-143049.md`, except PO-08 (view-mode
//! memory, `menu_recent_op_view_mode_tests.rs`). The publish-level
//! validation cases live in `menu_recent_op_validation_tests.rs`.
//!
//! `install` stands in for `build_menu` + `set_menu` (the Tauri runtime
//! boundary). Every test that calls `publish_op` holds a `TestHome`: the
//! function logs `menu.recent_files.sync`, and without a temp `$HOME` those
//! records would land in the developer's real log, or in the temp log of a
//! concurrently running `menu_recent_log_tests` case.

use super::MenuState;
use crate::menu::menu_recent_merge::{apply_recent_op, RecentOp};
use crate::services::window_restore::test_home::TestHome;
use std::cell::Cell;
use std::sync::{mpsc, Arc, Barrier};
use std::thread;
use std::time::Duration;

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn state_with(items: &[&str]) -> Arc<MenuState> {
    let state = Arc::new(MenuState::default());
    state.set_recent_files(v(items));
    state
}

fn home() -> TestHome {
    TestHome::new("menu_recent_op")
}

fn record(p: &str) -> RecentOp {
    RecentOp::Record {
        path: p.to_string(),
    }
}

fn ok(_: &[String], _: Option<&str>) -> Result<(), String> {
    Ok(())
}

#[test]
fn po01_success_returns_and_publishes_the_merged_list() {
    let _home = home();
    let state = state_with(&["/a.md"]);
    let result = state.publish_op(record("/b.md"), None, ok);
    assert_eq!(result, Ok(v(&["/b.md", "/a.md"])));
    assert_eq!(state.recent_files(), v(&["/b.md", "/a.md"]));
}

#[test]
fn po02_install_failure_keeps_the_old_list_and_returns_the_error() {
    let _home = home();
    let state = state_with(&["/a.md"]);
    let result = state.publish_op(record("/b.md"), None, |_, _| Err("set_menu failed".into()));
    assert_eq!(result, Err("set_menu failed".to_string()));
    assert_eq!(state.recent_files(), v(&["/a.md"]));
}

#[test]
fn po03_install_receives_the_merged_list_while_state_holds_the_old() {
    let _home = home();
    let state = state_with(&["/a.md"]);
    let mut received: Vec<String> = Vec::new();
    let mut seen_state: Vec<String> = Vec::new();
    let result = state.publish_op(record("/b.md"), None, |list, _| {
        received = list.to_vec();
        seen_state = state.recent_files();
        Ok(())
    });
    assert_eq!(result, Ok(v(&["/b.md", "/a.md"])));
    assert_eq!(received, v(&["/b.md", "/a.md"]));
    assert_eq!(seen_state, v(&["/a.md"]));
    assert_eq!(state.recent_files(), v(&["/b.md", "/a.md"]));
}

#[test]
fn po04_refresh_reinstalls_from_the_current_list_and_changes_nothing() {
    let _home = home();
    let state = state_with(&["/a.md", "/b.md"]);
    let calls = Cell::new(0u32);
    let mut got: Vec<String> = Vec::new();
    let result = state.publish_op(RecentOp::Refresh, None, |list, _| {
        calls.set(calls.get() + 1);
        got = list.to_vec();
        Ok(())
    });
    assert_eq!(result, Ok(v(&["/a.md", "/b.md"])));
    assert_eq!(calls.get(), 1, "Refresh must rebuild the menu exactly once");
    assert_eq!(got, v(&["/a.md", "/b.md"]));
    assert_eq!(state.recent_files(), v(&["/a.md", "/b.md"]));
}

fn pool_op(index: usize, k: usize) -> RecentOp {
    match index {
        0 => record(&format!("/f{k}.md")),
        1 => record(""),
        2 => RecentOp::Seed {
            stored: None,
            pending_newest_first: vec![format!("/p{k}.md")],
        },
        3 => RecentOp::Seed {
            stored: Some(v(&["/s.md", "/f0.md"])),
            pending_newest_first: Vec::new(),
        },
        _ => RecentOp::Refresh,
    }
}

#[test]
fn po05_property_commit_or_nothing_over_every_sequence_up_to_length_four() {
    let _home = home();
    const POOL: usize = 5;
    for len in 0..=4u32 {
        for seq in 0..POOL.pow(len) {
            for mask in 0..(1u32 << len) {
                let state = state_with(&["/init.md"]);
                let mut model = v(&["/init.md"]);
                let mut digits = seq;
                for k in 0..len as usize {
                    let op = pool_op(digits % POOL, k);
                    digits /= POOL;
                    let pass = mask & (1 << k) != 0;
                    let tag = format!("len={len} seq={seq} mask={mask:b} k={k} op={op:?}");
                    let want = apply_recent_op(&model, &op);
                    let result = state.publish_op(op, None, |_, _| {
                        if pass {
                            Ok(())
                        } else {
                            Err("install failed".into())
                        }
                    });
                    if pass {
                        model = want;
                        assert_eq!(result, Ok(model.clone()), "{tag}");
                    } else {
                        assert!(result.is_err(), "{tag}");
                    }
                    assert_eq!(state.recent_files(), model, "{tag}");
                }
            }
        }
    }
}

#[test]
fn po06_concurrency_no_lost_update_and_linearisable_across_three_threads() {
    let _home = home();
    for iteration in 0..30 {
        let state = Arc::new(MenuState::default());
        let barrier = Arc::new(Barrier::new(3));
        let handles: Vec<_> = (0..3)
            .map(|t| {
                let state = Arc::clone(&state);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    for i in 0..3 {
                        let result =
                            state.publish_op(record(&format!("/t{t}-{i}.md")), None, |_, _| {
                                thread::sleep(Duration::from_millis(1));
                                Ok(())
                            });
                        assert!(result.is_ok(), "iteration={iteration} t={t} i={i}");
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("recording thread panicked");
        }
        let list = state.recent_files();
        assert_eq!(
            list.len(),
            9,
            "iteration={iteration} lost an update: {list:?}"
        );
        for t in 0..3 {
            let pos = |i: usize| list.iter().position(|p| *p == format!("/t{t}-{i}.md"));
            let (p0, p1, p2) = (pos(0), pos(1), pos(2));
            assert!(
                p0.is_some() && p1.is_some() && p2.is_some(),
                "iteration={iteration} t={t} missing a path: {list:?}"
            );
            assert!(
                p2 < p1 && p1 < p0,
                "iteration={iteration} t={t} order: {list:?}"
            );
        }
    }
}

#[test]
fn po07_lock_separation_install_can_read_the_published_list() {
    // Held on this thread: `$HOME` is process-wide, and a deadlocked worker
    // must never be the one holding `HOME_LOCK`.
    let _home = home();
    let state = state_with(&["/a.md"]);
    let (tx, rx) = mpsc::channel();
    let worker = Arc::clone(&state);
    thread::spawn(move || {
        let mut seen = Vec::new();
        let result = worker.publish_op(record("/b.md"), None, |_, _| {
            seen = worker.recent_files();
            Ok(())
        });
        let _ = tx.send((seen, result));
    });
    let received = rx.recv_timeout(Duration::from_secs(2));
    assert!(
        received.is_ok(),
        "publish_op deadlocked: install must not run under the data mutex"
    );
    let (seen, result) = received.expect("checked above");
    assert_eq!(seen, v(&["/a.md"]));
    assert_eq!(result, Ok(v(&["/b.md", "/a.md"])));
    assert_eq!(state.recent_files(), v(&["/b.md", "/a.md"]));
}
