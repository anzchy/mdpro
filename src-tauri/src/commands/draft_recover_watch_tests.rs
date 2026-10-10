//! D59 WI-2: a recover through `recover_draft_watched_with` registers the
//! recovered file's exact stored path with the real `FileWatcher` (D59-1,
//! 1b, 2, 2b, 3, 4, 6, 7, 8). The refusal, concurrency, redaction and law
//! cases are in `draft_recover_watch_law_tests.rs`. Real notify watcher, real drafts in
//! a temp `$HOME`, real logger; nothing is mocked.
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use crate::services::file_watcher::FileWatcher;
use crate::services::quit_guard::DraftGate;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/draft/draft_test_home.rs"]
mod draft_test_home;
#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft_recover_watch_fixture.rs"]
mod fx;
use draft_test_home::{ago, bundle_json, TempHome};
use fx::{all_lines, lines_of, recover, s, seed, start_log, REGISTER, UNREGISTER};

#[test]
fn d59_1_a_recovered_bundle_path_is_registered_by_its_exact_stored_string() {
    let home = TempHome::new("d59_1");
    let p = home.path().join("a.md");
    fs::write(&p, "hello").unwrap();
    let p_str = s(&p);
    assert_ne!(
        s(&fs::canonicalize(&p).unwrap()),
        p_str,
        "precondition: the temp path must be a non-canonical spelling"
    );
    seed(&home, "d1", Some(&p_str));
    let fw = FileWatcher::for_tests();

    let r = recover(&DraftGate::new(), "d1", &fw).expect("recover");
    assert_eq!(r.content, "body");
    assert_eq!(r.original_path, Some(p_str.clone()));
    assert_eq!(fw.watched(), vec![p_str]);
}

#[test]
fn d59_1b_exact_spelling_is_preserved_across_spelling_partitions() {
    let home = TempHome::new("d59_1b");
    let h = s(home.path());
    let rows = [
        ("a", format!("{h}/a.md"), home.path().join("a.md")),
        ("b", format!("{h}/./b.md"), home.path().join("b.md")),
        ("c", format!("{h}//c.md"), home.path().join("c.md")),
        ("d", format!("{h}/d e é.md"), home.path().join("d e é.md")),
    ];
    for (id, stored, file) in &rows {
        fs::write(file, "x").unwrap();
        seed(&home, id, Some(stored));
        let fw = FileWatcher::for_tests();
        let r = recover(&DraftGate::new(), id, &fw).expect("recover");
        assert_eq!(
            r.original_path.as_deref(),
            Some(stored.as_str()),
            "row {id}"
        );
        assert_eq!(fw.watched(), vec![stored.clone()], "row {id}");
        fw.unwatch(Path::new(stored));
        assert_eq!(fw.watched(), Vec::<String>::new(), "row {id} after unwatch");
    }
}

#[test]
fn d59_2_one_register_line_with_the_open_file_schema() {
    let home = TempHome::new("d59_2");
    let log = start_log(&home);
    let p = home.path().join("a.md");
    fs::write(&p, "hello").unwrap();
    let p_str = s(&p);
    seed(&home, "d1", Some(&p_str));
    let fw = FileWatcher::for_tests();
    recover(&DraftGate::new(), "d1", &fw).expect("recover");

    let reg = lines_of(&log, REGISTER);
    assert_eq!(reg.len(), 1, "exactly one register line: {reg:?}");
    let (line, c) = (&reg[0], &reg[0]["context"]);
    assert_eq!(c["path"], json!(p_str), "{line}");
    assert_eq!(line["level"], json!("info"), "{line}");
    assert_eq!(line["status"], json!("success"), "{line}");
    assert_eq!(c["ok"], json!(true), "{line}");
    assert_eq!(c["alreadyWatched"], json!(false), "{line}");
    assert_eq!(c["watchedCount"], json!(1), "{line}");
    assert_eq!(c["size"], json!(5), "{line}");
    assert!(c["mtimeMs"].is_number(), "{line}");
    assert!(c.get("error").is_none(), "{line}");
}

