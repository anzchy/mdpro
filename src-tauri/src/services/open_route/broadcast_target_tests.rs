//! Tests for D279 WI-1: `broadcast_target` (the single window the
//! single-instance broadcast fallback goes to) and the `file.open.route` log
//! contexts that carry `via`. Pure; no mocks. Every law case enumerates a
//! finite domain exhaustively and counts its cells, so it cannot pass vacuously.
use super::{
    broadcast_route_log_context, broadcast_target, fallback_route_log_context, route_log_context,
    route_log_severity, Outcome, Source,
};
use crate::menu::menu_target::{resolve_target, ActionClass, CancelReason, Resolved, Via};
use crate::models::{LogLevel, LogStatus};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashSet};

fn snap(focused: Option<&str>, last: Option<&str>) -> (Option<String>, Option<String>) {
    (focused.map(String::from), last.map(String::from))
}

fn live(labels: &[&str]) -> HashSet<String> {
    labels.iter().map(|l| l.to_string()).collect()
}

const SNAP_LABELS: [Option<&str>; 5] = [None, Some("A"), Some("B"), Some("C"), Some("Z")];
const LIVE_UNIVERSE: [&str; 5] = ["A", "B", "C", "main", "mdpro-b"];

/// All 25 snapshots over `{None, A, B, C, Z}²`.
fn all_snapshots() -> Vec<(Option<String>, Option<String>)> {
    let mut out = Vec::new();
    for f in SNAP_LABELS {
        for l in SNAP_LABELS {
            out.push(snap(f, l));
        }
    }
    out
}

/// All 32 subsets of `LIVE_UNIVERSE`, as label lists in universe order.
fn all_subsets() -> Vec<Vec<&'static str>> {
    (0..(1u32 << LIVE_UNIVERSE.len()))
        .map(|mask| {
            LIVE_UNIVERSE
                .iter()
                .enumerate()
                .filter(|(i, _)| mask & (1 << i) != 0)
                .map(|(_, l)| *l)
                .collect()
        })
        .collect()
}

