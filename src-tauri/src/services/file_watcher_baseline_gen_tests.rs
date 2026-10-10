//! D86 WI-2 (matrix g1, g1b, g2, g4, g5, g7, r7c): ticketed `register_at` /
//! `remove_at`. Last writer by ticket wins, whatever the arrival order, and a
//! remove leaves a raw-keyed tombstone so a slow register cannot undo it.
//! Single-threaded: the read hook replays the interleaving inside the
//! register's snapshot, outside the lock. Tickets are drawn from the global
//! counter in program order, never written as literals (plan issue P7).
use super::super::fixture::TempDir;
use super::super::seam::with_read_hook;
use super::super::{baseline_key, snapshot, BaselineStore};
use super::{next_ticket, StoreOutcome};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// g1a, the behavioural red through the plain API: a remove landing inside
/// a register's read must not be undone by that register.
#[test]
fn g1a_plain_remove_inside_registers_read_is_not_undone() {
    let d = TempDir::new("g1a");
    let p = d.file("a.md", b"abc");
    let store = Arc::new(BaselineStore::default());
    let (s2, p2) = (Arc::clone(&store), p.clone());
    with_read_hook(move || s2.remove(&p2), || store.register(&p));
    assert_eq!(store.get(&p), None, "the unwatch stands");
    assert_eq!(store.len(), 0);
}

/// g1: a register whose snapshot finishes after a newer remove does not
/// insert, and the remove's ticket stays as the tombstone.
#[test]
fn g1_stale_register_after_remove_does_not_resurrect() {
    let d = TempDir::new("g1");
    let p = d.file("a.md", b"abc");
    let store = Arc::new(BaselineStore::default());
    let t1 = next_ticket();
    let t2 = next_ticket();
    let (s2, p2) = (Arc::clone(&store), p.clone());
    let out = with_read_hook(
        move || {
            s2.remove_at(&p2, t2);
        },
        || store.register_at(&p, t1),
    );
    assert_eq!(out, StoreOutcome::StaleSkipped);
    assert_eq!(store.get(&p), None);
    assert_eq!(store.len(), 0);
    assert_eq!(store.latest_of(&p), Some(t2));
}

/// `d/real/a.md = "aaaa"`, `d/link -> d/real`; returns the raw spelling
/// `d/link/a.md`, asserting its key differs from it.
fn linked(d: &TempDir) -> PathBuf {
    let real = d.path().join("real");
    fs::create_dir(&real).expect("mkdir real");
    fs::write(real.join("a.md"), b"aaaa").expect("write");
    std::os::unix::fs::symlink(&real, d.path().join("link")).expect("symlink");
    let p = d.path().join("link").join("a.md");
    assert_ne!(baseline_key(&p), p, "precondition: raw != canonical");
    p
}

/// Delete `p` and assert its key fell back to the raw path.
fn delete_and_check_key(p: &Path) {
    fs::remove_file(p).expect("unlink");
    assert_eq!(baseline_key(p), p, "precondition: the key changed to raw");
}

/// g1b-a, the behavioural red through the plain API: the file is deleted and
/// the path removed inside the register's read. The remove's key is now
/// raw; the register's key was canonical.
#[test]
fn g1b_a_plain_delete_and_remove_inside_registers_read_is_not_undone() {
    let d = TempDir::new("g1ba");
    let p = linked(&d);
    let store = Arc::new(BaselineStore::default());
    let (s2, p2) = (Arc::clone(&store), p.clone());
    with_read_hook(
        move || {
            delete_and_check_key(&p2);
            s2.remove(&p2);
        },
        || store.register(&p),
    );
    assert_eq!(store.len(), 0, "no entry under any key");
}

/// g1b: `latest` is keyed by the raw path, so a key change on delete cannot
/// hide the tombstone from the stale register.
#[test]
fn g1b_stale_register_after_delete_and_remove_does_not_resurrect() {
    let d = TempDir::new("g1b");
    let p = linked(&d);
    let store = Arc::new(BaselineStore::default());
    let t1 = next_ticket();
    let t2 = next_ticket();
    let (s2, p2) = (Arc::clone(&store), p.clone());
    let out = with_read_hook(
        move || {
            delete_and_check_key(&p2);
            s2.remove_at(&p2, t2);
        },
        || store.register_at(&p, t1),
    );
    assert_eq!(out, StoreOutcome::StaleSkipped);
    assert_eq!(store.len(), 0, "no entry under any key");
    assert_eq!(store.latest_of(&p), Some(t2));
}

/// g2: a remove older than the latest register is ignored.
#[test]
fn g2_stale_remove_after_newer_register_is_ignored() {
    let d = TempDir::new("g2");
    let p = d.file("a.md", b"abc");
    let store = BaselineStore::default();
    let t1 = next_ticket();
    let t2 = next_ticket();
    assert_eq!(
        store.register_at(&p, t2),
        StoreOutcome::Stored(snapshot(&p))
    );
    assert_eq!(store.remove_at(&p, t1), StoreOutcome::StaleSkipped);
    assert_eq!(store.get(&p), Some(snapshot(&p)));
    assert_eq!(store.len(), 1);
    assert_eq!(store.latest_of(&p), Some(t2));
}

