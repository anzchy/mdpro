//! Tests for `open_route::plan_route` and `route_log_context` (D29 WI-3).
//! Pure; no mocks. The `lookup_all` tests live in `plan_lookup_all_tests.rs`.
use super::{plan_route, route_log_context, Outcome, PlanEntry, RoutePlan, Source};
use crate::services::open_route::{RouteLookup, RouteTarget};
use serde_json::json;

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

fn err() -> Result<RouteLookup, String> {
    Err("poisoned".to_string())
}

fn ew(path: &str, label: &str, id: &str, stored: &str, mc: usize) -> PlanEntry {
    PlanEntry::ExistingWindow {
        path: path.to_string(),
        target: target(label, id, stored),
        match_count: mc,
    }
}

fn nw(path: &str, mc: usize) -> PlanEntry {
    PlanEntry::NewWindow {
        path: path.to_string(),
        match_count: mc,
    }
}

fn bc(path: &str, mc: usize) -> PlanEntry {
    PlanEntry::Broadcast {
        path: path.to_string(),
        match_count: mc,
    }
}

fn plan(entries: Vec<PlanEntry>) -> RoutePlan {
    RoutePlan {
        entries,
        new_windows_refused: false,
    }
}

fn lk(items: Vec<(&str, Result<RouteLookup, String>)>) -> Lookups {
    items.into_iter().map(|(p, r)| (p.to_string(), r)).collect()
}

/// The three contexts: (source, has_windows_with_documents, name).
const CONTEXTS: [(Source, bool, &str); 3] = [
    (Source::Finder, true, "finder"),
    (Source::SingleInstance, true, "single_instance+docs"),
    (Source::SingleInstance, false, "single_instance-no-docs"),
];

#[test]
fn finder_mixed_paths_exact_plan() {
    let lookups = lk(vec![
        ("/in/p1", hit("mdpro-a", "id-1", "/s/p1", 1)),
        ("/in/p2", miss()),
        ("/in/p3", hit("mdpro-b", "id-3", "/s/p3", 2)),
    ]);
    assert_eq!(
        plan_route(Source::Finder, &lookups, true),
        plan(vec![
            ew("/in/p1", "mdpro-a", "id-1", "/s/p1", 1),
            nw("/in/p2", 0),
            ew("/in/p3", "mdpro-b", "id-3", "/s/p3", 2),
        ])
    );
}

#[test]
fn single_instance_docs_by_match_count_table() {
    let m1 = || hit("A", "id-1", "/s/p1", 1);
    let m2 = || hit("B", "id-2", "/s/p2", 3);
    let e1 = || ew("/in/p1", "A", "id-1", "/s/p1", 1);
    let e2 = || ew("/in/p2", "B", "id-2", "/s/p2", 3);
    // (has_docs, matched, lookups, expected)
    let rows: Vec<(bool, usize, Lookups, RoutePlan)> = vec![
        (
            true,
            0,
            lk(vec![("/in/p1", miss()), ("/in/p2", miss())]),
            plan(vec![nw("/in/p1", 0), nw("/in/p2", 0)]),
        ),
        (
            true,
            1,
            lk(vec![("/in/p1", m1()), ("/in/p2", miss())]),
            plan(vec![e1(), nw("/in/p2", 0)]),
        ),
        (
            true,
            2,
            lk(vec![("/in/p1", m1()), ("/in/p2", m2())]),
            plan(vec![e1(), e2()]),
        ),
        (
            false,
            0,
            lk(vec![("/in/p1", miss()), ("/in/p2", miss())]),
            plan(vec![bc("/in/p1", 0), bc("/in/p2", 0)]),
        ),
        (
            false,
            1,
            lk(vec![("/in/p1", m1()), ("/in/p2", miss())]),
            plan(vec![e1(), bc("/in/p2", 0)]),
        ),
        (
            false,
            2,
            lk(vec![("/in/p1", m1()), ("/in/p2", m2())]),
            plan(vec![e1(), e2()]),
        ),
    ];
    for (has_docs, matched, lookups, expected) in rows {
        assert_eq!(
            plan_route(Source::SingleInstance, &lookups, has_docs),
            expected,
            "has_docs={} matched={}",
            has_docs,
            matched
        );
    }
}

#[test]
fn finder_ignores_has_docs_flag() {
    let lookups = lk(vec![("/in/p1", miss())]);
    assert_eq!(
        plan_route(Source::Finder, &lookups, false),
        plan(vec![nw("/in/p1", 0)])
    );
}

#[test]
fn lookup_err_on_middle_path_falls_back_for_that_path_only() {
    let lookups = lk(vec![
        ("/in/p1", hit("A", "id-1", "/s/p1", 1)),
        ("/in/p2", err()),
        ("/in/p3", hit("B", "id-3", "/s/p3", 2)),
    ]);
    let e1 = ew("/in/p1", "A", "id-1", "/s/p1", 1);
    let e3 = ew("/in/p3", "B", "id-3", "/s/p3", 2);
    assert_eq!(
        plan_route(Source::Finder, &lookups, true),
        plan(vec![e1.clone(), nw("/in/p2", 0), e3.clone()]),
        "finder"
    );
    assert_eq!(
        plan_route(Source::SingleInstance, &lookups, false),
        plan(vec![e1, bc("/in/p2", 0), e3]),
        "single_instance without docs"
    );
}

