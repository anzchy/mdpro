//! Test cases for `build_watch_event_log` (D32 WI-3: w1-w6).
//!
//! Wired from `file_watcher_log.rs` with `#[cfg(test)] #[path = ...] mod event_tests;`,
//! so `super` is the log module and `super::super` is `file_watcher`.

use super::super::baseline::BaselineStore;
use super::super::kinds_fixture::{all_event_kinds, unique_path, T};
use super::super::{process_event, FileChangedEvent, WatchOutcome};
use super::{build_watch_event_log, classify_event_kind, stat_snapshot, FileStat};
use crate::models::log_entry::{LogLevel, LogStatus};
use notify::event::{DataChange, Flag, MetadataKind, ModifyKind};
use notify::{Event, EventKind};
use serde_json::{json, to_string, to_value, Value};
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;

const KEYS: [&str; 12] = [
    "kind",
    "detail",
    "outcome",
    "changeType",
    "path",
    "pathCount",
    "info",
    "rescan",
    "ownEvent",
    "mtimeMs",
    "size",
    "timestamp",
];

fn ev(kind: EventKind, paths: &[PathBuf]) -> Event {
    paths
        .iter()
        .fold(Event::new(kind), |e, p| e.add_path(p.clone()))
}

fn changed(path: &str, change_type: &str) -> FileChangedEvent {
    FileChangedEvent {
        path: path.to_string(),
        change_type: change_type.to_string(),
        new_path: None,
        timestamp: T,
    }
}

/// The whole outcome domain with its expected status and changeType.
fn outcome_table() -> Vec<(WatchOutcome, LogStatus, Option<&'static str>)> {
    use LogStatus::{Cancel, Success};
    use WatchOutcome::*;
    vec![
        (EmittedModified, Success, Some("modified")),
        (EmittedDeleted, Success, Some("deleted")),
        (EmittedRenamed, Success, Some("renamed")),
        (Debounced, Cancel, None),
        (SelfWrite, Cancel, None),
        (IgnoredKind, Cancel, None),
        (IgnoredNoPath, Cancel, None),
        (IgnoredRenameSinglePath, Cancel, None),
        (IgnoredUnchanged, Cancel, None),
    ]
}

#[test]
fn w1_emitted_metadata_extended_line_is_exact() {
    let path = "/private/tmp/b.md";
    let e = ev(
        EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended)),
        &[PathBuf::from(path)],
    );
    let emitted = changed(path, "modified");
    let stat = Some(FileStat {
        mtime_ms: 1_700_000_000_123,
        size: 42,
    });
    let line = build_watch_event_log(&e, WatchOutcome::EmittedModified, Some(&emitted), stat, T);
    assert_eq!(
        to_value(&line).unwrap(),
        json!({"level":"info","event":"file.watch.event","status":"success","actionId":null,
            "context":{"kind":"modify_metadata","detail":"extended","outcome":"emitted_modified",
            "changeType":"modified","path":"/private/tmp/b.md","pathCount":1,"info":null,
            "rescan":false,"ownEvent":false,"mtimeMs":1700000000123_i64,"size":42,
            "timestamp":1700000000777_i64},"durationMs":null,"error":null})
    );
}

#[test]
fn w_ignored_unchanged_line_is_exact() {
    let o = WatchOutcome::ALL
        .into_iter()
        .find(|o| o.as_str() == "ignored_unchanged")
        .expect("ALL has no outcome named ignored_unchanged");
    assert_eq!(o, WatchOutcome::IgnoredUnchanged);
    let path = "/private/tmp/b.md";
    let e = ev(
        EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended)),
        &[PathBuf::from(path)],
    );
    let stat = Some(FileStat {
        mtime_ms: 1_700_000_000_123,
        size: 42,
    });
    let line = build_watch_event_log(&e, o, None, stat, T);
    assert_eq!(
        to_value(&line).unwrap(),
        json!({"level":"info","event":"file.watch.event","status":"cancel","actionId":null,
            "context":{"kind":"modify_metadata","detail":"extended",
            "outcome":"ignored_unchanged","changeType":null,"path":"/private/tmp/b.md",
            "pathCount":1,"info":null,"rescan":false,"ownEvent":false,
            "mtimeMs":1700000000123_i64,"size":42,"timestamp":1700000000777_i64},
            "durationMs":null,"error":null})
    );
}

#[test]
fn w2_status_and_change_type_over_all_outcomes() {
    let table = outcome_table();
    assert_eq!(table.len(), WatchOutcome::ALL.len());
    for (o, status, change_type) in table {
        let e = ev(
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            &[PathBuf::from("/tmp/w2.md")],
        );
        let emitted = change_type.map(|ct| changed("/tmp/w2.md", ct));
        let line = build_watch_event_log(&e, o, emitted.as_ref(), None, T);
        let ctx = line.context.clone().unwrap_or(Value::Null);
        assert_eq!(line.status, status, "{o:?}");
        assert_eq!(line.level, LogLevel::Info, "{o:?}");
        assert_eq!(ctx["outcome"], json!(o.as_str()), "{o:?}");
        assert_eq!(
            ctx["changeType"],
            change_type.map_or(Value::Null, |ct| json!(ct)),
            "{o:?}"
        );
    }
}

