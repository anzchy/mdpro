//! Tests for `open_route::execute_plan` (D29 WI-3, D279 WI-2). Every plan
//! comes from the real `plan_route`; the four side effects are recording
//! closures standing in for the Tauri runtime.
use super::execute_plan;
use crate::menu::menu_target::{CancelReason, Resolved, Via};
use crate::services::open_route::plan::broadcast_route_log_context;
use crate::services::open_route::{
    plan_route, route_log_context, Outcome, RouteLookup, RouteTarget, Source,
};
use serde_json::{json, Value};

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
#[derive(Debug, Default, PartialEq)]
struct Calls {
    emits: Vec<RouteTarget>,
    new_windows: Vec<String>,
    /// Every broadcast send, as (target label, group), attempts included.
    broadcasts: Vec<(String, Vec<String>)>,
    logs: Vec<Value>,
    /// The error passed alongside each log, in the same order as `logs`.
    log_errors: Vec<Option<String>>,
}

/// The default broadcast target of the D29-era cases (D279 harness default).
fn main_focused() -> Resolved {
    Ok(("main".to_string(), Via::Focused))
}

/// Plan with `plan_route`, then execute with recording closures. `emit`
/// succeeds for a target iff `emit_ok` returns true for its label. The
/// broadcast target is `main` (focused) and the send succeeds.
fn run(source: Source, has_docs: bool, lookups: &Lookups, emit_ok: impl Fn(&str) -> bool) -> Calls {
    run_with(
        source,
        has_docs,
        false,
        lookups,
        emit_ok,
        &main_focused(),
        None,
    )
}