#[test]
fn d59_2b_the_watch_is_logged_after_the_recover_succeeds() {
    let home = TempHome::new("d59_2b");
    let log = start_log(&home);
    let p = home.path().join("a.md");
    fs::write(&p, "hello").unwrap();
    seed(&home, "d1", Some(&s(&p)));
    let fw = FileWatcher::for_tests();
    recover(&DraftGate::new(), "d1", &fw).expect("recover");

    let lines = all_lines(&log);
    let idx = |pred: &dyn Fn(&Value) -> bool| lines.iter().position(|(_, v)| pred(v));
    let recover_ok =
        idx(&|v| v["event"] == json!("file.draft.recover") && v["status"] == json!("success"))
            .expect("a file.draft.recover success line");
    let reg = idx(&|v| v["event"] == json!(REGISTER)).expect("a register line");
    assert!(
        reg > recover_ok,
        "register at {reg}, recover success at {recover_ok}"
    );
}

#[test]
fn d59_3_no_path_registers_nothing_and_logs_nothing() {
    let home = TempHome::new("d59_3");
    let log = start_log(&home);
    let q = home.path().join("other.md");
    fs::write(&q, "q").unwrap();
    for prior_q in [false, true] {
        let k = usize::from(prior_q);
        let (n1, n2) = (format!("n1_{k}"), format!("n2_{k}"));
        home.write_raw(&n1, &bundle_json("b", None, &ago(1), false, None));
        home.write_legacy(&n2, "legacy body", None, &ago(1), false);
        fs::remove_file(home.legacy_meta(&n2)).unwrap();
        let fw = FileWatcher::for_tests();
        if prior_q {
            fw.watch(&q);
        }
        let prior = fw.watched();
        for (id, content) in [(n1.as_str(), "b"), (n2.as_str(), "legacy body")] {
            let before = lines_of(&log, REGISTER).len();
            let r = recover(&DraftGate::new(), id, &fw).expect("recover");
            assert_eq!(r.original_path, None, "{id}");
            assert_eq!(r.content, content, "{id}");
            assert_eq!(fw.watched(), prior, "{id}");
            assert_eq!(
                lines_of(&log, REGISTER).len(),
                before,
                "{id}: no register line"
            );
        }
    }
}

#[test]
fn d59_4_already_watched_and_repeated_recover_register_once() {
    let home = TempHome::new("d59_4");
    let log = start_log(&home);
    let p = home.path().join("a.md");
    fs::write(&p, "hello").unwrap();
    let p_str = s(&p);
    seed(&home, "d1", Some(&p_str));
    let fw = FileWatcher::for_tests();
    fw.watch(&p);
    let gate = DraftGate::new();

    recover(&gate, "d1", &fw).expect("first recover");
    assert_eq!(fw.watched(), vec![p_str.clone()]);
    let reg = lines_of(&log, REGISTER);
    assert_eq!(reg.len(), 2, "{reg:?}");
    assert_eq!(
        reg[1]["context"]["alreadyWatched"],
        json!(true),
        "{}",
        reg[1]
    );
    assert_eq!(reg[1]["context"]["watchedCount"], json!(1), "{}", reg[1]);
    assert_eq!(reg[1]["context"]["ok"], json!(true), "{}", reg[1]);

    recover(&gate, "d1", &fw).expect("second recover");
    assert_eq!(fw.watched(), vec![p_str.clone()]);
    let reg = lines_of(&log, REGISTER);
    assert_eq!(reg.len(), 3, "{reg:?}");
    for line in &reg {
        assert_eq!(line["context"]["path"], json!(p_str), "{line}");
        assert_eq!(line["context"]["watchedCount"], json!(1), "{line}");
    }
    assert_eq!(
        reg[2]["context"]["alreadyWatched"],
        json!(true),
        "{}",
        reg[2]
    );

    fw.unwatch(&p);
    assert_eq!(fw.watched(), Vec::<String>::new());
}

