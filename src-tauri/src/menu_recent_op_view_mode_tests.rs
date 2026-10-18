//! M3a: a reported mode belongs to its window. List-only ops preserve the
//! currently focused window's checkmark; failures do not erase reports.

use super::{MenuState, ModeReport};
use crate::menu::menu_recent_merge::RecentOp;
use crate::services::window_restore::test_home::TestHome;
use std::cell::RefCell;

fn report(window: &str, mode: &str) -> Option<ModeReport> {
    Some(ModeReport {
        window: window.into(),
        mode: mode.into(),
    })
}

fn record(path: &str) -> RecentOp {
    RecentOp::Record { path: path.into() }
}

#[test]
fn po08_view_mode_memory_witness_fresh_and_failure_cases() {
    let _home = TestHome::new("menu_recent_op_view_mode");
    let state = MenuState::default();
    state.set_recent_files(vec!["/a.md".into()]);
    state.set_focused(Some("A".into()));
    let modes: RefCell<Vec<Option<String>>> = RefCell::new(Vec::new());
    let capture = |_: &[String], mode: Option<&str>| {
        modes.borrow_mut().push(mode.map(str::to_string));
        Ok(())
    };
    let _ = state.publish_op(RecentOp::Refresh, report("A", "wysiwyg"), capture);
    let result = state.publish_op(record("/b.md"), None, capture);
    assert_eq!(result, Ok(vec!["/b.md".into(), "/a.md".into()]));
    assert_eq!(
        *modes.borrow(),
        vec![Some("wysiwyg".into()), Some("wysiwyg".into())]
    );

    let fresh = MenuState::default();
    fresh.set_focused(Some("A".into()));
    let mut got = None;
    let _ = fresh.publish_op(record("/x.md"), None, |_, mode| {
        got = Some(mode.map(str::to_string));
        Ok(())
    });
    assert_eq!(got, Some(None));

    let failing = MenuState::default();
    failing.set_focused(Some("A".into()));
    let _ = failing.publish_op(RecentOp::Refresh, report("A", "source"), |_, _| {
        Err("x".into())
    });
    let mut after = None;
    let _ = failing.publish_op(record("/y.md"), None, |_, mode| {
        after = Some(mode.map(str::to_string));
        Ok(())
    });
    assert_eq!(after, Some(Some("source".into())));
}

#[test]
fn po08_property_install_mode_is_the_focused_windows_last_report() {
    let _home = TestHome::new("menu_recent_op_view_mode_property");
    let modes = [None, Some("source"), Some("wysiwyg")];
    for len in 1..=3u32 {
        let combos = 6usize.pow(len);
        for combo in 0..combos {
            for focus_mask in 0..(1u32 << len) {
                for install_mask in 0..(1u32 << len) {
                    let mut digits = combo;
                    let state = MenuState::default();
                    let mut remembered = [None, None];
                    for k in 0..len as usize {
                        let digit = digits % 6;
                        digits /= 6;
                        let window = if digit < 3 { "A" } else { "B" };
                        let index = if digit < 3 { 0 } else { 1 };
                        let mode = modes[digit % 3];
                        if let Some(mode) = mode {
                            remembered[index] = Some(mode);
                        }
                        let focused = if focus_mask & (1 << k) == 0 { "A" } else { "B" };
                        state.set_focused(Some(focused.into()));
                        let op = match k % 3 {
                            0 => record(&format!("/f{k}.md")),
                            1 => RecentOp::Seed {
                                stored: None,
                                pending_newest_first: vec![],
                            },
                            _ => RecentOp::Refresh,
                        };
                        let mut seen = None;
                        let pass = install_mask & (1 << k) != 0;
                        let _ =
                            state.publish_op(op, mode.and_then(|m| report(window, m)), |_, m| {
                                seen = Some(m.map(str::to_string));
                                if pass {
                                    Ok(())
                                } else {
                                    Err("install failed".into())
                                }
                            });
                        let expected = remembered[if focused == "A" { 0 } else { 1 }];
                        assert_eq!(seen, Some(expected.map(str::to_string)));
                    }
                }
            }
        }
    }
}
