//! Composition and wiring tests for `services::file_watcher` (D32 WI-3:
//! o16, o17, o18, w14).
//!
//! Wired from `file_watcher.rs` with `#[cfg(test)] #[path = ...] mod observe_tests;`.
//! o16/o17 prove `observe_event` is exactly process → stat → build with one
//! shared timestamp; o18/w14 are source tripwires proving `handle_event`,
//! `watch` and `unwatch` log unconditionally through the tested units.

use super::kinds_fixture::{
    all_event_kinds, code_lines, fn_slice, stat_spy, unique_path, WriteMark, SPY_STAT, T,
};
use super::watch_log::build_watch_event_log;
use super::{observe_event, process_event, WatchOutcome};
use crate::models::log_entry::LogStatus;
use notify::event::{DataChange, MetadataKind, ModifyKind};
use notify::{Event, EventKind};
use serde_json::{json, to_value, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

type Map = Mutex<HashMap<PathBuf, Instant>>;

const SRC: &str = include_str!("file_watcher.rs");

fn fresh() -> Map {
    Mutex::new(HashMap::new())
}

fn is_emitted(o: WatchOutcome) -> bool {
    matches!(
        o,
        WatchOutcome::EmittedModified | WatchOutcome::EmittedDeleted | WatchOutcome::EmittedRenamed
    )
}

fn event_on(kind: EventKind, paths: &[PathBuf]) -> Event {
    paths
        .iter()
        .fold(Event::new(kind), |e, p| e.add_path(p.clone()))
}

fn code_of(anchor: &str) -> String {
    code_lines(fn_slice(SRC, anchor))
        .collect::<Vec<_>>()
        .join("\n")
}

fn leading_ws(s: &str, idx: usize) -> String {
    let line_start = s[..idx].rfind('\n').map_or(0, |i| i + 1);
    s[line_start..]
        .chars()
        .take_while(|c| c.is_whitespace())
        .collect()
}

#[test]
fn o16_observe_event_is_process_then_stat_then_build() {
    for kind in all_event_kinds() {
        for n in 0..=2usize {
            let paths: Vec<PathBuf> = (0..n).map(|_| unique_path("o16")).collect();
            let e = event_on(kind, &paths);
            let (calls, spy) = stat_spy();
            let (em, line) = observe_event(&e, &fresh(), T, spy);
            let (em_ref, o_ref) = process_event(&e, &fresh(), T);
            let tag = format!("{kind:?} x {n} paths");

            assert_eq!(line.event, "file.watch.event", "{tag}");
            assert_eq!(to_value(&em).unwrap(), to_value(&em_ref).unwrap(), "{tag}");
            let ctx = line.context.clone().unwrap_or(Value::Null);
            assert_eq!(ctx["outcome"], json!(o_ref.as_str()), "{tag}");

            let calls = calls.borrow().clone();
            let stat_seen = if calls.is_empty() {
                None
            } else {
                Some(SPY_STAT)
            };
            let reference = build_watch_event_log(&e, o_ref, em_ref.as_ref(), stat_seen, T);
            assert_eq!(
                to_value(&line).unwrap(),
                to_value(&reference).unwrap(),
                "{tag}"
            );

            assert!(calls.len() <= 1, "{tag}: stat_of called {calls:?}");
            if calls.len() == 1 {
                assert_eq!(calls[0], paths[0], "{tag}: stat_of must get paths[0]");
            }
            if n == 0 {
                assert!(calls.is_empty(), "{tag}: no path, no stat");
            }
            if is_emitted(o_ref) {
                assert_eq!(calls.len(), 1, "{tag}: emitted must be stat'ed");
                assert_eq!(ctx["mtimeMs"], json!(4242), "{tag}");
                assert_eq!(ctx["size"], json!(17), "{tag}");
            }
            if let Some(em) = &em {
                assert_eq!(em.timestamp, T, "{tag}");
                assert_eq!(ctx["timestamp"], json!(em.timestamp), "{tag}");
            }
        }
    }
}

#[test]
fn o17_sequence_on_one_map_logs_each_step_with_its_own_outcome() {
    let map = fresh();
    let p = unique_path("o17");
    let content = EventKind::Modify(ModifyKind::Data(DataChange::Content));
    let extended = EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended));
    let entry = |m: &Map| m.lock().unwrap().get(&p).copied();

    let (_c1, spy1) = stat_spy();
    let (em1, line1) = observe_event(&event_on(content, &[p.clone()]), &map, T, spy1);
    let ctx1 = line1.context.clone().unwrap_or(Value::Null);
    assert_eq!(
        to_value(&em1).unwrap(),
        json!({"path": p.to_string_lossy(), "changeType": "modified", "newPath": null, "timestamp": T})
    );
    assert_eq!(line1.status, LogStatus::Success);
    assert_eq!(ctx1["outcome"], json!("emitted_modified"));
    assert_eq!(ctx1["timestamp"], json!(T));
    assert_eq!(ctx1["mtimeMs"], json!(4242));
    let after_1 = entry(&map);
    assert!(after_1.is_some(), "step 1 must record a debounce entry");

    let (_c2, spy2) = stat_spy();
    let (em2, line2) = observe_event(&event_on(extended, &[p.clone()]), &map, T + 1, spy2);
    let ctx2 = line2.context.clone().unwrap_or(Value::Null);
    assert!(em2.is_none(), "step 2 must be debounced");
    assert_eq!(line2.status, LogStatus::Cancel);
    assert_eq!(ctx2["outcome"], json!("debounced"));
    assert_eq!(ctx2["timestamp"], json!(T + 1));
    assert_eq!(ctx2["kind"], json!("modify_metadata"));
    assert_eq!(ctx2["detail"], json!("extended"));
    assert_eq!(entry(&map), after_1, "debounce must not refresh the entry");

    let _g = WriteMark::new(&p);
    let (_c3, spy3) = stat_spy();
    let (em3, line3) = observe_event(&event_on(content, &[p.clone()]), &map, T + 2, spy3);
    let ctx3 = line3.context.clone().unwrap_or(Value::Null);
    assert!(em3.is_none(), "step 3 must be a self-write");
    assert_eq!(line3.status, LogStatus::Cancel);
    assert_eq!(ctx3["outcome"], json!("self_write"));
    assert_eq!(ctx3["timestamp"], json!(T + 2));
    assert_eq!(entry(&map), after_1, "self-write must not touch the map");
}

