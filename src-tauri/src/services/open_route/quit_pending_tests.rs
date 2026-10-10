//! D74 — an external open while a quit request is live must not create a
//! window: the request snapshotted its windows at `begin` and would neither
//! prompt nor wait for a new one. Routing to a window that already exists is
//! unaffected. Pure; the side effects are recording closures.
use crate::models::{LogLevel, LogStatus};
use crate::services::open_route::{
    execute_plan, plan_route, route_log_context, route_log_severity, Outcome, PlanEntry,
    RouteLookup, RouteTarget, Source,
};
use serde_json::Value;

type Lookups = Vec<(String, Result<RouteLookup, String>)>;

fn target(label: &str) -> RouteTarget {
    RouteTarget {
        window_label: label.to_string(),
        document_id: format!("doc-{label}"),
        path: format!("/stored/{label}.md"),
    }
}

fn lookups() -> Lookups {
    vec![
        // Held by window A.
        (
            "/a.md".to_string(),
            Ok(RouteLookup {
                target: Some(target("A")),
                match_count: 1,
            }),
        ),
        // Held by nobody: today's fallback.
        (
            "/b.md".to_string(),
            Ok(RouteLookup {
                target: None,
                match_count: 0,
            }),
        ),
        // A lookup error is unrouted too.
        ("/c.md".to_string(), Err("poisoned".to_string())),
    ]
}

#[derive(Default)]
struct Calls {
    emits: Vec<String>,
    new_windows: Vec<String>,
    broadcasts: Vec<Vec<String>>,
    logs: Vec<(Value, Option<String>)>,
}

fn run(source: Source, has_docs: bool, quit_pending: bool, emit_ok: bool) -> Calls {
    let plan = plan_route(source, &lookups(), has_docs).with_quit_pending(quit_pending);
    let mut calls = Calls::default();
    execute_plan(
        &plan,
        source,
        |t: &RouteTarget| {
            calls.emits.push(t.window_label.clone());
            if emit_ok {
                Ok(())
            } else {
                Err("window A is gone".to_string())
            }
        },
        |p: String| calls.new_windows.push(p),
        |g: Vec<String>| calls.broadcasts.push(g),
        |v: Value, e: Option<String>| calls.logs.push((v, e)),
    );
    calls
}

fn refused_ctx(source: Source, mc: usize) -> Value {
    route_log_context(source, Outcome::RefusedQuitPending, None, mc)
}

#[test]
fn d74_refused_outcome_has_a_stable_log_string() {
    assert_eq!(Outcome::RefusedQuitPending.as_str(), "refused-quit-pending");
}

#[test]
fn d74_quit_pending_turns_every_new_window_entry_into_a_refusal() {
    for source in [Source::Finder, Source::SingleInstance] {
        let plan = plan_route(source, &lookups(), true).with_quit_pending(true);
        assert_eq!(plan.entries.len(), 3, "one entry per path, none dropped");
        assert!(
            matches!(&plan.entries[0], PlanEntry::ExistingWindow { target, .. } if target.window_label == "A"),
            "routing to an existing window is unaffected: {:?}",
            plan.entries[0]
        );
        assert_eq!(
            plan.entries[1],
            PlanEntry::Refused {
                path: "/b.md".to_string(),
                match_count: 0
            }
        );
        assert_eq!(
            plan.entries[2],
            PlanEntry::Refused {
                path: "/c.md".to_string(),
                match_count: 0
            }
        );
    }
}

#[test]
fn d74_no_quit_pending_leaves_the_plan_unchanged() {
    for (source, has_docs) in [
        (Source::Finder, true),
        (Source::Finder, false),
        (Source::SingleInstance, true),
        (Source::SingleInstance, false),
    ] {
        let plan = plan_route(source, &lookups(), has_docs);
        assert_eq!(plan.clone().with_quit_pending(false), plan);
    }
}

#[test]
fn d74_a_broadcast_is_not_a_new_window_and_is_kept() {
    // Single instance with no documents broadcasts into the windows that exist.
    let plan = plan_route(Source::SingleInstance, &lookups(), false).with_quit_pending(true);
    assert!(matches!(plan.entries[1], PlanEntry::Broadcast { .. }));
    assert!(matches!(plan.entries[2], PlanEntry::Broadcast { .. }));
}

#[test]
fn d74_execute_with_a_live_quit_creates_no_window_and_logs_each_refusal() {
    let calls = run(Source::Finder, true, true, true);
    assert!(calls.new_windows.is_empty(), "{:?}", calls.new_windows);
    assert_eq!(calls.emits, vec!["A".to_string()]);
    assert!(calls.broadcasts.is_empty());
    assert_eq!(
        calls.logs,
        vec![
            (
                route_log_context(Source::Finder, Outcome::ExistingWindow, Some("A"), 1),
                None
            ),
            (refused_ctx(Source::Finder, 0), None),
            (refused_ctx(Source::Finder, 0), None),
        ]
    );
}

#[test]
fn d74_a_failed_emit_does_not_fall_back_to_a_new_window_while_quitting() {
    let calls = run(Source::SingleInstance, true, true, false);
    assert!(calls.new_windows.is_empty(), "{:?}", calls.new_windows);
    assert_eq!(
        calls.logs[0],
        (
            refused_ctx(Source::SingleInstance, 1),
            Some("window A is gone".to_string())
        ),
        "the emit error is still reported alongside the refusal"
    );
}

#[test]
fn d74_without_a_quit_a_failed_emit_still_opens_a_window() {
    // The ADR-0033 decision 7 fallback is unchanged outside a quit.
    let calls = run(Source::Finder, true, false, false);
    assert_eq!(
        calls.new_windows,
        vec![
            "/a.md".to_string(),
            "/b.md".to_string(),
            "/c.md".to_string()
        ]
    );
}

#[test]
fn d74_route_log_severity_maps_every_case() {
    let refused = refused_ctx(Source::Finder, 0);
    let new_window = route_log_context(Source::Finder, Outcome::NewWindow, None, 0);
    assert_eq!(
        route_log_severity(&refused, None),
        (LogLevel::Warn, LogStatus::Cancel)
    );
    assert_eq!(
        route_log_severity(&refused, Some("gone")),
        (LogLevel::Warn, LogStatus::Fail)
    );
    assert_eq!(
        route_log_severity(&new_window, Some("gone")),
        (LogLevel::Warn, LogStatus::Fail)
    );
    assert_eq!(
        route_log_severity(&new_window, None),
        (LogLevel::Info, LogStatus::Success)
    );
}
