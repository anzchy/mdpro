//! D29-R4: when `emit` fails, the executor hands the emit error to `log`
//! alongside that path's context, so the new-window fallback is logged as a
//! failure with its reason. Every other entry is logged with `None`.
use super::execute_plan;
use crate::services::open_route::{
    plan_route, route_log_context, Outcome, RouteLookup, RouteTarget, Source,
};
use serde_json::Value;

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
        |t: &RouteTarget| {
            if t.window_label == "B" {
                Err(emit_error.to_string())
            } else {
                Ok(())
            }
        },
        |_p: String| {},
        |_g: Vec<String>| {},
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
        let unrouted = if has_docs {
            Outcome::NewWindow
        } else {
            Outcome::Broadcast
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
                (route_log_context(source, unrouted, None, 0), None),
            ],
            "{:?} has_docs={}",
            source,
            has_docs
        );
    }
}
