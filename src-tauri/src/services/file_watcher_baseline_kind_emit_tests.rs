//! D32 WI-4b K2: each of the three filtered kinds still emits whenever the
//! file is not provably unchanged. The over-cap row lives in the cap tests
//! with the other 10 MiB cases. Real store, real temp files, synthetic events.
use super::super::WatchOutcome::EmittedModified;
use super::fixture::{
    append, fresh, modified, rewrite_keep_stat, route, shift_mtime, TempDir, FILTERED,
};
use super::BaselineStore;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy)]
enum Miss {
    SameStatDifferentBytes,
    ChangedSize,
    ChangedMtime,
    NoBaseline,
    #[cfg(unix)]
    Unreadable,
    Missing,
}

const MISSES: &[Miss] = &[
    Miss::SameStatDifferentBytes,
    Miss::ChangedSize,
    Miss::ChangedMtime,
    Miss::NoBaseline,
    #[cfg(unix)]
    Miss::Unreadable,
    Miss::Missing,
];

/// A file at `name` whose state misses the drop in the way `miss` names.
fn prepared(d: &TempDir, name: &str, miss: Miss) -> (BaselineStore, PathBuf) {
    let p = d.file(name, b"hello world");
    let store = BaselineStore::default();
    if !matches!(miss, Miss::NoBaseline) {
        store.register(&p);
        assert!(
            store.get(&p).and_then(|e| e.hash).is_some(),
            "precondition: registered with a hash"
        );
    }
    match miss {
        Miss::SameStatDifferentBytes => rewrite_keep_stat(&p, b"hello WORLD"),
        Miss::ChangedSize => append(&p, b"!"),
        Miss::ChangedMtime => shift_mtime(&p, 5),
        Miss::NoBaseline => {}
        #[cfg(unix)]
        Miss::Unreadable => super::fixture::chmod_000_unreadable(&p),
        Miss::Missing => std::fs::remove_file(&p).expect("remove"),
    }
    (store, p)
}

fn restore(p: &Path, miss: Miss) {
    #[cfg(unix)]
    if matches!(miss, Miss::Unreadable) {
        super::fixture::chmod(p, 0o644);
    }
    let _ = (p, miss);
}

/// K2: kind x miss, every cell emits the exact `modified` payload.
#[test]
fn k2_each_filtered_kind_emits_when_the_file_is_not_provably_unchanged() {
    let d = TempDir::new("k2");
    let mut cells = 0;
    for kind in FILTERED {
        for &miss in MISSES {
            cells += 1;
            let (store, p) = prepared(&d, &format!("c{cells}.md"), miss);
            let got = route(kind, &[&p], &fresh(), &store);
            restore(&p, miss);
            assert_eq!(got, (modified(&p), EmittedModified), "{kind:?} x {miss:?}");
        }
    }
    assert_eq!(cells, 3 * MISSES.len());
}
