//! Real-FSEvents pair for the register/unregister log builders (D32 WI-3: w13).
//!
//! Wired from `file_watcher.rs` with
//! `#[cfg(all(test, target_os = "macos"))] #[path = ...] mod register_live_tests;`.
//! Not ignored: it awaits no event delivery, only the synchronous Results of
//! notify 6.1.1's `watch` (Err path-not-found on a missing path) and
//! `unwatch` (Err watch-not-found on a never-watched path).

use super::apply_watch;
use super::kinds_fixture::unique_path;
use super::watch_log::WatchOp;
use notify::{Config, Event, RecommendedWatcher, Watcher};
use serde_json::{json, to_value, Value};
use std::path::{Path, PathBuf};

fn s(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

fn step(
    w: &mut RecommendedWatcher,
    list: &mut Vec<String>,
    path: &Path,
    op: WatchOp,
) -> (Value, Value) {
    let line = to_value(apply_watch(w, list, path, op)).unwrap();
    let ctx = line["context"].clone();
    (line, ctx)
}

fn assert_failed(line: &Value, ctx: &Value, level: &str, tag: &str) {
    assert_eq!(line["level"], json!(level), "{tag}: {line}");
    assert_eq!(line["status"], json!("fail"), "{tag}: {line}");
    assert_eq!(ctx["ok"], json!(false), "{tag}: {line}");
    let err = ctx["error"].as_str().unwrap_or("");
    assert!(
        !err.is_empty(),
        "{tag}: error must be a non-empty string: {line}"
    );
}

fn assert_succeeded(line: &Value, ctx: &Value, tag: &str) {
    assert_eq!(line["level"], json!("info"), "{tag}: {line}");
    assert_eq!(line["status"], json!("success"), "{tag}: {line}");
    assert_eq!(ctx["ok"], json!(true), "{tag}: {line}");
    assert!(
        ctx.as_object().is_some_and(|o| !o.contains_key("error")),
        "{tag}: no error key on success: {line}"
    );
}

#[test]
fn w13_real_watcher_results_reach_the_register_line() {
    let dir: PathBuf = unique_path("w13dir").with_extension("d");
    std::fs::create_dir_all(&dir).unwrap();
    let f = dir.join("f.md");
    let g = dir.join("g.md");
    std::fs::write(&f, b"abc").unwrap();
    std::fs::write(&g, b"g").unwrap();
    let m = unique_path("w13m");
    assert!(!m.exists(), "precondition: m must not exist");

    let mut w = RecommendedWatcher::new(|_: notify::Result<Event>| {}, Config::default()).unwrap();
    let mut list: Vec<String> = Vec::new();
    let (reg, unreg) = (WatchOp::Register, WatchOp::Unregister);

    // 1. register a missing path: Err, but the list still records it.
    let (line, ctx) = step(&mut w, &mut list, &m, reg);
    assert_failed(&line, &ctx, "error", "step 1");
    assert_eq!(ctx["alreadyWatched"], json!(false), "step 1: {line}");
    assert_eq!(ctx["watchedCount"], json!(1), "step 1: {line}");
    assert_eq!(ctx["mtimeMs"], Value::Null, "step 1: {line}");
    assert_eq!(list, vec![s(&m)], "step 1 list");

    // 2. register an existing file.
    let (line, ctx) = step(&mut w, &mut list, &f, reg);
    assert_succeeded(&line, &ctx, "step 2");
    assert_eq!(ctx["alreadyWatched"], json!(false), "step 2: {line}");
    assert_eq!(ctx["watchedCount"], json!(2), "step 2: {line}");
    assert_eq!(ctx["size"], json!(3), "step 2: {line}");
    assert_eq!(list, vec![s(&m), s(&f)], "step 2 list");

    // 3. register it again.
    let (line, ctx) = step(&mut w, &mut list, &f, reg);
    assert_succeeded(&line, &ctx, "step 3");
    assert_eq!(ctx["alreadyWatched"], json!(true), "step 3: {line}");
    assert_eq!(ctx["watchedCount"], json!(2), "step 3: {line}");
    assert_eq!(list, vec![s(&m), s(&f)], "step 3 list");

    // 4. unregister a never-watched file: Warn, not Error.
    let (line, ctx) = step(&mut w, &mut list, &g, unreg);
    assert_failed(&line, &ctx, "warn", "step 4");
    assert_eq!(ctx["alreadyWatched"], json!(false), "step 4: {line}");
    assert_eq!(ctx["watchedCount"], json!(2), "step 4: {line}");
    assert_eq!(list, vec![s(&m), s(&f)], "step 4 list");

    // 5. unregister the watched file.
    let (line, ctx) = step(&mut w, &mut list, &f, unreg);
    assert_succeeded(&line, &ctx, "step 5");
    assert_eq!(ctx["alreadyWatched"], json!(true), "step 5: {line}");
    assert_eq!(ctx["watchedCount"], json!(1), "step 5: {line}");
    assert_eq!(list, vec![s(&m)], "step 5 list");

    // 6. m now exists: the register reaches notify (no dedupe on the list),
    //    which the successful unregister proves.
    std::fs::write(&m, b"m").unwrap();
    let (line, ctx) = step(&mut w, &mut list, &m, reg);
    assert_succeeded(&line, &ctx, "step 6 register");
    assert_eq!(
        ctx["alreadyWatched"],
        json!(true),
        "step 6 register: {line}"
    );
    assert_eq!(list, vec![s(&m)], "step 6 register list");
    let (line, ctx) = step(&mut w, &mut list, &m, unreg);
    assert_succeeded(&line, &ctx, "step 6 unregister");
    assert!(list.is_empty(), "step 6 unregister list: {list:?}");

    let _ = std::fs::remove_file(&m);
    let _ = std::fs::remove_dir_all(&dir);
}
