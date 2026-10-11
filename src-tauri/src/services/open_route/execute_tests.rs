//! Tests for `open_route::execute_plan` (D29 WI-3). Every plan comes from the
//! real `plan_route`; the four side effects are recording closures.
use super::execute_plan;
use crate::services::open_route::{
    plan_route, route_log_context, Outcome, RouteLookup, RouteTarget, Source,
};
use serde_json::Value;

type Lookups = Vec<(String, Result<RouteLookup, String>)>;

fn target(label: &str, id: &str, stored: &str) -> RouteTarget {
    RouteTarget {
        window_label: label.to_string(),
        document_id: id.to_string(),
        path: stored.to_string(),
    }
}

fn hit(label: &str, id: &str, stored: &str, mc: usize) -> Result<RouteLookup, String> {
    Ok(RouteLookup {
        target: Some(target(label, id, stored)),
        match_count: mc,
    })
}

fn miss() -> Result<RouteLookup, String> {
    Ok(RouteLookup {
        target: None,
        match_count: 0,
    })
}

fn lk(items: Vec<(&str, Result<RouteLookup, String>)>) -> Lookups {
    items.into_iter().map(|(p, r)| (p.to_string(), r)).collect()
}

/// Everything the four closures saw.
#[derive(Debug, Default)]
struct Calls {
    emits: Vec<RouteTarget>,
    new_windows: Vec<String>,
    broadcasts: Vec<Vec<String>>,
    logs: Vec<Value>,
    /// The error passed alongside each log, in the same order as `logs`.
    // Recorded so a failing assert's `{:?}` of `Calls` shows it; no test reads it.
    #[allow(dead_code)]
    log_errors: Vec<Option<String>>,
}

/// Plan with `plan_route`, then execute with recording closures. `emit`
/// succeeds for a target iff `emit_ok` returns true for its label.
fn run(source: Source, has_docs: bool, lookups: &Lookups, emit_ok: impl Fn(&str) -> bool) -> Calls {
    let plan = plan_route(source, lookups, has_docs);
    let mut emits = Vec::new();
    let mut new_windows = Vec::new();
    let mut broadcasts = Vec::new();
    let mut logs = Vec::new();
    let mut log_errors = Vec::new();
    execute_plan(
        &plan,
        source,
        |t: &RouteTarget| {
            emits.push(t.clone());
            if emit_ok(&t.window_label) {
                Ok(())
            } else {
                Err("webview gone".to_string())
            }
        },
        |p: String| new_windows.push(p),
        |g: Vec<String>| broadcasts.push(g),
        |v: Value, e: Option<String>| {
            logs.push(v);
            log_errors.push(e);
        },
    );
    Calls {
        emits,
        new_windows,
        broadcasts,
        logs,
        log_errors,
    }
}

fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn executor_success_path_emits_and_logs() {
    let lookups = lk(vec![
        ("p1", hit("A", "id-1", "p1", 1)),
        ("p2", miss()),
        ("p3", hit("B", "id-3", "p3", 2)),
    ]);
    let c = run(Source::Finder, true, &lookups, |_| true);
    assert_eq!(
        c.emits,
        vec![target("A", "id-1", "p1"), target("B", "id-3", "p3")]
    );
    assert_eq!(c.new_windows, strs(&["p2"]));
    assert!(c.broadcasts.is_empty(), "{:?}", c.broadcasts);
    assert_eq!(
        c.logs,
        vec![
            route_log_context(Source::Finder, Outcome::ExistingWindow, Some("A"), 1),
            route_log_context(Source::Finder, Outcome::NewWindow, None, 0),
            route_log_context(Source::Finder, Outcome::ExistingWindow, Some("B"), 2),
        ]
    );
}

#[test]
fn executor_emit_failure_falls_back_to_new_window_finder() {
    let lookups = lk(vec![
        ("p1", hit("A", "id-1", "p1", 1)),
        ("p2", hit("B", "id-2", "p2", 3)),
    ]);
    let c = run(Source::Finder, true, &lookups, |l| l == "A");
    assert_eq!(
        c.emits,
        vec![target("A", "id-1", "p1"), target("B", "id-2", "p2")]
    );
    assert_eq!(c.new_windows, strs(&["p2"]));
    assert!(c.broadcasts.is_empty(), "{:?}", c.broadcasts);
    assert_eq!(
        c.logs,
        vec![
            route_log_context(Source::Finder, Outcome::ExistingWindow, Some("A"), 1),
            route_log_context(Source::Finder, Outcome::NewWindow, None, 3),
        ]
    );
}

#[test]
fn executor_emit_failure_single_instance_no_docs_never_broadcasts() {
    let lookups = lk(vec![("p1", hit("main", "id-1", "p1", 1)), ("p2", miss())]);

    // Row 1: no docs, so the plan's fallback is Broadcast[p2].
    let c = run(Source::SingleInstance, false, &lookups, |_| false);
    assert_eq!(c.emits, vec![target("main", "id-1", "p1")]);
    assert_eq!(c.new_windows, strs(&["p1"]));
    assert_eq!(c.broadcasts, vec![strs(&["p2"])]);
    assert_eq!(
        c.logs,
        vec![
            route_log_context(Source::SingleInstance, Outcome::NewWindow, None, 1),
            route_log_context(Source::SingleInstance, Outcome::Broadcast, None, 0),
        ]
    );

    // Row 2: has docs, so the plan's fallback is NewWindow[p2].
    let c = run(Source::SingleInstance, true, &lookups, |_| false);
    assert_eq!(c.emits, vec![target("main", "id-1", "p1")]);
    assert_eq!(c.new_windows, strs(&["p1", "p2"]));
    assert!(c.broadcasts.is_empty(), "{:?}", c.broadcasts);
}

