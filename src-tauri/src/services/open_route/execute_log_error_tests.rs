//! D29-R4: when `emit` fails, the executor hands the emit error to `log`
//! alongside that path's context, so the new-window fallback is logged as a
//! failure with its reason. Every other entry is logged with `None`.
//! D279 WI-2: a broadcast path with no live window, or whose send failed,
//! is logged with that error too (EX-2, EX-3).
use super::execute_plan;
use crate::menu::menu_target::{CancelReason, Resolved, Via};
use crate::models::{LogLevel, LogStatus};
use crate::services::open_route::plan::broadcast_route_log_context;
use crate::services::open_route::{
    plan_route, route_log_context, route_log_severity, Outcome, RouteLookup, RouteTarget, Source,
};
use serde_json::{json, Value};

fn hit(label: &str, id: &str, path: &str, mc: usize) -> Result<RouteLookup, String> {
    Ok(RouteLookup {
        target: Some(RouteTarget {
            window_label: label.to_string(),
            document_id: id.to_string(),
            path: path.to_string(),
        }),
        match_count: mc,
    })
}

fn miss() -> Result<RouteLookup, String> {
    Ok(RouteLookup {
        target: None,
        match_count: 0,
    })
}

fn main_focused() -> Resolved {
    Ok(("main".to_string(), Via::Focused))
}

/// Execute with an `emit` that fails for label `B` with `emit_error`, and
/// return every (context, error) pair `log` received, in order.
fn logs_for(source: Source, has_docs: bool, emit_error: &str) -> Vec<(Value, Option<String>)> {
    let lookups: Vec<(String, Result<RouteLookup, String>)> = vec![
        ("p1".to_string(), hit("A", "id-1", "p1", 1)),
        ("p2".to_string(), hit("B", "id-2", "p2", 2)),
        ("p3".to_string(), miss()),
    ];
    let plan = plan_route(source, &lookups, has_docs);
    let mut logs = Vec::new();
    execute_plan(
        &plan,
        source,
        &main_focused(),
        |t: &RouteTarget| {
            if t.window_label == "B" {
                Err(emit_error.to_string())
            } else {
                Ok(())
            }
        },
        |_p: String| {},
        |_label: &str, _g: Vec<String>| Ok(()),
        |v: Value, e: Option<String>| logs.push((v, e)),
    );
    logs
}

#[test]
fn failed_emit_fallback_log_carries_the_emit_error_text() {
    for (source, has_docs) in [
        (Source::Finder, true),
        (Source::SingleInstance, true),
        (Source::SingleInstance, false),
    ] {
        let logs = logs_for(source, has_docs, "emit_to failed: channel closed");
        // D279 Q3: an unrouted path's broadcast line names the one window
        // the group went to (`main`, focused) and its `via`.
        let unrouted = if has_docs {
            route_log_context(source, Outcome::NewWindow, None, 0)
        } else {
            broadcast_route_log_context(source, &main_focused(), 0)
        };
        assert_eq!(
            logs,
            vec![
                (
                    route_log_context(source, Outcome::ExistingWindow, Some("A"), 1),
                    None
                ),
                (
                    route_log_context(source, Outcome::NewWindow, None, 2),
                    Some("emit_to failed: channel closed".to_string())
                ),
                (unrouted, None),
            ],
            "{:?} has_docs={}",
            source,
            has_docs
        );
    }
}

/// What the broadcast cases record: sends, new windows, (context, error).
type Record = (
    Vec<(String, Vec<String>)>,
    Vec<String>,
    Vec<(Value, Option<String>)>,
);

/// Two unrouted paths, single instance with no documents: both broadcast.
fn run_broadcast(target: &Resolved, send_err: Option<&str>) -> Record {
    let lookups: Vec<(String, Result<RouteLookup, String>)> =
        vec![("p1".to_string(), miss()), ("p2".to_string(), miss())];
    let plan = plan_route(Source::SingleInstance, &lookups, false);
    let (mut sends, mut new_windows, mut logs) = (Vec::new(), Vec::new(), Vec::new());
    execute_plan(
        &plan,
        Source::SingleInstance,
        target,
        |_t: &RouteTarget| Ok(()),
        |p: String| new_windows.push(p),
        |label: &str, g: Vec<String>| {
            sends.push((label.to_string(), g));
            send_err.map_or(Ok(()), |e| Err(e.to_string()))
        },
        |v: Value, e: Option<String>| logs.push((v, e)),
    );
    (sends, new_windows, logs)
}

// EX-2 (D279 Q1): no live window, so nothing is sent or opened, and each
// path is logged Warn/Fail with `no_live_window`.
#[test]
fn d279_no_live_window_drops_and_logs_each_path() {
    let (sends, new_windows, logs) = run_broadcast(&Err(CancelReason::NoLiveWindow), None);
    assert_eq!(sends, vec![]);
    assert_eq!(new_windows, Vec::<String>::new());
    let line = json!({"source":"single_instance","outcome":"broadcast",
        "windowLabel":null,"matchCount":0,"via":null});
    let err = Some("no_live_window".to_string());
    assert_eq!(logs, vec![(line.clone(), err.clone()), (line, err)]);
    for (ctx, e) in &logs {
        assert_eq!(
            route_log_severity(ctx, e.as_deref()),
            (LogLevel::Warn, LogStatus::Fail)
        );
    }
}

// EX-3 (D279 R2): a failed send is tried once, then each path opens in a
// new window; the line keeps the resolved `via` and the error verbatim.
#[test]
fn d279_failed_send_falls_back_to_a_new_window_per_path() {
    let target = Ok(("main".to_string(), Via::Focused));
    let (sends, new_windows, logs) = run_broadcast(&target, Some("send-err-main"));
    assert_eq!(
        sends,
        vec![("main".to_string(), vec!["p1".to_string(), "p2".to_string()])]
    );
    assert_eq!(new_windows, vec!["p1".to_string(), "p2".to_string()]);
    let line = json!({"source":"single_instance","outcome":"new-window",
        "windowLabel":null,"matchCount":0,"via":"focused"});
    let err = Some("send-err-main".to_string());
    assert_eq!(logs, vec![(line.clone(), err.clone()), (line, err)]);
}
