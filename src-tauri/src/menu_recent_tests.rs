//! Unit tests for `menu_recent::publish_after` (WI-12, audit row 18), the
//! `[ADV2-1]` contract over the recent-files command closure. The D43 WI-3
//! command source contracts CS-02 / CS-03 live in
//! `menu_recent_command_contract_tests.rs` and reuse the helpers here.

use super::{publish_after, MenuState};
use std::cell::{Cell, RefCell};
use std::sync::Arc;

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn state_with(items: &[&str]) -> Arc<MenuState> {
    let state = Arc::new(MenuState::default());
    state.set_recent_files(v(items));
    state
}

#[test]
fn install_failure_keeps_the_old_list() {
    let state = state_with(&["/a.md"]);
    let result = publish_after(&state, v(&["/b.md", "/c.md"]), |_| {
        Err("set_menu failed".into())
    });
    assert_eq!(result, Err("set_menu failed".to_string()));
    assert_eq!(state.recent_files(), v(&["/a.md"]));
}

#[test]
fn install_success_publishes_the_new_list() {
    let state = state_with(&["/a.md"]);
    let result = publish_after(&state, v(&["/b.md", "/c.md"]), |_| Ok(()));
    assert_eq!(result, Ok(()));
    assert_eq!(state.recent_files(), v(&["/b.md", "/c.md"]));
}

#[test]
fn install_observes_the_old_list_and_runs_exactly_once() {
    let state = state_with(&["/a.md"]);
    let calls = Cell::new(0u32);
    let seen: RefCell<Vec<Vec<String>>> = RefCell::new(Vec::new());

    let _ = publish_after(&state, v(&["/b.md"]), |_| {
        calls.set(calls.get() + 1);
        seen.borrow_mut().push(state.recent_files());
        Err("boom".into())
    });
    assert_eq!(calls.get(), 1);

    let _ = publish_after(&state, v(&["/c.md"]), |_| {
        calls.set(calls.get() + 1);
        seen.borrow_mut().push(state.recent_files());
        Ok(())
    });
    assert_eq!(calls.get(), 2);
    assert_eq!(*seen.borrow(), vec![v(&["/a.md"]), v(&["/a.md"])]);
}

#[test]
fn adv1_1_install_receives_the_new_list_while_state_holds_the_old() {
    let state = state_with(&["/a.md"]);
    let mut seen_arg: Vec<String> = Vec::new();
    let mut seen_state: Vec<String> = Vec::new();
    let result = publish_after(&state, v(&["/b.md", "/c.md"]), |received| {
        seen_arg = received.to_vec();
        seen_state = state.recent_files();
        Ok(())
    });
    assert_eq!(result, Ok(()));
    assert_eq!(seen_arg, v(&["/b.md", "/c.md"]));
    assert_eq!(seen_state, v(&["/a.md"]));
    assert_eq!(state.recent_files(), v(&["/b.md", "/c.md"]));
}

/// Call k publishes `["/f{k}.md"]`, except call 2, which publishes `[]`.
fn list_for_call(k: usize) -> Vec<String> {
    if k == 2 {
        Vec::new()
    } else {
        vec![format!("/f{k}.md")]
    }
}

#[test]
fn property_last_ok_wins_over_every_sequence_up_to_length_four() {
    for len in 0..=4usize {
        for mask in 0..(1u32 << len) {
            let state = state_with(&["/init.md"]);
            let mut expected = v(&["/init.md"]);
            for k in 0..len {
                let ok = mask & (1 << k) != 0;
                let list = list_for_call(k);
                let want = list.clone();
                let result = publish_after(&state, list, |received| {
                    assert_eq!(received, want.as_slice(), "len={len} mask={mask:b} k={k}");
                    if ok {
                        Ok(())
                    } else {
                        Err("install failed".into())
                    }
                });
                if ok {
                    assert_eq!(result, Ok(()), "len={len} mask={mask:b} k={k}");
                    expected = list_for_call(k);
                } else {
                    assert!(result.is_err(), "len={len} mask={mask:b} k={k}");
                }
                assert_eq!(
                    state.recent_files(),
                    expected,
                    "len={len} mask={mask:b} k={k}"
                );
            }
        }
    }
}

pub(super) const COMMAND_SRC: &str = include_str!("commands/menu.rs");

pub(super) fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// `\|(\w+)(,\s*\w+)*\|[^}]*build_menu\([^,]+,\s*&?\1` without a regex
/// dependency: the closure's (first) parameter is `build_menu`'s second arg.
///
/// D43 WI-3 (orchestrator decision, ADV2-1 option 2): extended to also accept
/// closures with more than one parameter, matching the FIRST one, because
/// `publish_op`'s install now passes `(list, remembered mode)`, so the command
/// closure is `|list, mode|`. Single-parameter matching is unchanged.
pub(super) fn closure_param_feeds_build_menu(src: &str) -> bool {
    for (start, c) in src.char_indices() {
        if c != '|' {
            continue;
        }
        let rest = &src[start + 1..];
        let name: String = rest.chars().take_while(|&ch| is_ident(ch)).collect();
        if name.is_empty() {
            continue;
        }
        let after = &rest[name.len()..];
        let params_len = if after.starts_with('|') {
            0
        } else if after.starts_with(',') {
            let Some(close) = after.find('|') else {
                continue;
            };
            let extra_ok = after[1..close]
                .split(',')
                .map(str::trim)
                .all(|p| !p.is_empty() && p.chars().all(is_ident));
            if !extra_ok {
                continue;
            }
            close
        } else {
            continue;
        };
        let body_start = start + 1 + name.len() + params_len + 1;
        let body = &src[body_start..];
        let body = &body[..body.find('}').unwrap_or(body.len())];
        let Some(call) = body.find("build_menu(") else {
            continue;
        };
        let args = &body[call + "build_menu(".len()..];
        let Some(comma) = args.find(',') else {
            continue;
        };
        if comma == 0 {
            continue;
        }
        let second = args[comma + 1..].trim_start();
        let second = second.strip_prefix('&').unwrap_or(second);
        if second.starts_with(name.as_str()) {
            return true;
        }
    }
    false
}

#[test]
fn adv2_1_command_closure_builds_the_menu_from_its_argument() {
    // (a) edited for D43 WI-3, ADV2-1 decision pre-approved by the orchestrator.
    // Reason: the approved design routes the command through
    // `MenuState::publish_op(`, which holds the sync mutex across read -> merge
    // -> install -> publish; a command calling `publish_after(` directly would
    // merge outside that lock (the lost update PO-06 proves real). The token
    // is now `publish_op(`; CS-02 (`menu_recent_command_contract_tests.rs`)
    // is the successor specification.
    assert!(
        COMMAND_SRC.matches("publish_op(").count() >= 1,
        "(a) command must route through publish_op"
    );
    assert_eq!(
        COMMAND_SRC.matches("recent_files()").count(),
        0,
        "(b) command must not read the published state"
    );
    assert_eq!(
        COMMAND_SRC.matches("set_recent_files(").count(),
        0,
        "(c) command must not publish directly"
    );
    assert!(
        closure_param_feeds_build_menu(COMMAND_SRC),
        "(d) the closure parameter must be build_menu's second argument"
    );
}
