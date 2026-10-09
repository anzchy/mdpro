//! D59 WI-2 laws: every refusal leaves the watch list unchanged (D59-5),
//! concurrent recovers register the union (D59-9), and `file.draft.*`
//! redaction holds for a watched recover (D59-10). The round-trip and
//! transparency laws are in `draft_recover_watch_roundtrip_tests.rs`.
//! Exhaustive over finite domains; nothing is mocked.
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use crate::services::file_watcher::FileWatcher;
use crate::services::quit_guard::DraftGate;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/open_route/lookup_fixture.rs"]
mod draft_fixture;
#[allow(clippy::duplicate_mod, dead_code)]
#[path = "../services/draft/draft_test_home.rs"]
mod draft_test_home;
#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft_recover_watch_fixture.rs"]
mod fx;
#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft_recover_watch_rows.rs"]
mod rows;
use draft_test_home::{ago, bundle_json, TempHome};
use fx::{all_lines, lines_of, recover, recover_in, s, seed, start_log, REGISTER};
use rows::{message_ok, refusal, REFUSALS};

#[test]
fn d59_5_every_refusal_arm_leaves_the_watch_list_unchanged() {
    let home = TempHome::new("d59_5");
    let log = start_log(&home);
    let q = home.path().join("other.md");
    fs::write(&q, "q").unwrap();
    for row in REFUSALS {
        for prior_q in [false, true] {
            let id = format!("{row}_{}", usize::from(prior_q));
            let p = home.path().join(format!("p_{id}.md"));
            fs::write(&p, "p").unwrap();
            let (c, closed, kind) = refusal(&home, row, &id, &s(&p));
            let gate = DraftGate::new();
            if closed {
                drop(gate.close());
            }
            let fw = FileWatcher::for_tests();
            if prior_q {
                fw.watch(&q);
            }
            let prior = fw.watched();
            let snap = home.snapshot();
            let before = lines_of(&log, REGISTER).len();

            let err = recover_in(&gate, &id, c, &fw).expect_err("a refused recover");
            assert_eq!(err.kind(), kind, "{id}: {err:?}");
            assert!(message_ok(row, &err), "{id}: {err:?}");
            assert_eq!(fw.watched(), prior, "{id}");
            assert_eq!(
                lines_of(&log, REGISTER).len(),
                before,
                "{id}: a register line"
            );
            assert_eq!(home.snapshot(), snap, "{id}: draft files changed");
        }
    }
}

#[test]
fn d59_9_concurrent_recovers_register_the_union() {
    let home = TempHome::new("d59_9");
    for it in 0..5 {
        let log = start_log(&home);
        let ids: Vec<String> = (0..4).map(|k| format!("c{it}_{k}")).collect();
        let paths: Vec<String> = ids
            .iter()
            .map(|id| {
                let f = home.path().join(format!("{id}.md"));
                fs::write(&f, "c").unwrap();
                s(&f)
            })
            .collect();
        for (id, p) in ids.iter().zip(&paths) {
            seed(&home, id, Some(p));
        }
        let (fw, gate) = (FileWatcher::for_tests(), DraftGate::new());
        let oks: Vec<bool> = std::thread::scope(|sc| {
            let handles: Vec<_> = ids
                .iter()
                .map(|id| sc.spawn(|| recover(&gate, id, &fw).is_ok()))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert_eq!(oks, vec![true; 4], "iteration {it}");
        let mut got = fw.watched();
        got.sort();
        let mut want = paths.clone();
        want.sort();
        assert_eq!(got, want, "iteration {it}");
        let counts: BTreeSet<u64> = lines_of(&log, REGISTER)
            .iter()
            .filter_map(|v| v["context"]["watchedCount"].as_u64())
            .collect();
        assert_eq!(counts, BTreeSet::from([1, 2, 3, 4]), "iteration {it}");
    }
}

#[test]
fn d59_10_file_draft_redaction_holds_for_a_watched_recover() {
    const SPATH: &str = "/tmp/SENTINELPATH/x.md";
    let home = TempHome::new("d59_10");
    let log = start_log(&home);
    let mut v: Value = serde_json::from_str(&bundle_json(
        "SENTINELTITLE body",
        Some(SPATH),
        &ago(1),
        false,
        None,
    ))
    .unwrap();
    v["title"] = json!("SENTINELTITLE");
    home.write_raw("SENTINELID_w", &v.to_string());
    let fw = FileWatcher::for_tests();
    recover(&DraftGate::new(), "SENTINELID_w", &fw).expect("recover");

    let mut saw_ok = false;
    for (raw, v) in all_lines(&log) {
        let event = v["event"].as_str().unwrap_or("");
        if !event.starts_with("file.draft.") {
            continue;
        }
        for sentinel in [
            "SENTINELID",
            "SENTINELPATH",
            "SENTINELTITLE",
            "SENTINELLABEL",
        ] {
            assert!(
                !raw.contains(sentinel),
                "file.draft line leaks {sentinel}: {raw}"
            );
        }
        let c = v["context"].as_object().cloned().unwrap_or_default();
        for k in ["documentId", "filePath", "title", "windowLabel"] {
            assert!(!c.contains_key(k), "file.draft context has {k}: {raw}");
        }
        if event == "file.draft.recover" && v["status"] == json!("success") {
            assert_eq!(c.get("outcome"), Some(&json!("ok")), "{raw}");
            saw_ok = true;
        }
    }
    assert!(saw_ok, "no file.draft.recover success line");
    let reg = lines_of(&log, REGISTER);
    assert_eq!(reg.len(), 1, "{reg:?}");
    assert_eq!(reg[0]["context"]["path"], json!(SPATH), "{}", reg[0]);
}
