//! Test cases for `build_watch_error_log` and its wiring into the notify
//! callback (D32 follow-up L1: e1-e5).
//!
//! Wired from `file_watcher_log.rs` with `#[cfg(test)] #[path = ...] mod error_tests;`.

use super::super::kinds_fixture::{code_lines, fn_slice};
use super::build_watch_error_log;
use notify::{Config, Error, ErrorKind};
use serde_json::{json, to_value, Value};
use std::collections::HashSet;
use std::io;
use std::path::PathBuf;

const B: &str = "/private/tmp/b.md";
const WATCHER_SRC: &str = include_str!("file_watcher.rs");

fn line(err: &Error) -> Value {
    to_value(build_watch_error_log(err)).unwrap()
}

/// One error per `notify::ErrorKind` variant (notify 6.1.1 has six).
fn one_of_each_kind() -> Vec<Error> {
    vec![
        Error::generic("boom"),
        Error::io(io::Error::new(io::ErrorKind::PermissionDenied, "denied")),
        Error::path_not_found(),
        Error::watch_not_found(),
        Error::invalid_config(&Config::default()),
        Error::new(ErrorKind::MaxFilesWatch),
    ]
}

#[test]
fn e1_generic_without_paths_exact_payload() {
    assert_eq!(
        line(&Error::generic("boom")),
        json!({"level":"warn","event":"file.watch.error","status":"fail","actionId":null,
            "context":{"errorKind":"generic","paths":[]},
            "durationMs":null,"error":"boom"})
    );
}

#[test]
fn e2_path_not_found_with_a_path_exact_payload() {
    let err = Error::path_not_found().add_path(PathBuf::from(B));
    assert_eq!(
        line(&err),
        json!({"level":"warn","event":"file.watch.error","status":"fail","actionId":null,
            "context":{"errorKind":"path_not_found","paths":[B]},
            "durationMs":null,"error":"No path was found. about [\"/private/tmp/b.md\"]"})
    );
}

#[test]
fn e3_error_kind_vocabulary_is_closed_and_injective() {
    let want = [
        "generic",
        "io",
        "path_not_found",
        "watch_not_found",
        "invalid_config",
        "max_files_watch",
    ];
    let got: Vec<String> = one_of_each_kind()
        .iter()
        .map(|e| {
            line(e)["context"]["errorKind"]
                .as_str()
                .unwrap_or("")
                .to_string()
        })
        .collect();
    assert_eq!(got, want);
    assert_eq!(got.iter().collect::<HashSet<_>>().len(), want.len());
}

#[test]
fn e4_every_kind_has_the_same_shape_and_carries_paths_in_order() {
    let second = "/private/tmp/c d.md";
    for err in one_of_each_kind() {
        let err = err
            .add_path(PathBuf::from(B))
            .add_path(PathBuf::from(second));
        let l = line(&err);
        assert_eq!(l["level"], "warn", "{l}");
        assert_eq!(l["event"], "file.watch.error", "{l}");
        assert_eq!(l["status"], "fail", "{l}");
        assert_eq!(l["error"], json!(err.to_string()), "{l}");
        let ctx = l["context"].as_object().expect("context object");
        let mut keys: Vec<&str> = ctx.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["errorKind", "paths"], "{l}");
        assert_eq!(ctx["paths"], json!([B, second]), "{l}");
    }
}

#[test]
fn e5_notify_callback_logs_err_instead_of_dropping_it() {
    let s = code_lines(fn_slice(WATCHER_SRC, "RecommendedWatcher::new("))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!s.contains("if let Ok("), "Err dropped by `if let Ok`: {s}");
    assert!(s.contains("match res"), "callback must match on res: {s}");
    assert!(s.contains("Ok(event) => handle_event("), "{s}");
    assert!(!s.contains("Err(_)"), "Err discarded: {s}");
    assert_eq!(
        s.matches("log_event(build_watch_error_log(&e))").count(),
        1,
        "{s}"
    );
    assert!(s.contains("Err(e) =>"), "callback must bind the error: {s}");
    assert!(
        s.find("Err(e)") < s.find("build_watch_error_log(&e)"),
        "{s}"
    );
}