#[test]
fn executor_log_is_the_exact_context_per_path() {
    let lookups = lk(vec![
        ("p1", hit("A", "id-1", "p1", 2)),
        ("p2", hit("B", "id-2", "p2", 1)),
        ("p3", miss()),
    ]);
    for source in [Source::SingleInstance, Source::Finder] {
        let c = run(source, true, &lookups, |l| l == "A");
        assert_eq!(
            c.logs,
            vec![
                route_log_context(source, Outcome::ExistingWindow, Some("A"), 2),
                route_log_context(source, Outcome::NewWindow, None, 1),
                route_log_context(source, Outcome::NewWindow, None, 0),
            ],
            "{:?}",
            source
        );
        assert_eq!(
            c.emits,
            vec![target("A", "id-1", "p1"), target("B", "id-2", "p2")],
            "{:?}",
            source
        );
        assert_eq!(c.new_windows, strs(&["p2", "p3"]), "{:?}", source);
        assert!(c.broadcasts.is_empty(), "{:?}", source);
    }
}

/// Per-path state for the executor conservation law.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    EmitOk,
    EmitErr,
    Unrouted,
}

const STATES: [State; 3] = [State::EmitOk, State::EmitErr, State::Unrouted];

const CONTEXTS: [(Source, bool, &str); 3] = [
    (Source::Finder, true, "finder"),
    (Source::SingleInstance, true, "single_instance+docs"),
    (Source::SingleInstance, false, "single_instance-no-docs"),
];

#[test]
fn executor_conservation_exhaustive() {
    let paths = ["/in/p0", "/in/p1", "/in/p2"];
    for (source, has_docs, ctx) in CONTEXTS {
        for s0 in STATES {
            for s1 in STATES {
                for s2 in STATES {
                    let states = [s0, s1, s2];
                    let cell = format!("{} {:?}", ctx, states);
                    // Stored paths differ from incoming ones, so a fallback
                    // that used the stored path would show up here.
                    let lookups: Lookups = states
                        .iter()
                        .enumerate()
                        .map(|(i, s)| {
                            let l = match s {
                                State::Unrouted => miss(),
                                _ => hit(
                                    &format!("w{}", i),
                                    &format!("id-{}", i),
                                    &format!("/stored/p{}", i),
                                    i + 1,
                                ),
                            };
                            (paths[i].to_string(), l)
                        })
                        .collect();
                    let ok_labels: Vec<String> = (0..3)
                        .filter(|i| states[*i] == State::EmitOk)
                        .map(|i| format!("w{}", i))
                        .collect();
                    let c = run(source, has_docs, &lookups, |l| {
                        ok_labels.iter().any(|o| o == l)
                    });

                    let broadcast_ctx = source == Source::SingleInstance && !has_docs;
                    let mut want_emits = Vec::new();
                    let mut want_new = Vec::new();
                    let mut want_bc = Vec::new();
                    let mut want_logs = Vec::new();
                    for (i, s) in states.iter().enumerate() {
                        let mc = if *s == State::Unrouted { 0 } else { i + 1 };
                        if *s != State::Unrouted {
                            want_emits.push(target(
                                &format!("w{}", i),
                                &format!("id-{}", i),
                                &format!("/stored/p{}", i),
                            ));
                        }
                        let (outcome, label) = match s {
                            State::EmitOk => (Outcome::ExistingWindow, Some(format!("w{}", i))),
                            State::EmitErr => (Outcome::NewWindow, None),
                            State::Unrouted if broadcast_ctx => (Outcome::Broadcast, None),
                            State::Unrouted => (Outcome::NewWindow, None),
                        };
                        match outcome {
                            Outcome::NewWindow => want_new.push(paths[i].to_string()),
                            Outcome::Broadcast => want_bc.push(paths[i].to_string()),
                            // This oracle never plans under a live quit (D74).
                            Outcome::ExistingWindow | Outcome::RefusedQuitPending => {}
                        }
                        want_logs.push(route_log_context(source, outcome, label.as_deref(), mc));
                    }

                    assert_eq!(c.emits, want_emits, "emits {}", cell);
                    assert_eq!(c.new_windows, want_new, "new_window {}", cell);
                    let want_broadcasts = if want_bc.is_empty() {
                        vec![]
                    } else {
                        vec![want_bc]
                    };
                    assert_eq!(c.broadcasts, want_broadcasts, "broadcast {}", cell);
                    assert!(
                        c.broadcasts.iter().all(|g| !g.is_empty()),
                        "empty broadcast {}",
                        cell
                    );
                    assert_eq!(c.logs, want_logs, "logs {}", cell);

                    // Partition: each input path ends in exactly one place.
                    let delivered = states.iter().filter(|s| **s == State::EmitOk).count();
                    let flat_bc: usize = c.broadcasts.iter().map(Vec::len).sum();
                    assert_eq!(
                        delivered + c.new_windows.len() + flat_bc,
                        paths.len(),
                        "partition {}",
                        cell
                    );
                }
            }
        }
    }
}
