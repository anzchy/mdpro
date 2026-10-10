//! Test cases for `stat_snapshot`, `build_watch_register_log` and
//! `apply_watch_list` (D32 WI-3: w7-w12).
//!
//! Wired from `file_watcher_log.rs` with `#[cfg(test)] #[path = ...] mod register_tests;`.

use super::super::kinds_fixture::unique_path;
use super::{apply_watch_list, build_watch_register_log, stat_snapshot, FileStat, WatchOp};
use serde_json::{json, to_value, Value};
use std::fs::OpenOptions;
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

const B: &str = "/private/tmp/b.md";
const STAT: FileStat = FileStat {
    mtime_ms: 5,
    size: 7,
};

fn register_line(op: WatchOp, result: Result<(), String>) -> Value {
    to_value(build_watch_register_log(
        op,
        Path::new(B),
        result,
        true,
        Some(STAT),
        3,
    ))
    .unwrap()
}

#[test]
fn w7_stat_snapshot_round_trips_size_and_mtime_without_disturbing_the_file() {
    let f = unique_path("w7");
    let file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&f)
        .unwrap();
    for n in [0_u64, 1, 4096] {
        for ms in [1_000_u64, 1_700_000_000_123] {
            file.set_len(n).unwrap();
            file.set_modified(UNIX_EPOCH + Duration::from_millis(ms))
                .unwrap();
            let want = Some(FileStat {
                mtime_ms: ms as i64,
                size: n,
            });
            let first = stat_snapshot(&f);
            let second = stat_snapshot(&f);
            assert_eq!(first, want, "n={n} ms={ms}");
            assert_eq!(second, first, "n={n} ms={ms}: snapshot must be idempotent");
            assert_eq!(std::fs::metadata(&f).unwrap().len(), n);
        }
    }
    let _ = std::fs::remove_file(&f);
}

#[test]
fn w8_missing_path_yields_none() {
    assert_eq!(stat_snapshot(&unique_path("w8")), None);
    let gone = unique_path("w8gone");
    std::fs::write(&gone, b"x").unwrap();
    std::fs::remove_file(&gone).unwrap();
    assert_eq!(stat_snapshot(&gone), None);
}

#[test]
fn w9_op_by_ok_grid_exact_payloads() {
    let err = || Err("No path was found.".to_string());
    assert_eq!(
        register_line(WatchOp::Register, Ok(())),
        json!({"level":"info","event":"file.watch.register","status":"success","actionId":null,
            "context":{"path":B,"ok":true,"alreadyWatched":true,"mtimeMs":5,"size":7,"watchedCount":3},
            "durationMs":null,"error":null})
    );
    assert_eq!(
        register_line(WatchOp::Register, err()),
        json!({"level":"error","event":"file.watch.register","status":"fail","actionId":null,
            "context":{"path":B,"ok":false,"error":"No path was found.","alreadyWatched":true,
            "mtimeMs":5,"size":7,"watchedCount":3},
            "durationMs":null,"error":"No path was found."})
    );
    assert_eq!(
        register_line(WatchOp::Unregister, Ok(())),
        json!({"level":"info","event":"file.watch.unregister","status":"success","actionId":null,
            "context":{"path":B,"ok":true,"alreadyWatched":true,"mtimeMs":5,"size":7,"watchedCount":3},
            "durationMs":null,"error":null})
    );
    assert_eq!(
        register_line(WatchOp::Unregister, err()),
        json!({"level":"warn","event":"file.watch.unregister","status":"fail","actionId":null,
            "context":{"path":B,"ok":false,"error":"No path was found.","alreadyWatched":true,
            "mtimeMs":5,"size":7,"watchedCount":3},
            "durationMs":null,"error":"No path was found."})
    );
    for (op, ok, keys) in [
        (WatchOp::Register, true, 6),
        (WatchOp::Register, false, 7),
        (WatchOp::Unregister, true, 6),
        (WatchOp::Unregister, false, 7),
    ] {
        let line = register_line(op, if ok { Ok(()) } else { err() });
        let n = line["context"].as_object().map_or(0, |o| o.len());
        assert_eq!(n, keys, "{op:?} ok={ok}: {line}");
    }
}

#[test]
fn w10_register_with_no_stat_keeps_null_keys() {
    let line = to_value(build_watch_register_log(
        WatchOp::Register,
        Path::new(B),
        Ok(()),
        false,
        None,
        1,
    ))
    .unwrap();
    assert_eq!(
        line["context"],
        json!({"path":B,"ok":true,"alreadyWatched":false,"mtimeMs":null,"size":null,"watchedCount":1})
    );
}

#[test]
fn w11_list_bookkeeping_is_idempotent_and_round_trips() {
    let mut list: Vec<String> = Vec::new();
    let (r, u) = (WatchOp::Register, WatchOp::Unregister);
    let script = [
        (r, "a", (false, 1), vec!["a"]),
        (r, "a", (true, 1), vec!["a"]),
        (r, "b", (false, 2), vec!["a", "b"]),
        (u, "a", (true, 1), vec!["b"]),
        (u, "a", (false, 1), vec!["b"]),
        (r, "a", (false, 2), vec!["b", "a"]),
        (u, "c", (false, 2), vec!["b", "a"]),
    ];
    for (i, (op, path, want, after)) in script.into_iter().enumerate() {
        assert_eq!(
            apply_watch_list(&mut list, path, op),
            want,
            "step {i}: {op:?} {path}"
        );
        assert_eq!(list, after, "step {i}: list after {op:?} {path}");
    }
}

#[test]
fn w12_already_watched_is_measured_before_mutation() {
    let mut present = vec!["a".to_string()];
    assert_eq!(
        apply_watch_list(&mut present, "a", WatchOp::Unregister),
        (true, 0)
    );
    assert!(present.is_empty());
    let mut absent: Vec<String> = Vec::new();
    assert_eq!(
        apply_watch_list(&mut absent, "a", WatchOp::Unregister),
        (false, 0)
    );
    assert!(absent.is_empty());
}

/// w15 (D86 WI-3): the register line carries the store's outcome as
/// `context.baseline`, one exact string per `BaselineLog` value.
#[test]
fn w15_register_line_carries_baseline_outcome() {
    use super::{with_baseline, BaselineLog};
    for (outcome, want) in [
        (BaselineLog::Seeded, "seeded"),
        (BaselineLog::Snapshot, "snapshot"),
        (BaselineLog::FailOpen, "failopen"),
        (BaselineLog::StaleSkipped, "stale_skipped"),
    ] {
        let line = build_watch_register_log(
            WatchOp::Register,
            Path::new(B),
            Ok(()),
            true,
            Some(STAT),
            3,
        );
        let got = to_value(with_baseline(line, outcome)).unwrap();
        assert_eq!(
            got,
            json!({
                "level": "info",
                "event": "file.watch.register",
                "status": "success",
                "actionId": null,
                "context": {
                    "path": B,
                    "ok": true,
                    "alreadyWatched": true,
                    "mtimeMs": 5,
                    "size": 7,
                    "watchedCount": 3,
                    "baseline": want,
                },
                "durationMs": null,
                "error": null,
            }),
            "{outcome:?}"
        );
        assert_eq!(got["context"].as_object().unwrap().len(), 7, "{outcome:?}");
    }
}