#[test]
fn o18_handle_event_logs_exactly_once_and_unconditionally() {
    let s = code_of("fn handle_event");
    assert!(!s.trim().is_empty(), "handle_event slice is empty");
    assert_eq!(s.matches("log_event(").count(), 1, "{s}");
    assert_eq!(s.matches("observe_event(").count(), 1, "{s}");
    assert_eq!(s.matches("SystemTime::now()").count(), 1, "{s}");
    assert!(
        !s.contains("match "),
        "routing belongs in process_event: {s}"
    );
    assert!(
        !s.contains("process_event("),
        "route once, inside observe_event: {s}"
    );

    let obs = s.find("observe_event(").unwrap();
    let log = s.find("log_event(").unwrap();
    let emit = s
        .find("emit_file_changed(")
        .unwrap_or_else(|| panic!("no emit_file_changed( in {s}"));
    assert!(
        obs < log && log < emit,
        "order must be observe < log < emit: {s}"
    );

    let call_end = s[obs..].find(';').map_or(s.len(), |i| obs + i);
    assert!(
        s[obs..call_end].contains("stat_snapshot"),
        "production must pass stat_snapshot: {s}"
    );
    for token in ["return;", "return ", "return("] {
        assert!(!s[..log].contains(token), "`{token}` before the log: {s}");
    }
    assert_eq!(leading_ws(&s, obs), leading_ws(&s, log), "{s}");
    for gate in ["if ", "else", ".map(", ".and_then(", ".inspect(", "{"] {
        assert!(
            !s[obs..log].contains(gate),
            "`{gate}` between observe_event and log_event: {s}"
        );
    }
}

#[test]
fn w14_watch_and_unwatch_delegate_to_apply_watch_and_log() {
    for (anchor, op, signature) in [
        (
            "pub fn watch(",
            "WatchOp::Register",
            "pub fn watch(&self, path: &Path)",
        ),
        (
            "pub fn unwatch(",
            "WatchOp::Unregister",
            "pub fn unwatch(&self, path: &Path)",
        ),
    ] {
        let s = code_of(anchor);
        assert_eq!(s.matches("apply_watch(").count(), 1, "{s}");
        assert!(s.contains(op), "{anchor} must pass {op}: {s}");
        assert_eq!(s.matches("log_event(").count(), 1, "{s}");
        assert!(
            s.find("log_event(") > s.find("apply_watch("),
            "log after apply_watch: {s}"
        );
        assert!(!s.contains("let _ = watcher."), "Result discarded: {s}");
        assert!(
            !s.contains(".watch(path") && !s.contains(".unwatch(path"),
            "direct notify call outside apply_watch: {s}"
        );
        assert!(s.contains(signature), "signature changed: {s}");
    }
}
