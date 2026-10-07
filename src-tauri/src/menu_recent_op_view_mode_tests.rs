//! D43 WI-3: PO-08 of `.claude/tdd-guardian/tests-20261007-143049.md`.
//! `MenuState` remembers the last `Some` view mode any op reported and every
//! install builds with it. Observed only through what `install` receives
//! (the command passes that argument to `build_menu`). Each test holds a
//! `TestHome` so the sync log records stay in a temp `$HOME`.

use super::MenuState;
use crate::menu::menu_recent_merge::RecentOp;
use crate::services::window_restore::test_home::TestHome;
use std::cell::RefCell;
use std::sync::Arc;

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn state_with(items: &[&str]) -> Arc<MenuState> {
    let state = Arc::new(MenuState::default());
    state.set_recent_files(v(items));
    state
}

fn home() -> TestHome {
    TestHome::new("menu_recent_op_view_mode")
}

fn record(p: &str) -> RecentOp {
    RecentOp::Record {
        path: p.to_string(),
    }
}

#[test]
fn po08_view_mode_memory_witness_fresh_and_failure_cases() {
    let _home = home();
    // (a) witness
    let state = state_with(&["/a.md"]);
    let modes: RefCell<Vec<Option<String>>> = RefCell::new(Vec::new());
    let capture = |_: &[String], m: Option<&str>| {
        modes.borrow_mut().push(m.map(String::from));
        Ok(())
    };
    let _ = state.publish_op(RecentOp::Refresh, Some("wysiwyg".into()), capture);
    let result = state.publish_op(record("/b.md"), None, capture);
    assert_eq!(result, Ok(v(&["/b.md", "/a.md"])));
    assert_eq!(
        *modes.borrow(),
        vec![Some("wysiwyg".to_string()), Some("wysiwyg".to_string())]
    );

    // (b) fresh state, before any Some
    let fresh = MenuState::default();
    let mut got: Option<Option<String>> = None;
    let _ = fresh.publish_op(record("/x.md"), None, |_, m| {
        got = Some(m.map(String::from));
        Ok(())
    });
    assert_eq!(got, Some(None));

    // (c) an install failure keeps the remembered mode
    let failing = MenuState::default();
    let _ = failing.publish_op(RecentOp::Refresh, Some("source".into()), |_, _| {
        Err("x".into())
    });
    let mut after: Option<Option<String>> = None;
    let _ = failing.publish_op(record("/y.md"), None, |_, m| {
        after = Some(m.map(String::from));
        Ok(())
    });
    assert_eq!(after, Some(Some("source".to_string())));
}

#[test]
fn po08_property_install_mode_is_the_most_recent_some() {
    let _home = home();
    let modes = [None, Some("source"), Some("wysiwyg")];
    for len in 1..=3u32 {
        let combos = 3usize.pow(len) * 3usize.pow(len);
        for combo in 0..combos {
            for mask in 0..(1u32 << len) {
                let state = MenuState::default();
                let mut remembered: Option<&str> = None;
                let mut digits = combo;
                for k in 0..len as usize {
                    let op = match digits % 3 {
                        0 => record(&format!("/f{k}.md")),
                        1 => RecentOp::Seed {
                            stored: None,
                            pending_newest_first: Vec::new(),
                        },
                        _ => RecentOp::Refresh,
                    };
                    digits /= 3;
                    let mode = modes[digits % 3];
                    digits /= 3;
                    if mode.is_some() {
                        remembered = mode;
                    }
                    let pass = mask & (1 << k) != 0;
                    let mut seen: Option<Option<String>> = None;
                    let _ = state.publish_op(op, mode.map(String::from), |_, m| {
                        seen = Some(m.map(String::from));
                        if pass {
                            Ok(())
                        } else {
                            Err("install failed".into())
                        }
                    });
                    assert_eq!(
                        seen,
                        Some(remembered.map(String::from)),
                        "len={len} combo={combo} mask={mask:b} k={k}"
                    );
                }
            }
        }
    }
}