#[test]
fn d59_6_an_invalid_stored_path_recovers_registers_nothing_and_logs_one_redacted_cancel() {
    let home = TempHome::new("d59_6");
    let rows = [
        ("v1", "/tmp/SENTINELBAD/../x.md"),
        ("v2", "/tmp/SENTINELBAD/a.png"),
        ("v3", "/tmp/SENTINELBAD/noext"),
        ("v4", "SENTINELBAD/a.md"),
        ("v5", ""),
    ];
    for (id, stored) in rows {
        let log = start_log(&home);
        seed(&home, id, Some(stored));
        let fw = FileWatcher::for_tests();
        let r = recover(&DraftGate::new(), id, &fw).expect("an invalid path still recovers");
        assert_eq!(r.content, "body", "{id}");
        assert_eq!(r.original_path.as_deref(), Some(stored), "{id}");
        assert_eq!(fw.watched(), Vec::<String>::new(), "{id}");

        let reg = lines_of(&log, REGISTER);
        assert_eq!(reg.len(), 1, "{id}: one register line: {reg:?}");
        assert_eq!(reg[0]["level"], json!("warn"), "{id}: {}", reg[0]);
        assert_eq!(reg[0]["status"], json!("cancel"), "{id}: {}", reg[0]);
        assert_eq!(
            reg[0]["context"],
            json!({"source": "recover", "reason": "invalid_path"}),
            "{id}"
        );
        let recovered = lines_of(&log, "file.draft.recover");
        assert!(
            recovered.iter().any(|v| v["status"] == json!("success")),
            "{id}: no file.draft.recover success line"
        );
        let text = fs::read_to_string(&log).unwrap();
        assert!(
            !text.contains("SENTINELBAD"),
            "{id}: the log leaks the path:\n{text}"
        );
    }
}

#[test]
fn d59_7_a_valid_path_whose_file_is_gone_is_still_registered() {
    let home = TempHome::new("d59_7");
    let log = start_log(&home);
    let g = home.path().join("gone.md");
    assert!(!g.exists(), "precondition: g must not exist");
    seed(&home, "d1", Some(&s(&g)));
    let fw = FileWatcher::for_tests();

    let r = recover(&DraftGate::new(), "d1", &fw).expect("recover");
    assert_eq!(r.content, "body");
    assert_eq!(fw.watched(), vec![s(&g)]);
    let reg = lines_of(&log, REGISTER);
    assert_eq!(reg.len(), 1, "{reg:?}");
    let (line, c) = (&reg[0], &reg[0]["context"]);
    assert_eq!(line["level"], json!("error"), "{line}");
    assert_eq!(line["status"], json!("fail"), "{line}");
    assert_eq!(c["ok"], json!(false), "{line}");
    assert!(c["error"].as_str().is_some_and(|e| !e.is_empty()), "{line}");
    assert_eq!(c["mtimeMs"], Value::Null, "{line}");
    assert_eq!(c["watchedCount"], json!(1), "{line}");

    fw.unwatch(&g);
    assert_eq!(fw.watched(), Vec::<String>::new());
    let unreg = lines_of(&log, UNREGISTER);
    assert_eq!(unreg.len(), 1, "{unreg:?}");
    assert_eq!(unreg[0]["level"], json!("warn"), "{}", unreg[0]);
}

#[test]
fn d59_8_validity_matches_open_file_across_the_extension_partitions() {
    let home = TempHome::new("d59_8");
    let rows = [
        ("x0.md", true),
        ("x1.markdown", true),
        ("x2.mdx", true),
        ("x3.txt", true),
        ("x4.MD", false),
        ("x5.md.bak", false),
        ("x6.markdownx", false),
    ];
    for (i, (name, registered)) in rows.into_iter().enumerate() {
        let log = start_log(&home);
        let f = home.path().join(name);
        fs::write(&f, "x").unwrap();
        let id = format!("e{i}");
        seed(&home, &id, Some(&s(&f)));
        let fw = FileWatcher::for_tests();
        recover(&DraftGate::new(), &id, &fw).expect("recover");
        let cancels = lines_of(&log, REGISTER)
            .into_iter()
            .filter(|v| v["status"] == json!("cancel"))
            .count();
        if registered {
            assert_eq!(fw.watched(), vec![s(&f)], "{name}");
            assert_eq!(cancels, 0, "{name}");
        } else {
            assert_eq!(fw.watched(), Vec::<String>::new(), "{name}");
            assert_eq!(cancels, 1, "{name}");
        }
    }
}