#[derive(Clone, Copy, Debug)]
enum Op {
    R(usize, u64),
    X(usize, u64),
}

fn permutations(n: usize) -> Vec<Vec<usize>> {
    if n == 0 {
        return vec![Vec::new()];
    }
    let mut out = Vec::new();
    for rest in permutations(n - 1) {
        for i in 0..=rest.len() {
            let mut v = rest.clone();
            v.insert(i, n - 1);
            out.push(v);
        }
    }
    out
}

/// Apply `ops` in every order to a fresh store; call `check` after each.
fn every_order(files: &[PathBuf], ops: &[Op], check: impl Fn(&BaselineStore, &[Op])) {
    let orders = permutations(ops.len());
    assert_eq!(
        orders.len(),
        (1..=ops.len()).product::<usize>(),
        "all orders"
    );
    for order in orders {
        let store = BaselineStore::default();
        let applied: Vec<Op> = order.iter().map(|&i| ops[i]).collect();
        for op in &applied {
            match *op {
                Op::R(f, t) => {
                    store.register_at(&files[f], t);
                }
                Op::X(f, t) => {
                    store.remove_at(&files[f], t);
                }
            }
        }
        check(&store, &applied);
    }
}

/// g4: the final state is the highest-ticket op's, in every arrival order.
#[test]
fn g4_final_state_is_order_independent_over_ticket_permutations() {
    let d = TempDir::new("g4");
    let files = vec![d.file("a.md", b"aaa"), d.file("b.md", b"bbb")];
    let (a, b) = (&files[0], &files[1]);
    let t: Vec<u64> = (0..5).map(|_| next_ticket()).collect();
    let ops = [
        Op::R(0, t[0]),
        Op::X(0, t[1]),
        Op::R(0, t[2]),
        Op::X(0, t[3]),
        Op::R(1, t[4]),
    ];
    every_order(&files, &ops, |store, applied| {
        assert_eq!(store.get(a), None, "a removed last by ticket: {applied:?}");
        assert_eq!(store.latest_of(a), Some(t[3]), "{applied:?}");
        assert_eq!(store.get(b), Some(snapshot(b)), "{applied:?}");
        assert_eq!(store.latest_of(b), Some(t[4]), "{applied:?}");
        assert_eq!(store.len(), 1, "{applied:?}");
    });
    let ops = [
        Op::R(0, t[0]),
        Op::X(0, t[1]),
        Op::R(0, t[2]),
        Op::R(1, t[4]),
    ];
    every_order(&files, &ops, |store, applied| {
        assert_eq!(
            store.get(a),
            Some(snapshot(a)),
            "a registered last: {applied:?}"
        );
        assert_eq!(store.latest_of(a), Some(t[2]), "{applied:?}");
        assert_eq!(store.get(b), Some(snapshot(b)), "{applied:?}");
        assert_eq!(store.len(), 2, "{applied:?}");
    });
}

/// g5: a tombstone does not block a newer register.
#[test]
fn g5_tombstone_allows_a_fresh_newer_register() {
    let d = TempDir::new("g5");
    let p = d.file("a.md", b"old");
    let store = BaselineStore::default();
    let (t1, t2, t3) = (next_ticket(), next_ticket(), next_ticket());
    store.register_at(&p, t1);
    store.remove_at(&p, t2);
    fs::write(&p, b"new").expect("rewrite");
    store.register_at(&p, t3);
    let want = snapshot(&p);
    assert_eq!(want.hash, super::super::fixture::h(b"new"));
    assert_eq!(store.get(&p), Some(want));
    assert_eq!(store.len(), 1);
}

/// g7: re-applying the same register ticket is idempotent.
#[test]
fn g7_reapplying_the_same_register_ticket_is_idempotent() {
    let d = TempDir::new("g7");
    let p = d.file("a.md", b"abc");
    let store = BaselineStore::default();
    let t = next_ticket();
    for round in 0..2 {
        assert_eq!(
            store.register_at(&p, t),
            StoreOutcome::Stored(snapshot(&p)),
            "{round}"
        );
        assert_eq!(store.get(&p), Some(snapshot(&p)), "{round}");
        assert_eq!(store.len(), 1, "{round}");
        assert_eq!(store.latest_of(&p), Some(t), "{round}");
    }
}

/// r7c: the ticket module never takes the lock (precedent R6, r7).
#[test]
fn r7c_gen_module_never_takes_the_lock() {
    let src = include_str!("file_watcher_baseline_gen.rs");
    let code = src.split("\n#[cfg(test)]").next().unwrap_or(src);
    let code: Vec<&str> = code
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect();
    assert!(code.len() > 5, "non-vacuity: the scan sees code");
    let text = code.join("\n");
    for f in ["fn next_ticket", "fn register_at", "fn remove_at"] {
        assert!(text.contains(f), "non-vacuity: {f}");
    }
    for line in &code {
        assert!(
            !line.contains(".lock(") && !line.contains("locked("),
            "{line}"
        );
    }
}
