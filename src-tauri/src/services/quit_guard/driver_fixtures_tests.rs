//! WI-2 (audit row 28): the temp-dir fixtures must be injective. Two calls —
//! same label, same process, or racing threads — never share a directory, and
//! a later call never deletes a directory an earlier call handed out.

use super::driver_fixtures::{fresh_log_home, make_temp_home};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};

fn assert_existing_empty(dir: &Path) {
    assert!(dir.is_dir(), "{dir:?} does not exist as a directory");
    let n = fs::read_dir(dir).expect("readable").count();
    assert_eq!(n, 0, "{dir:?} is not empty");
}

#[test]
fn same_label_twice_gives_distinct_existing_empty_dirs() {
    let pid = std::process::id().to_string();
    for make in [make_temp_home as fn(&str) -> PathBuf, fresh_log_home] {
        let a = make("wi2dup");
        let b = make("wi2dup");
        assert_ne!(a, b, "same label returned the same directory");
        for d in [&a, &b] {
            assert_existing_empty(d);
            let s = d.to_string_lossy();
            assert!(s.contains("wi2dup"), "{s} lacks the label");
            assert!(s.contains(&pid), "{s} lacks the process id {pid}");
        }
    }
}

#[test]
fn later_call_does_not_clobber_earlier_contents() {
    for make in [make_temp_home as fn(&str) -> PathBuf, fresh_log_home] {
        let a = make("wi2keep");
        fs::write(a.join("sentinel.txt"), "keep").unwrap();
        let b = make("wi2keep");
        assert_existing_empty(&b);
        let kept = fs::read_to_string(a.join("sentinel.txt"))
            .unwrap_or_else(|e| panic!("sentinel was clobbered: {:?}", e.kind()));
        assert_eq!(kept, "keep");
    }
}

#[test]
fn injective_under_concurrency() {
    const THREADS: usize = 4;
    const CALLS: usize = 16;
    let barrier = Arc::new(Barrier::new(THREADS));
    let handles: Vec<_> = (0..THREADS)
        .map(|_| {
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                let mut out = Vec::with_capacity(CALLS * 2);
                for _ in 0..CALLS {
                    out.push(make_temp_home("wi2race"));
                    out.push(fresh_log_home("wi2race"));
                }
                out
            })
        })
        .collect();
    let all: Vec<PathBuf> = handles.into_iter().flat_map(|h| h.join().unwrap()).collect();
    assert_eq!(all.len(), THREADS * CALLS * 2);
    let unique: HashSet<&PathBuf> = all.iter().collect();
    assert_eq!(unique.len(), all.len(), "fixture returned a duplicate path");
    for d in &all {
        assert_existing_empty(d);
    }
}
