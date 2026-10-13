//! D173-WI-4, audit b97 Medium 1: the save notice reaches every held raw
//! STRING. `PathBuf` equality compares components, so `/d/./doc.md` and
//! `/d/doc.md` are one `BTreeMap<PathBuf, _>` key, and the consumer
//! spellings (file_watcher_holders.rs `spellings()`) kept only the first
//! string inserted. The frontend matches `doc.path === event.path` exactly
//! (externalChangeStore.ts), so the window holding the other string was
//! never told. The fix keeps raw strings, not a component-equal dedupe.
//!
//! Real files, a real `FileWatcher::for_tests_noticed()` and the real
//! acquisition (`reserve_hold` → `watch` → `confirm_hold`); the sink is the
//! only double. macOS only, for the save fixture's `Dir`.
use super::super::test_support::NoticeRecorder;
use super::super::FileWatcher;
use super::SaveOrigin;
use crate::commands::file_save_fixture::{canon, Dir};
use std::path::{Path, PathBuf};

const W1: &str = "mdpro-w1";
const W2: &str = "mdpro-w2";
const W3: &str = "mdpro-w3";

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn acquire(fw: &FileWatcher, label: &str, p: &Path) {
    let r = fw
        .reserve_hold(label, p)
        .unwrap_or_else(|| panic!("{label} may acquire {p:?}"));
    fw.watch(p);
    assert!(fw.confirm_hold(&r), "{label}: the hold on {p:?} is current");
}

/// Every notice's path, sorted, duplicates kept.
fn paths(rec: &NoticeRecorder) -> Vec<String> {
    let mut out: Vec<String> = rec.sent().into_iter().map(|n| n.event.path).collect();
    out.sort();
    out
}

/// `d173_wi4_b97`: W1 holds P as `<canon dir>/./doc.md`, W2 as
/// `<canon dir>/doc.md`; W3 saves through the plain spelling. Each raw
/// string gets exactly one notice, whichever window acquired first.
#[test]
fn d173_wi4_b97_component_equal_spellings_each_get_a_notice() {
    let d = Dir::new("d173_wi4_b97");
    let p = d.file("doc.md", b"alpha\n");
    let plain = canon(&p);
    let dir = plain.parent().expect("a parent dir");
    let dotted = PathBuf::from(format!("{}/./doc.md", dir.to_string_lossy()));
    assert_eq!(
        dotted, plain,
        "precondition: the two strings are PathBuf-equal"
    );
    assert_ne!(
        s(&dotted),
        s(&plain),
        "precondition: they are different strings"
    );

    for (first, second, tag) in [
        ((W2, &plain), (W1, &dotted), "plain acquired first"),
        ((W1, &dotted), (W2, &plain), "dotted acquired first"),
    ] {
        let (fw, rec) = FileWatcher::for_tests_noticed();
        acquire(&fw, first.0, first.1);
        acquire(&fw, second.0, second.1);

        let origin = SaveOrigin::new(W3, "doc-c");
        fw.notice_saved(&origin, &s(&plain), &plain, None);

        let mut want = vec![s(&dotted), s(&plain)];
        want.sort();
        assert_eq!(
            paths(&rec),
            want,
            "{tag}: one notice for EACH held raw string, so the `./` window's exact match is reached"
        );

        let mut got = fw.consumer_spellings(&plain);
        got.sort();
        assert_eq!(
            got, want,
            "{tag}: the consumer spellings keep both raw strings"
        );
    }
}