/// Per-path scripted outcome for the conservation law.
#[derive(Debug, Clone, Copy)]
enum Scripted {
    Matched,
    Unmatched,
    Failed,
}

const SCRIPTED: [Scripted; 3] = [Scripted::Matched, Scripted::Unmatched, Scripted::Failed];

fn scripted_lookup(s: Scripted, i: usize) -> Result<RouteLookup, String> {
    match s {
        Scripted::Matched => hit(
            &format!("w{}", i),
            &format!("id-{}", i),
            &format!("/stored/p{}", i),
            i + 1,
        ),
        Scripted::Unmatched => miss(),
        Scripted::Failed => err(),
    }
}

/// The oracle for one input position under one context.
fn expected_entry(
    path: &str,
    lookup: &Result<RouteLookup, String>,
    source: Source,
    has_docs: bool,
) -> PlanEntry {
    if let Ok(RouteLookup {
        target: Some(t),
        match_count,
    }) = lookup
    {
        return PlanEntry::ExistingWindow {
            path: path.to_string(),
            target: t.clone(),
            match_count: *match_count,
        };
    }
    let mc = lookup.as_ref().map(|l| l.match_count).unwrap_or(0);
    if source == Source::SingleInstance && !has_docs {
        bc(path, mc)
    } else {
        nw(path, mc)
    }
}

fn entry_path(e: &PlanEntry) -> &str {
    match e {
        PlanEntry::ExistingWindow { path, .. } => path,
        PlanEntry::NewWindow { path, .. } => path,
        PlanEntry::Broadcast { path, .. } => path,
        PlanEntry::Refused { path, .. } => path,
    }
}

#[test]
fn conservation_and_order_exhaustive() {
    let paths = ["/in/p0", "/in/p1", "/in/p2"];
    for (source, has_docs, ctx) in CONTEXTS {
        for s0 in SCRIPTED {
            for s1 in SCRIPTED {
                for s2 in SCRIPTED {
                    let cell = format!("{} {:?}/{:?}/{:?}", ctx, s0, s1, s2);
                    let lookups: Lookups = [s0, s1, s2]
                        .iter()
                        .enumerate()
                        .map(|(i, s)| (paths[i].to_string(), scripted_lookup(*s, i)))
                        .collect();
                    let got = plan_route(source, &lookups, has_docs);
                    // Conservation and order: one entry per input path, in input order.
                    let got_paths: Vec<&str> = got.entries.iter().map(entry_path).collect();
                    assert_eq!(got_paths, paths.to_vec(), "{}", cell);
                    // Each entry: its own lookup's target and match_count.
                    for (i, (p, l)) in lookups.iter().enumerate() {
                        assert_eq!(
                            got.entries[i],
                            expected_entry(p, l, source, has_docs),
                            "{} path {}",
                            cell,
                            i
                        );
                    }
                    // Broadcast only in the single-instance-without-docs context.
                    let any_broadcast = got
                        .entries
                        .iter()
                        .any(|e| matches!(e, PlanEntry::Broadcast { .. }));
                    if any_broadcast {
                        assert!(source == Source::SingleInstance && !has_docs, "{}", cell);
                    }
                }
            }
        }
        // Duplicate input row: [a, a, b]; a is matched, b is not.
        let lookups = lk(vec![
            ("/in/a", hit("wa", "id-a", "/stored/a", 1)),
            ("/in/a", hit("wa", "id-a", "/stored/a", 1)),
            ("/in/b", miss()),
        ]);
        let got = plan_route(source, &lookups, has_docs);
        let got_paths: Vec<&str> = got.entries.iter().map(entry_path).collect();
        assert_eq!(
            got_paths,
            vec!["/in/a", "/in/a", "/in/b"],
            "{} duplicate row",
            ctx
        );
        assert_eq!(
            got_paths.iter().filter(|p| **p == "/in/a").count(),
            2,
            "{} duplicate row",
            ctx
        );
    }
}

#[test]
fn empty_input_plans_nothing() {
    for (source, has_docs, ctx) in CONTEXTS {
        assert_eq!(plan_route(source, &[], has_docs), plan(vec![]), "{}", ctx);
    }
}

#[test]
// D279 Q3: every `file.open.route` line gains `via`; for these calls,
// which resolve no target, it is null. Recorded literals edited for that reason.
fn route_log_context_exact_json_per_outcome() {
    assert_eq!(
        route_log_context(Source::Finder, Outcome::ExistingWindow, Some("mdpro-a"), 2),
        json!({"source":"finder","outcome":"existing-window","windowLabel":"mdpro-a","matchCount":2,"via":null})
    );
    assert_eq!(
        route_log_context(Source::SingleInstance, Outcome::NewWindow, None, 0),
        json!({"source":"single_instance","outcome":"new-window","windowLabel":null,"matchCount":0,"via":null})
    );
    assert_eq!(
        route_log_context(Source::SingleInstance, Outcome::Broadcast, None, 0),
        json!({"source":"single_instance","outcome":"broadcast","windowLabel":null,"matchCount":0,"via":null})
    );
}