fn permutations(items: &[&'static str]) -> Vec<Vec<&'static str>> {
    if items.len() <= 1 {
        return vec![items.to_vec()];
    }
    let mut out = Vec::new();
    for i in 0..items.len() {
        let mut rest = items.to_vec();
        let head = rest.remove(i);
        for mut tail in permutations(&rest) {
            tail.insert(0, head);
            out.push(tail);
        }
    }
    out
}

// BT-1
#[test]
fn bt1_focused_window_wins() {
    assert_eq!(
        broadcast_target(&snap(Some("B"), Some("A")), &live(&["A", "B"])),
        Ok(("B".to_string(), Via::Focused))
    );
}

// BT-2: "B" is not the lowest label, so an any-live shortcut fails.
#[test]
fn bt2_last_focused_when_nothing_is_focused() {
    assert_eq!(
        broadcast_target(&snap(None, Some("B")), &live(&["A", "B"])),
        Ok(("B".to_string(), Via::LastFocused))
    );
}

// BT-3
#[test]
fn bt3_stale_last_focused_falls_to_lowest_live_label_by_bytes() {
    assert_eq!(
        broadcast_target(&snap(None, Some("Z")), &live(&["mdpro-b", "main"])),
        Ok(("main".to_string(), Via::AnyLive))
    );
}

// BT-4
#[test]
fn bt4_no_live_window_is_no_live_window_even_with_a_remembered_label() {
    assert_eq!(
        broadcast_target(&snap(None, None), &live(&[])),
        Err(CancelReason::NoLiveWindow)
    );
    assert_eq!(
        broadcast_target(&snap(None, Some("A")), &live(&[])),
        Err(CancelReason::NoLiveWindow)
    );
}

// BT-5: D261 parity (R7): no live-check on the focused label.
#[test]
fn bt5_focused_label_that_is_not_live_still_wins() {
    assert_eq!(
        broadcast_target(&snap(Some("gone"), None), &live(&[])),
        Ok(("gone".to_string(), Via::Focused))
    );
}

// BT-L1 (S6): oracle equivalence with D261's App-class resolution, 800 cells.
#[test]
fn bt_l1_agrees_with_app_class_resolve_target_over_800_cells() {
    let mut cells = 0;
    for s in all_snapshots() {
        for subset in all_subsets() {
            let set = live(&subset);
            let mut sorted: Vec<String> = set.iter().cloned().collect();
            sorted.sort();
            let expected = resolve_target(&s, ActionClass::App, &sorted);
            assert_eq!(
                broadcast_target(&s, &set),
                expected,
                "snapshot {s:?}, live {subset:?}"
            );
            cells += 1;
        }
    }
    assert_eq!(cells, 800);
}

// BT-L2 (S4): independent of HashSet insertion order and hash seed, 8,000 cells.
#[test]
fn bt_l2_independent_of_insertion_order_over_8000_cells() {
    let mut cells = 0;
    for s in all_snapshots() {
        for subset in all_subsets().into_iter().filter(|s| s.len() >= 2) {
            let mut first: Option<Resolved> = None;
            for order in permutations(&subset) {
                let mut set = HashSet::new();
                for label in &order {
                    set.insert(label.to_string());
                }
                let got = broadcast_target(&s, &set);
                match &first {
                    None => first = Some(got),
                    Some(f) => assert_eq!(&got, f, "snapshot {s:?}, order {order:?}"),
                }
                cells += 1;
            }
        }
    }
    assert_eq!(cells, 8000);
}

// BT-L3 (S4): totality, without the oracle, 800 cells.
#[test]
fn bt_l3_never_no_focused_window_and_labels_come_from_live_or_focused() {
    let mut cells = 0;
    for s in all_snapshots() {
        for subset in all_subsets() {
            let set = live(&subset);
            let got = broadcast_target(&s, &set);
            let ctx = format!("snapshot {s:?}, live {subset:?}, got {got:?}");
            assert_ne!(got, Err(CancelReason::NoFocusedWindow), "{ctx}");
            if let Ok((label, _)) = &got {
                assert!(
                    set.contains(label) || s.0.as_deref() == Some(label.as_str()),
                    "{ctx}"
                );
            }
            assert_eq!(
                got == Err(CancelReason::NoLiveWindow),
                s.0.is_none() && set.is_empty(),
                "{ctx}"
            );
            cells += 1;
        }
    }
    assert_eq!(cells, 800);
}

// LC-1
#[test]
fn lc1_broadcast_context_exact_json_per_resolution() {
    assert_eq!(
        broadcast_route_log_context(
            Source::SingleInstance,
            &Ok(("main".to_string(), Via::Focused)),
            0
        ),
        json!({"source":"single_instance","outcome":"broadcast","windowLabel":"main","matchCount":0,"via":"focused"})
    );
    assert_eq!(
        broadcast_route_log_context(
            Source::SingleInstance,
            &Ok(("mdpro-b".to_string(), Via::LastFocused)),
            3
        ),
        json!({"source":"single_instance","outcome":"broadcast","windowLabel":"mdpro-b","matchCount":3,"via":"last_focused"})
    );
    assert_eq!(
        broadcast_route_log_context(Source::Finder, &Ok(("w-z".to_string(), Via::AnyLive)), 1),
        json!({"source":"finder","outcome":"broadcast","windowLabel":"w-z","matchCount":1,"via":"any_live"})
    );
    assert_eq!(
        broadcast_route_log_context(Source::SingleInstance, &Err(CancelReason::NoLiveWindow), 0),
        json!({"source":"single_instance","outcome":"broadcast","windowLabel":null,"matchCount":0,"via":null})
    );
}

// LC-2 (ruling R2): the send-failure fallback line keeps the resolved via.
#[test]
fn lc2_fallback_context_keeps_the_resolved_via() {
    assert_eq!(
        fallback_route_log_context(Source::SingleInstance, Outcome::NewWindow, Via::Focused, 0),
        json!({"source":"single_instance","outcome":"new-window","windowLabel":null,"matchCount":0,"via":"focused"})
    );
    assert_eq!(
        fallback_route_log_context(
            Source::SingleInstance,
            Outcome::RefusedQuitPending,
            Via::AnyLive,
            0
        ),
        json!({"source":"single_instance","outcome":"refused-quit-pending","windowLabel":null,"matchCount":0,"via":"any_live"})
    );
}

fn assert_closed_contract(ctx: &Value, via_expected_null: bool, cell: &str) {
    let keys: BTreeSet<&str> = ctx
        .as_object()
        .unwrap_or_else(|| panic!("not an object: {cell}"))
        .keys()
        .map(String::as_str)
        .collect();
    let five: BTreeSet<&str> = ["source", "outcome", "windowLabel", "matchCount", "via"]
        .into_iter()
        .collect();
    assert_eq!(keys, five, "{cell}");
    let via = &ctx["via"];
    assert!(
        via.is_null()
            || ["focused", "last_focused", "any_live"].contains(&via.as_str().unwrap_or("")),
        "{cell}"
    );
    assert_eq!(via.is_null(), via_expected_null, "{cell}");
    let outcomes = [
        "existing-window",
        "new-window",
        "broadcast",
        "refused-quit-pending",
    ];
    assert!(
        outcomes.contains(&ctx["outcome"].as_str().unwrap_or("")),
        "{cell}"
    );
}

// LC-L4 (S4): every builder's output has exactly the five keys, 64 cells.
#[test]
fn lc_l4_every_builder_has_exactly_the_five_keys() {
    let sources = [Source::Finder, Source::SingleInstance];
    let outcomes = [
        Outcome::ExistingWindow,
        Outcome::NewWindow,
        Outcome::Broadcast,
        Outcome::RefusedQuitPending,
    ];
    let vias = [Via::Focused, Via::LastFocused, Via::AnyLive];
    let resolutions: Vec<Resolved> = vec![
        Ok(("w".to_string(), Via::Focused)),
        Ok(("w".to_string(), Via::LastFocused)),
        Ok(("w".to_string(), Via::AnyLive)),
        Err(CancelReason::NoLiveWindow),
        Err(CancelReason::NoFocusedWindow),
    ];
    let mut cells = 0;
    for source in sources {
        for mc in [0, 2] {
            for outcome in outcomes {
                for label in [None, Some("w")] {
                    let ctx = route_log_context(source, outcome, label, mc);
                    let cell = format!("route {source:?} {outcome:?} {label:?} {mc}");
                    assert_closed_contract(&ctx, true, &cell);
                    cells += 1;
                }
            }
            for r in &resolutions {
                let ctx = broadcast_route_log_context(source, r, mc);
                let cell = format!("broadcast {source:?} {r:?} {mc}");
                assert_closed_contract(&ctx, r.is_err(), &cell);
                cells += 1;
            }
        }
        for outcome in [Outcome::NewWindow, Outcome::RefusedQuitPending] {
            for via in vias {
                let ctx = fallback_route_log_context(source, outcome, via, 0);
                let cell = format!("fallback {source:?} {outcome:?} {via:?}");
                assert_closed_contract(&ctx, false, &cell);
                cells += 1;
            }
        }
    }
    assert_eq!(cells, 64);
}

// LC-4: severity of the new lines is unchanged in kind.
#[test]
fn lc4_severity_of_the_new_lines() {
    let no_live =
        broadcast_route_log_context(Source::SingleInstance, &Err(CancelReason::NoLiveWindow), 0);
    let focused = broadcast_route_log_context(
        Source::SingleInstance,
        &Ok(("main".to_string(), Via::Focused)),
        0,
    );
    let new_window =
        fallback_route_log_context(Source::SingleInstance, Outcome::NewWindow, Via::Focused, 0);
    let refused = fallback_route_log_context(
        Source::SingleInstance,
        Outcome::RefusedQuitPending,
        Via::AnyLive,
        0,
    );
    assert_eq!(
        route_log_severity(&no_live, Some("no_live_window")),
        (LogLevel::Warn, LogStatus::Fail)
    );
    assert_eq!(
        route_log_severity(&focused, None),
        (LogLevel::Info, LogStatus::Success)
    );
    assert_eq!(
        route_log_severity(&new_window, Some("window main is gone")),
        (LogLevel::Warn, LogStatus::Fail)
    );
    assert_eq!(
        route_log_severity(&refused, Some("x")),
        (LogLevel::Warn, LogStatus::Fail)
    );
}