#[test]
fn w3_key_set_is_invariant_over_the_grid() {
    let allow: BTreeSet<String> = KEYS.iter().map(|k| k.to_string()).collect();
    let stat = FileStat {
        mtime_ms: 9,
        size: 3,
    };
    for (o, _, change_type) in outcome_table() {
        for stat in [Some(stat), None] {
            for info in [Some("meta: finder info"), None] {
                for pid in [Some(4242_u32), None] {
                    for n in 0..=2usize {
                        let paths: Vec<PathBuf> = (0..n).map(|_| unique_path("w3")).collect();
                        let mut e = ev(EventKind::Modify(ModifyKind::Any), &paths);
                        if let Some(i) = info {
                            e = e.set_info(i);
                        }
                        if let Some(p) = pid {
                            e = e.set_process_id(p);
                        }
                        let emitted = match (change_type, paths.first()) {
                            (Some(ct), Some(p)) => Some(changed(&p.to_string_lossy(), ct)),
                            _ => None,
                        };
                        let line = build_watch_event_log(&e, o, emitted.as_ref(), stat, T);
                        let tag = format!("{o:?} {stat:?} {info:?} {pid:?} n={n}");
                        let ctx = line.context.clone().unwrap_or(Value::Null);
                        let keys: BTreeSet<String> = ctx
                            .as_object()
                            .map(|m| m.keys().cloned().collect())
                            .unwrap_or_default();
                        assert_eq!(keys, allow, "{tag}");
                        assert_eq!(ctx["pathCount"], json!(n), "{tag}");
                        let want_path = paths.first().map_or(Value::Null, |p| json!(p));
                        assert_eq!(ctx["path"], want_path, "{tag}");
                        assert_eq!(ctx["mtimeMs"].is_null(), stat.is_none(), "{tag}");
                        assert_eq!(ctx["size"].is_null(), stat.is_none(), "{tag}");
                        assert_eq!(ctx["timestamp"], json!(T), "{tag}");
                        assert_eq!(line.error, None, "{tag}");
                    }
                }
            }
        }
    }
}

#[test]
fn w4_attrs_pass_through_in_both_partitions() {
    let kind = EventKind::Modify(ModifyKind::Metadata(MetadataKind::Other));
    let p = PathBuf::from("/tmp/w4.md");
    let bare = ev(kind, &[p.clone()]);
    let rich = bare
        .clone()
        .set_info("meta: finder info")
        .set_process_id(4242)
        .set_flag(Flag::Rescan);
    let rich_ctx = build_watch_event_log(&rich, WatchOutcome::Debounced, None, None, T).context;
    let rich_ctx = rich_ctx.unwrap_or(Value::Null);
    assert_eq!(rich_ctx["info"], json!("meta: finder info"));
    assert_eq!(rich_ctx["ownEvent"], json!(true));
    assert_eq!(rich_ctx["rescan"], json!(true));
    let bare_ctx = build_watch_event_log(&bare, WatchOutcome::Debounced, None, None, T).context;
    let bare_ctx = bare_ctx.unwrap_or(Value::Null);
    assert_eq!(bare_ctx["info"], Value::Null);
    assert_eq!(bare_ctx["ownEvent"], json!(false));
    assert_eq!(bare_ctx["rescan"], json!(false));
}

#[test]
fn w5_builder_agrees_with_routing_and_classification() {
    for kind in all_event_kinds() {
        for n in 0..=2usize {
            let paths: Vec<PathBuf> = (0..n).map(|_| unique_path("w5")).collect();
            let e = ev(kind, &paths);
            let (em, o) = process_event(
                &e,
                &Mutex::new(HashMap::new()),
                &BaselineStore::default(),
                T,
            );
            let line = build_watch_event_log(&e, o, em.as_ref(), None, T);
            let ctx = line.context.clone().unwrap_or(Value::Null);
            let class = classify_event_kind(&kind);
            let tag = format!("{kind:?} x {n}");
            assert_eq!(ctx["kind"], json!(class.kind), "{tag}");
            assert_eq!(ctx["detail"], json!(class.detail), "{tag}");
            assert_eq!(ctx["outcome"], json!(o.as_str()), "{tag}");
            let want_ct = em.as_ref().map_or(Value::Null, |x| json!(x.change_type));
            assert_eq!(ctx["changeType"], want_ct, "{tag}");
            if let Some(em) = &em {
                assert_eq!(ctx["timestamp"], json!(em.timestamp), "{tag}");
            }
            assert_eq!(ctx["timestamp"], json!(T), "{tag}");
        }
    }
}

#[test]
fn w6_no_file_content_leaks_into_the_line() {
    let f = unique_path("w6");
    std::fs::write(&f, "D32-SECRET-BODY-9c1e").unwrap();
    let stat = stat_snapshot(&f);
    let e = ev(
        EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        &[f.clone()],
    );
    let emitted = changed(&f.to_string_lossy(), "modified");
    let line = build_watch_event_log(&e, WatchOutcome::EmittedModified, Some(&emitted), stat, T);
    let _ = std::fs::remove_file(&f);
    let text = to_string(&line).unwrap();
    assert!(!text.contains("D32-SECRET-BODY"), "content leaked: {text}");
    assert!(!text.contains("\"content\":"), "content key: {text}");
    let ctx = line.context.clone().unwrap_or(Value::Null);
    assert_eq!(
        ctx["size"],
        json!(20),
        "stat must really read the file: {text}"
    );
}
