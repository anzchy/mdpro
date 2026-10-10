//! D59 WI-1 F1-F3: the `FileWatcher::for_tests` / `watched` fixture drives the
//! real notify watcher (FSEvents) and reports the real watch list. F4 (no
//! production surface) is the non-test `cargo check` / `clippy` plus `wc -l`.
//!
//! Every case runs under `TempHome`: `watch` / `unwatch` log through the real
//! logger, which writes to `$HOME/.mdpro/mdpro.log`.
use super::FileWatcher;
use crate::models::{LogLevel, LogSettings};
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use crate::services::logger::set_log_settings;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft/draft_test_home.rs"]
mod draft_test_home;
use draft_test_home::TempHome;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Enable Info logging and start from an empty log file.
fn start_log(home: &TempHome) -> PathBuf {
    set_log_settings(LogSettings {
        enabled: true,
        level: LogLevel::Info,
    });
    let path = home.path().join(".mdpro").join("mdpro.log");
    let _ = fs::remove_file(&path);
    path
}

/// Every parsed log line whose `event` is `event`.
fn lines_of(log: &Path, event: &str) -> Vec<Value> {
    fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["event"] == json!(event))
        .collect()
}

#[derive(Clone, Copy, Debug)]
enum Op {
    Watch(usize),
    Unwatch(usize),
}

/// The ordered-set model: register pushes once, unregister removes.
fn model(seq: &[Op], names: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for op in seq {
        match *op {
            Op::Watch(i) if !out.contains(&names[i]) => out.push(names[i].clone()),
            Op::Watch(_) => {}
            Op::Unwatch(i) => out.retain(|x| x != &names[i]),
        }
    }
    out
}

#[test]
fn f1_watch_unwatch_sequences_match_the_ordered_set_model() {
    let home = TempHome::new("d59_f1");
    let p = home.path().join("f1_p.md");
    let q = home.path().join("f1_q.md");
    fs::write(&p, "p").unwrap();
    fs::write(&q, "q").unwrap();
    let paths = [p.clone(), q.clone()];
    let names = [s(&p), s(&q)];
    let ops = [Op::Watch(0), Op::Watch(1), Op::Unwatch(0), Op::Unwatch(1)];
    let mut seqs: Vec<Vec<Op>> = vec![vec![]];
    seqs.extend(ops.iter().map(|a| vec![*a]));
    for a in ops {
        seqs.extend(ops.iter().map(|b| vec![a, *b]));
    }
    assert_eq!(seqs.len(), 21, "1 + 4 + 16 sequences");

    for seq in &seqs {
        let fw = FileWatcher::for_tests();
        for op in seq {
            match *op {
                Op::Watch(i) => fw.watch(&paths[i]),
                Op::Unwatch(i) => fw.unwatch(&paths[i]),
            }
        }
        assert_eq!(fw.watched(), model(seq, &names), "seq {seq:?}");
    }

    // Hand-written anchors, so the model is not the only oracle.
    let run = |seq: &[Op]| {
        let fw = FileWatcher::for_tests();
        for op in seq {
            match *op {
                Op::Watch(i) => fw.watch(&paths[i]),
                Op::Unwatch(i) => fw.unwatch(&paths[i]),
            }
        }
        fw.watched()
    };
    let (ps, qs) = (names[0].clone(), names[1].clone());
    assert_eq!(
        run(&[Op::Watch(0), Op::Watch(1)]),
        vec![ps.clone(), qs.clone()]
    );
    assert_eq!(run(&[Op::Watch(1), Op::Watch(0)]), vec![qs, ps.clone()]);
    assert_eq!(run(&[Op::Watch(0), Op::Watch(0)]), vec![ps]);
    assert!(run(&[Op::Watch(0), Op::Unwatch(0)]).is_empty());
    assert!(run(&[Op::Unwatch(0)]).is_empty());
}

#[test]
fn f2_instances_are_isolated() {
    let home = TempHome::new("d59_f2");
    let p = home.path().join("f2_p.md");
    fs::write(&p, "p").unwrap();
    let a = FileWatcher::for_tests();
    let b = FileWatcher::for_tests();
    a.watch(&p);
    assert_eq!(a.watched(), vec![s(&p)]);
    assert_eq!(b.watched(), Vec::<String>::new());
}

#[test]
fn f3_a_missing_path_is_recorded_and_removed() {
    let home = TempHome::new("d59_f3");
    let log = start_log(&home);
    let m = home.path().join("f3_missing.md");
    assert!(!m.exists(), "precondition: m must not exist");
    let fw = FileWatcher::for_tests();

    fw.watch(&m);
    assert_eq!(fw.watched(), vec![s(&m)]);
    fw.unwatch(&m);
    assert_eq!(fw.watched(), Vec::<String>::new());

    let reg = lines_of(&log, "file.watch.register");
    assert_eq!(reg.len(), 1, "one register line: {reg:?}");
    assert_eq!(reg[0]["level"], json!("error"), "{}", reg[0]);
    assert_eq!(reg[0]["context"]["ok"], json!(false), "{}", reg[0]);
    let unreg = lines_of(&log, "file.watch.unregister");
    assert_eq!(unreg.len(), 1, "one unregister line: {unreg:?}");
    assert_eq!(unreg[0]["level"], json!("warn"), "{}", unreg[0]);
}
