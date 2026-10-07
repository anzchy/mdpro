//! D43 WI-3: the publish-level validation cases SV-01/02/03/06 of
//! `.claude/tdd-guardian/tests-20261007-143049.md`, driven through
//! `MenuState::publish_op`. `install` stands in for `build_menu` + `set_menu`;
//! each test holds a `TestHome` so the sync log records stay in a temp `$HOME`.

use super::MenuState;
use crate::menu::menu_recent_merge::{RecentOp, MAX_RECENT_PATH_BYTES};
use crate::services::window_restore::test_home::TestHome;
use std::cell::Cell;

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn state_with(items: &[&str]) -> MenuState {
    let state = MenuState::default();
    state.set_recent_files(v(items));
    state
}

fn home() -> TestHome {
    TestHome::new("menu_recent_op_validation")
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
fn sv01_record_with_an_empty_path_is_a_no_op() {
    let _home = home();
    let state = state_with(&["/a.md"]);
    assert_eq!(state.publish_op(record(""), None, ok), Ok(v(&["/a.md"])));
    assert_eq!(state.recent_files(), v(&["/a.md"]));
}

#[test]
fn sv02_record_path_length_boundary_max_accepted_max_plus_one_rejected() {
    let _home = home();
    let p_ok = format!("/{}", "a".repeat(MAX_RECENT_PATH_BYTES - 1));
    let p_bad = format!("{p_ok}a");
    let state = state_with(&["/a.md"]);
    let calls = Cell::new(0u32);
    let counting = |_: &[String], _: Option<&str>| {
        calls.set(calls.get() + 1);
        Ok(())
    };
    let accepted = state.publish_op(record(&p_ok), None, counting);
    assert_eq!(accepted, Ok(vec![p_ok.clone(), "/a.md".to_string()]));
    assert_eq!(calls.get(), 1);

    let rejected = state.publish_op(record(&p_bad), None, counting);
    match rejected {
        Err(e) => assert!(e.contains("too long"), "error was {e:?}"),
        Ok(list) => panic!("an over-limit path was accepted: {} entries", list.len()),
    }
    assert_eq!(calls.get(), 1, "a rejected op must not install a menu");
    assert_eq!(state.recent_files(), vec![p_ok, "/a.md".to_string()]);
}

#[test]
fn sv03_seed_filters_empty_and_oversize_entries_without_truncating() {
    let _home = home();
    let p_bad = format!("/{}", "b".repeat(MAX_RECENT_PATH_BYTES));
    let state = MenuState::default();
    let op = RecentOp::Seed {
        stored: Some(vec![String::new(), p_bad, "/ok.md".to_string()]),
        pending_newest_first: v(&["", "/p.md"]),
    };
    assert_eq!(state.publish_op(op, None, ok), Ok(v(&["/p.md", "/ok.md"])));
    assert_eq!(state.recent_files(), v(&["/p.md", "/ok.md"]));
}

#[test]
fn sv06_non_ascii_record_is_accepted_unchanged() {
    let _home = home();
    let path = "/文档/笔记.md";
    assert_eq!(path.len(), 17);
    let state = state_with(&["/a.md"]);
    let mut got: Vec<String> = Vec::new();
    let result = state.publish_op(record(path), None, |list, _| {
        got = list.to_vec();
        Ok(())
    });
    assert_eq!(result, Ok(v(&[path, "/a.md"])));
    assert_eq!(got, v(&[path, "/a.md"]));
    assert_eq!(state.recent_files(), v(&[path, "/a.md"]));
}