/// `run` with the D279 knobs: a live quit, the broadcast target, and the
/// send's error (`None` = the send succeeds).
fn run_with(
    source: Source,
    has_docs: bool,
    quit_pending: bool,
    lookups: &Lookups,
    emit_ok: impl Fn(&str) -> bool,
    broadcast_target: &Resolved,
    send_err: Option<&str>,
) -> Calls {
    let plan = plan_route(source, lookups, has_docs).with_quit_pending(quit_pending);
    let mut emits = Vec::new();
    let mut new_windows = Vec::new();
    let mut broadcasts = Vec::new();
    let mut logs = Vec::new();
    let mut log_errors = Vec::new();
    execute_plan(
        &plan,
        source,
        broadcast_target,
        |t: &RouteTarget| {
            emits.push(t.clone());
            if emit_ok(&t.window_label) {
                Ok(())
            } else {
                Err("webview gone".to_string())
            }
        },
        |p: String| new_windows.push(p),
        |label: &str, g: Vec<String>| {
            broadcasts.push((label.to_string(), g));
            match send_err {
                None => Ok(()),
                Some(e) => Err(e.to_string()),
            }
        },
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
    // D279 Q3: the group goes to the one resolved window (`main`, the harness
    // default), and its line carries that window and `via`.
    assert_eq!(c.broadcasts, vec![("main".to_string(), strs(&["p2"]))]);
    assert_eq!(
        c.logs,
        vec![
            route_log_context(Source::SingleInstance, Outcome::NewWindow, None, 1),
            broadcast_route_log_context(Source::SingleInstance, &main_focused(), 0),
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

/// The `file.open.route` context, built here from literals so the oracle is
/// independent of the production builders (D279 test matrix, EX-L5).
fn want_ctx(
    source: Source,
    outcome: &str,
    label: Option<&str>,
    mc: usize,
    via: Option<&str>,
) -> Value {
    let source = match source {
        Source::Finder => "finder",
        Source::SingleInstance => "single_instance",
    };
    json!({
        "source": source,
        "outcome": outcome,
        "windowLabel": label,
        "matchCount": mc,
        "via": via,
    })
}

fn via_str(via: Via) -> &'static str {
    match via {
        Via::Focused => "focused",
        Via::LastFocused => "last_focused",
        Via::AnyLive => "any_live",
    }
}

// EX-1 (D279 regression): the whole group goes once, to the one window.
#[test]
fn d279_one_window_receives_the_whole_group() {
    let lookups = lk(vec![("p1", miss()), ("p2", miss())]);
    let target = Ok(("main".to_string(), Via::LastFocused));
    let c = run_with(
        Source::SingleInstance,
        false,
        false,
        &lookups,
        |_| true,
        &target,
        None,
    );
    assert_eq!(
        c.broadcasts,
        vec![("main".to_string(), strs(&["p1", "p2"]))]
    );
    assert_eq!(c.new_windows, Vec::<String>::new());
    assert_eq!(c.emits, vec![]);
    let line = json!({"source":"single_instance","outcome":"broadcast",
        "windowLabel":"main","matchCount":0,"via":"last_focused"});
    assert_eq!(c.logs, vec![line.clone(), line]);
    assert_eq!(c.log_errors, vec![None, None]);
}

// EX-6: the routed path is emitted, the rest go as one send, and the logs
// stay in input order with broadcast lines before and after the routed one.
#[test]
fn d279_mixed_plan_emits_sends_once_and_logs_in_input_order() {
    let lookups = lk(vec![
        ("p0", miss()),
        ("p1", hit("main", "id-1", "/s/p1", 1)),
        ("p2", miss()),
    ]);
    let c = run_with(
        Source::SingleInstance,
        false,
        false,
        &lookups,
        |_| true,
        &main_focused(),
        None,
    );
    assert_eq!(c.emits, vec![target("main", "id-1", "/s/p1")]);
    assert_eq!(
        c.broadcasts,
        vec![("main".to_string(), strs(&["p0", "p2"]))]
    );
    assert_eq!(c.new_windows, Vec::<String>::new());
    let bc = json!({"source":"single_instance","outcome":"broadcast",
        "windowLabel":"main","matchCount":0,"via":"focused"});
    let routed = json!({"source":"single_instance","outcome":"existing-window",
        "windowLabel":"main","matchCount":1,"via":null});
    assert_eq!(c.logs, vec![bc.clone(), routed, bc]);
    assert_eq!(c.log_errors, vec![None, None, None]);
}

// EX-7: a plan with no broadcast entries sends nothing, whatever the target,
// and never logs `no_live_window`.
#[test]
fn d279_no_broadcast_entries_no_send_whatever_the_target() {
    let lookups = lk(vec![("pa", hit("A", "id-a", "pa", 1)), ("pb", miss())]);
    let targets: [Resolved; 2] = [main_focused(), Err(CancelReason::NoLiveWindow)];
    for t in &targets {
        let c = run_with(Source::Finder, true, false, &lookups, |_| true, t, None);
        assert_eq!(c.broadcasts, vec![], "{:?}", t);
        assert_eq!(c.new_windows, strs(&["pb"]), "{:?}", t);
        assert_eq!(
            c.logs,
            vec![
                json!({"source":"finder","outcome":"existing-window",
                    "windowLabel":"A","matchCount":1,"via":null}),
                json!({"source":"finder","outcome":"new-window",
                    "windowLabel":null,"matchCount":0,"via":null}),
            ],
            "{:?}",
            t
        );
        assert_eq!(c.log_errors, vec![None, None], "{:?}", t);
    }
}

/// Three distinct labels, so a hard-coded label fails, plus no live window.
fn targets() -> [Resolved; 4] {
    [
        Ok(("w-z".to_string(), Via::Focused)),
        Ok(("main".to_string(), Via::LastFocused)),
        Ok(("mdpro-b".to_string(), Via::AnyLive)),
        Err(CancelReason::NoLiveWindow),
    ]
}

/// The expected record of one cell, from the test-local oracle.
fn oracle(
    source: Source,
    has_docs: bool,
    quit: bool,
    states: [State; 3],
    paths: &[&str; 3],
    target: &Resolved,
    send_err: Option<&str>,
) -> Calls {
    let broadcast_ctx = source == Source::SingleInstance && !has_docs;
    let resolved = target.as_ref().ok().map(|(l, v)| (l.as_str(), via_str(*v)));
    let mut want = Calls::default();
    let mut group = Vec::new();
    for (i, s) in states.iter().enumerate() {
        let path = paths[i].to_string();
        let mc = if *s == State::Unrouted { 0 } else { i + 1 };
        let (outcome, label, via, err) = match s {
            State::EmitOk | State::EmitErr => {
                want.emits.push(target_of(i));
                match s {
                    State::EmitOk => ("existing-window", Some(format!("w{}", i)), None, None),
                    _ if quit => ("refused-quit-pending", None, None, Some("webview gone")),
                    _ => {
                        want.new_windows.push(path);
                        ("new-window", None, None, Some("webview gone"))
                    }
                }
            }
            State::Unrouted if !broadcast_ctx && quit => ("refused-quit-pending", None, None, None),
            State::Unrouted if !broadcast_ctx => {
                want.new_windows.push(path);
                ("new-window", None, None, None)
            }
            State::Unrouted => {
                group.push(path.clone());
                match (resolved, send_err) {
                    (None, _) => ("broadcast", None, None, Some("no_live_window")),
                    (Some((l, v)), None) => ("broadcast", Some(l.to_string()), Some(v), None),
                    // D279 R2: a failed send falls back; the line keeps `via`.
                    (Some((_, v)), Some(e)) if quit => {
                        ("refused-quit-pending", None, Some(v), Some(e))
                    }
                    (Some((_, v)), Some(e)) => {
                        want.new_windows.push(path);
                        ("new-window", None, Some(v), Some(e))
                    }
                }
            }
        };
        want.logs
            .push(want_ctx(source, outcome, label.as_deref(), mc, via));
        want.log_errors.push(err.map(String::from));
    }
    if let (false, Some((l, _))) = (group.is_empty(), resolved) {
        want.broadcasts.push((l.to_string(), group));
    }
    want
}

fn target_of(i: usize) -> RouteTarget {
    target(
        &format!("w{}", i),
        &format!("id-{}", i),
        &format!("/stored/p{}", i),
    )
}

// EX-L5/L6/L7/L8 (D279 WI-2), extending the D29 conservation law. Stated
// reason for the changed expected broadcast lines: D279 Q3, the group goes
// to one resolved window and its line names that window and `via`.
#[test]
fn executor_conservation_exhaustive() {
    let paths = ["/in/p0", "/in/p1", "/in/p2"];
    let mut visited = 0;
    for (source, has_docs, ctx) in CONTEXTS {
        for s0 in STATES {
            for s1 in STATES {
                for s2 in STATES {
                    for target in targets() {
                        for send_err in [None, Some("send-err")] {
                            for quit in [false, true] {
                                visited += 1;
                                let states = [s0, s1, s2];
                                let cell = format!(
                                    "{} {:?} {:?} send={:?} quit={}",
                                    ctx, states, target, send_err, quit
                                );
                                // Stored paths differ from incoming ones, so a
                                // fallback that used the stored path would show.
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
                                let go = || {
                                    run_with(
                                        source,
                                        has_docs,
                                        quit,
                                        &lookups,
                                        |l| ok_labels.iter().any(|o| o == l),
                                        &target,
                                        send_err,
                                    )
                                };
                                let c = go();
                                // L8: the same cell twice gives the same record.
                                assert_eq!(c, go(), "determinism {}", cell);

                                let want = oracle(
                                    source, has_docs, quit, states, &paths, &target, send_err,
                                );
                                assert_eq!(c.emits, want.emits, "emits {}", cell);
                                assert_eq!(c.new_windows, want.new_windows, "new {}", cell);
                                assert_eq!(c.broadcasts, want.broadcasts, "sends {}", cell);
                                // L7: one log per path, in input order.
                                assert_eq!(c.logs.len(), paths.len(), "log count {}", cell);
                                assert_eq!(c.logs, want.logs, "logs {}", cell);
                                assert_eq!(c.log_errors, want.log_errors, "errors {}", cell);

                                // L6: at most one send, never empty, only to
                                // the resolved label, only when resolved.
                                assert!(c.broadcasts.len() <= 1, "one send {}", cell);
                                if let Some((label, group)) = c.broadcasts.first() {
                                    assert!(!group.is_empty(), "empty send {}", cell);
                                    let resolved = target.as_ref().ok().map(|(l, _)| l);
                                    assert_eq!(Some(label), resolved, "send label {}", cell);
                                }

                                // L5: each input path ends in exactly one place.
                                let sent_ok = send_err.is_none();
                                for (i, p) in paths.iter().enumerate() {
                                    let places = [
                                        c.logs[i]["outcome"] == "existing-window",
                                        sent_ok
                                            && c.broadcasts
                                                .iter()
                                                .any(|(_, g)| g.iter().any(|x| x == p)),
                                        c.new_windows.iter().filter(|x| x == p).count() == 1,
                                        c.logs[i]["outcome"] == "refused-quit-pending",
                                        c.log_errors[i].as_deref() == Some("no_live_window"),
                                    ];
                                    let n = places.iter().filter(|b| **b).count();
                                    assert_eq!(n, 1, "partition {} path {} {:?}", cell, p, places);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    assert_eq!(visited, 1296, "every cell visited");
}

/// D279 ruling R4: the broadcast group is sent before any
/// `file:open-in-window` emit, and each path's log follows in input order.
/// One shared trace, since the harness above records each closure apart.
#[test]
fn d279_r4_broadcast_send_precedes_open_in_window_emits() {
    use std::cell::RefCell;
    let lookups = lk(vec![
        ("/in/p1", hit("main", "d1", "/in/p1", 1)),
        ("/in/p2", miss()),
    ]);
    let plan = plan_route(Source::SingleInstance, &lookups, false);
    let trace = RefCell::new(Vec::<String>::new());
    execute_plan(
        &plan,
        Source::SingleInstance,
        &main_focused(),
        |t: &RouteTarget| {
            trace.borrow_mut().push(format!("emit:{}", t.path));
            Ok(())
        },
        |p: String| trace.borrow_mut().push(format!("new:{p}")),
        |label: &str, g: Vec<String>| {
            trace
                .borrow_mut()
                .push(format!("send:{label}:{}", g.join(",")));
            Ok(())
        },
        |v: Value, _e: Option<String>| {
            trace
                .borrow_mut()
                .push(format!("log:{}", v["outcome"].as_str().unwrap_or("?")));
        },
    );
    assert_eq!(
        trace.into_inner(),
        vec![
            "send:main:/in/p2",
            "emit:/in/p1",
            "log:existing-window",
            "log:broadcast",
        ]
    );
}
