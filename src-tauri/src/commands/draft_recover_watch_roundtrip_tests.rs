//! D59 WI-2 laws: recover-then-close leaves the prior watch list minus the
//! recovered path for every draft shape and prior list (D59-L1), and the
//! watch is transparent to recovery: a twin draft recovered without the
//! watcher gives the same result and the same bundle (D59-L2). Exhaustive
//! over finite domains; nothing is mocked.
use super::draft_recovery::recover_draft_logged_with;
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, RecoverResult, ShadowUnavailable};
use crate::services::file_watcher::FileWatcher;
use crate::services::quit_guard::DraftGate;
use serde_json::Value;
use std::fs;
use std::path::Path;

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
use draft_test_home::{who, TempHome};
use fx::{empty_ctx, minus, recover, recover_in, s, S};
use rows::{refusal, write_shape, SHAPES};

#[test]
fn d59_l1_recover_then_close_restores_the_prior_list_minus_the_path() {
    let home = TempHome::new("d59_l1");
    let q = home.path().join("other.md");
    fs::write(&q, "q").unwrap();
    let mut rows = 0;
    for shape in SHAPES {
        let valid = matches!(shape, 'A' | 'B' | 'E');
        let priors: &[&str] = if valid {
            &["none", "q", "p"]
        } else {
            &["none", "q"]
        };
        for prior in priors {
            rows += 1;
            let id = format!("{shape}_{prior}");
            let file = home.path().join(format!("{id}.md"));
            let stored = write_shape(&home, shape, &id, &file);
            let fw = FileWatcher::for_tests();
            match *prior {
                "q" => fw.watch(&q),
                "p" => fw.watch(&file),
                _ => {}
            }
            let s0 = fw.watched();
            let r = recover(&DraftGate::new(), &id, &fw).expect("recover");
            assert_eq!(r.original_path, stored, "row {id}");

            let after = fw.watched();
            let p = stored.clone().unwrap_or_default();
            assert!(
                after.iter().filter(|x| **x == p).count() <= 1,
                "row {id}: {after:?}"
            );
            let want = if valid && !s0.contains(&p) {
                [s0.clone(), vec![p.clone()]].concat()
            } else {
                s0.clone()
            };
            assert_eq!(after, want, "row {id}: after recover");

            if let Some(path) = &r.original_path {
                fw.unwatch(Path::new(path));
            }
            assert_eq!(fw.watched(), minus(&s0, &p), "row {id}: after close");
        }
    }
    assert_eq!(rows, 19);
}

/// The persisted draft state of `id`, minus the timestamp a recover rewrites.
fn on_disk(home: &TempHome, id: &str) -> Value {
    let mut v: Value = if home.exists(id) {
        home.value(id)
    } else {
        serde_json::from_str(&fs::read_to_string(home.legacy_meta(id)).unwrap()).unwrap()
    };
    v.as_object_mut().unwrap().remove("lastModified");
    // Each recovery issues a distinct nonce; watch transparency concerns the
    // stable draft fields, not the nonce's random value.
    v.as_object_mut().unwrap().remove("claim");
    v
}

/// `r` with its own draft id spelled `ID`: a legacy title is derived from it.
fn norm(r: &RecoverResult, id: &str) -> (String, Option<String>, String) {
    let t = r.title.replace(id, "ID");
    (r.content.clone(), r.original_path.clone(), t)
}

#[test]
fn d59_l2_the_watch_is_transparent_to_recovery() {
    let home = TempHome::new("d59_l2");
    let caller = who(S, "W");
    for shape in SHAPES {
        let (id, twin) = (format!("seam_{shape}"), format!("twin_{shape}"));
        let file = home.path().join(format!("{shape}.md"));
        write_shape(&home, shape, &id, &file);
        write_shape(&home, shape, &twin, &file);
        let fw = FileWatcher::for_tests();
        let a = recover(&DraftGate::new(), &id, &fw).expect("seam recover");
        let b = recover_draft_logged_with(&DraftGate::new(), &twin, &caller, empty_ctx)
            .expect("plain recover");
        assert_eq!(norm(&a, &id), norm(&b, &twin), "shape {shape}");
        assert_eq!(
            on_disk(&home, &id).to_string().replace(&id, "ID"),
            on_disk(&home, &twin).to_string().replace(&twin, "ID"),
            "shape {shape}"
        );
    }
    for row in ["r1", "r3", "r4", "r5", "r7"] {
        let (id, twin) = (format!("seam_{row}"), format!("twin_{row}"));
        let p = s(&home.path().join(format!("p_{row}.md")));
        fs::write(&p, "p").unwrap();
        let (c, _, _) = refusal(&home, row, &id, &p);
        let (c_twin, _, _) = refusal(&home, row, &twin, &p);
        let fw = FileWatcher::for_tests();
        let a = recover_in(&DraftGate::new(), &id, c, &fw).expect_err("seam refusal");
        let b = recover_draft_logged_with(&DraftGate::new(), &twin, &caller, move || c_twin)
            .expect_err("plain refusal");
        assert_eq!(a.kind(), b.kind(), "{row}");
        assert_eq!(
            a.to_string().replace(&id, "ID"),
            b.to_string().replace(&twin, "ID"),
            "{row}"
        );
    }
}

// D86 WI-3 (matrix recover_watch_keeps_snapshot_semantics): the D59 recover
// watch still registers `snapshot(disk)`, and overwrites a seed the path
// already had (ADR-0068 decision 4). Two partitions: unwatched, seeded.
use crate::services::file_watcher::seed::{kit, read_for_open};

fn recover_leg(seeded: bool) {
    let home = TempHome::new(&format!("d86_wi3_recover_{seeded}"));
    let p = home.path().join("a.md");
    fs::write(&p, "hello").unwrap();
    let p_str = s(&p);
    fx::seed(&home, "d1", Some(&p_str));
    let fw = FileWatcher::for_tests();
    if seeded {
        let other = home.path().join("other.md");
        fs::write(&other, "other").unwrap();
        let stale = read_for_open(&other).expect("read other").1;
        assert_eq!(stale.hash, kit::h(b"other"), "precondition: a real seed");
        fw.watch_seeded(&p, stale);
        assert_eq!(fw.baseline_of(&p), Some(stale), "precondition: seeded");
    }
    recover(&DraftGate::new(), "d1", &fw).expect("recover");
    let want = kit::snapshot(&p);
    assert_eq!(fw.baseline_of(&p), Some(want), "seeded={seeded}");
    assert_eq!(want.hash, kit::h(b"hello"), "seeded={seeded}");
    assert_ne!(want.hash, kit::h(b"body"), "seeded={seeded}");
    assert_eq!(fw.watched(), vec![p_str], "seeded={seeded}");
}

#[test]
fn recover_watch_keeps_snapshot_semantics() {
    recover_leg(false);
    recover_leg(true);
}
