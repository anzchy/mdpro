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

// D86 WI-3 (matrix w15_live_register_line_reports_the_real_outcome): the
// register line's `context.baseline` is what the store actually did, read
// back from the real log under a temp `$HOME`.
use super::seed::kit::{chmod_000_unreadable, rewrite_keep_stat, with_read_hook, TempDir};
use super::seed::read_for_open;
use super::FileWatcher;
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use std::sync::Arc;

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft/draft_test_home.rs"]
mod draft_test_home;

/// Restores the process-global logger settings on drop, so neither a pass
/// nor a panic leaks forced-on Info logging into later tests.
struct LoggerSettingsRestorer(crate::models::LogSettings);
impl Drop for LoggerSettingsRestorer {
    fn drop(&mut self) {
        crate::services::logger::set_log_settings(self.0.clone());
    }
}

/// Enable Info logging into `home`'s log, emptied first. Bind the restorer
/// after `home`, so the logger is restored before `$HOME` and the lock.
fn w15_log(home: &draft_test_home::TempHome) -> (PathBuf, LoggerSettingsRestorer) {
    let restorer = LoggerSettingsRestorer(crate::services::logger::get_log_settings());
    crate::services::logger::set_log_settings(crate::models::LogSettings {
        enabled: true,
        level: crate::models::LogLevel::Info,
    });
    let log = home.path().join(".mdpro").join("mdpro.log");
    let _ = std::fs::remove_file(&log);
    (log, restorer)
}

/// `context.baseline` of the last `file.watch.register` line for `path`,
/// after checking every W9 key is still there. The line logs the raw path
/// `watch` was given, so `path` is compared as given; filtering on it keeps
/// a line another test writes into this log (one not holding `HOME_LOCK`)
/// from being read as this one's.
fn w15_last_baseline(log: &Path, path: &Path, tag: &str) -> Value {
    let text = std::fs::read_to_string(log).unwrap_or_default();
    let line = text
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .rfind(|v| {
            v["event"] == json!("file.watch.register") && v["context"]["path"] == json!(s(path))
        })
        .unwrap_or_else(|| panic!("{tag}: no register line for {path:?} in {text}"));
    let ctx = &line["context"];
    for key in ["path", "ok", "alreadyWatched", "mtimeMs", "size", "watchedCount"] {
        assert!(
            ctx.as_object().is_some_and(|o| o.contains_key(key)),
            "{tag}: `{key}` missing: {line}"
        );
    }
    ctx["baseline"].clone()
}

#[test]
fn w15_live_register_line_reports_the_real_outcome() {
    let home = draft_test_home::TempHome::new(&format!("d86_wi3_w15_{}", std::process::id()));
    let (log, _logger) = w15_log(&home);
    let d = TempDir::new("w15live");

    // (a) a quiescent seed.
    let p = d.file("a.md", b"aaaa");
    let seed = read_for_open(&p).expect("read a").1;
    assert!(seed.hash.is_some(), "(a) precondition: a hashed seed");
    FileWatcher::for_tests().watch_seeded(&p, seed);
    assert_eq!(w15_last_baseline(&log, &p, "(a)"), json!("seeded"));

    // (b) a torn seed: the read went unstable, so no hash.
    let q = d.file("b.md", b"AAAA");
    let q2 = q.clone();
    let torn = with_read_hook(move || rewrite_keep_stat(&q2, b"BBBB"), || read_for_open(&q))
        .expect("read b")
        .1;
    assert_eq!(torn.hash, None, "(b) precondition: a torn seed");
    FileWatcher::for_tests().watch_seeded(&q, torn);
    assert_eq!(w15_last_baseline(&log, &q, "(b)"), json!("failopen"));

    // (c) plain watch on a readable file.
    let r = d.file("c.md", b"cccc");
    FileWatcher::for_tests().watch(&r);
    assert_eq!(w15_last_baseline(&log, &r, "(c)"), json!("snapshot"));

    // (d) the g6 interleaving: an unwatch inside the watch's read wins.
    let t = d.file("d.md", b"dddd");
    let fw = Arc::new(FileWatcher::for_tests());
    let (fw2, t2) = (Arc::clone(&fw), t.clone());
    with_read_hook(move || fw2.unwatch(&t2), || fw.watch(&t));
    assert_eq!(fw.baseline_of(&t), None, "(d) precondition: skipped");
    assert_eq!(w15_last_baseline(&log, &t, "(d)"), json!("stale_skipped"));

    // (e) plain watch on an unreadable file: stored, but with no hash.
    let u = d.file("e.md", b"eeee");
    chmod_000_unreadable(&u);
    let fw = FileWatcher::for_tests();
    fw.watch(&u);
    assert_eq!(fw.baseline_of(&u).and_then(|e| e.hash), None, "(e)");
    assert!(fw.baseline_of(&u).is_some(), "(e) precondition: stored");
    assert_eq!(w15_last_baseline(&log, &u, "(e)"), json!("failopen"));
}
