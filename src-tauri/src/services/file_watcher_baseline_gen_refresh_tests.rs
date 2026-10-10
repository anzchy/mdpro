//! D86 WI-2 (matrix g3, legs A-F): a refresh never overwrites a newer
//! writer. `refresh_if_present` and `refresh_after_save` compare the slot
//! generation `copy_out` captured with the slot's generation at store time,
//! so a register or remove landing inside the refresh's read wins. The read
//! hook fires inside the refresh's snapshot, outside the lock.
use super::super::fixture::{h, rewrite_keep_stat, TempDir};
use super::super::seam::with_read_hook;
use super::super::{baseline_key, snapshot, BaselineStore, Entry};
use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;

type Refresh = fn(&BaselineStore, &Path);

const IF_PRESENT: Refresh = |s, p| s.refresh_if_present(p);
const AFTER_SAVE: Refresh = |s, p| s.refresh_after_save(p, b"bbbb");
const BOTH: [(&str, Refresh); 2] = [("if_present", IF_PRESENT), ("after_save", AFTER_SAVE)];

/// A registered `"aaaa"` file, then rewritten on disk to `"bbbb"`.
fn registered_then_rewritten(d: &TempDir, raw: &Path) -> Arc<BaselineStore> {
    let store = Arc::new(BaselineStore::default());
    store.register(raw);
    fs::write(raw, b"bbbb").expect("rewrite bbbb");
    let _ = d;
    store
}

/// The newer register (`"cccc"`) the hook made is what the slot holds.
fn assert_newer_register_kept(store: &BaselineStore, p: &Path, leg: &str) {
    let want = snapshot(p);
    assert_eq!(want.hash, h(b"cccc"), "{leg}: precondition: disk is cccc");
    let refresh_alone = Entry {
        stat: want.stat,
        hash: None,
    };
    assert_ne!(want, refresh_alone, "{leg}: precondition: outcomes differ");
    assert_eq!(
        store.get(p),
        Some(want),
        "{leg}: the newer register survives"
    );
    assert_eq!(store.len(), 1, "{leg}");
}

/// Hook: write `"cccc"` and re-register `raw` (a fresh, higher ticket).
fn reregister_cccc(store: &Arc<BaselineStore>, raw: &Path) -> impl FnOnce() + 'static {
    let (s2, p2) = (Arc::clone(store), raw.to_path_buf());
    move || {
        fs::write(&p2, b"cccc").expect("write cccc");
        s2.register(&p2);
    }
}

/// g3 legs A (`refresh_if_present`) and B (`refresh_after_save`).
#[test]
fn g3_ab_refresh_after_reregister_does_not_clobber() {
    for (leg, refresh) in BOTH {
        let d = TempDir::new(&format!("g3ab_{leg}"));
        let p = d.file("a.md", b"aaaa");
        let store = registered_then_rewritten(&d, &p);
        with_read_hook(reregister_cccc(&store, &p), || refresh(&store, &p));
        assert_newer_register_kept(&store, &p, leg);
    }
}

/// g3 leg C (control): with no interleaving the refresh advances.
#[test]
fn g3_c_refresh_without_interleaving_advances() {
    for (leg, refresh) in BOTH {
        let d = TempDir::new(&format!("g3c_{leg}"));
        let p = d.file("a.md", b"aaaa");
        let store = registered_then_rewritten(&d, &p);
        refresh(&store, &p);
        assert_eq!(store.get(&p).and_then(|e| e.hash), h(b"bbbb"), "{leg}");
    }
}

/// `d/real/a.md = "aaaa"`, `d/link -> d/real`; returns `(raw, canonical)`.
fn linked(d: &TempDir) -> (PathBuf, PathBuf) {
    let real = d.path().join("real");
    fs::create_dir(&real).expect("mkdir real");
    fs::write(real.join("a.md"), b"aaaa").expect("write");
    std::os::unix::fs::symlink(&real, d.path().join("link")).expect("symlink");
    let raw = d.path().join("link").join("a.md");
    let canon = fs::canonicalize(&raw).expect("canonicalize");
    assert_ne!(canon, raw, "precondition: two spellings");
    assert_eq!(
        baseline_key(&canon),
        baseline_key(&raw),
        "precondition: one key"
    );
    (raw, canon)
}

/// g3 legs D and D′: registered by the raw spelling, refreshed by the
/// canonical one (as notify reports it). The check never looks up `latest`
/// by the refresh's spelling.
#[test]
fn g3_d_refresh_by_another_spelling_does_not_clobber() {
    for (leg, refresh) in BOTH {
        let d = TempDir::new(&format!("g3d_{leg}"));
        let (raw, canon) = linked(&d);
        let store = registered_then_rewritten(&d, &raw);
        with_read_hook(reregister_cccc(&store, &raw), || refresh(&store, &canon));
        assert_newer_register_kept(&store, &raw, leg);
    }
}

/// g3 leg E: a remove inside the refresh's read leaves the slot empty; a
/// refresh never inserts.
#[test]
fn g3_e_refresh_into_a_removed_slot_never_inserts() {
    for (leg, refresh) in BOTH {
        let d = TempDir::new(&format!("g3e_{leg}"));
        let p = d.file("a.md", b"aaaa");
        let store = registered_then_rewritten(&d, &p);
        let ran = Rc::new(Cell::new(false));
        let (s2, p2, r2) = (Arc::clone(&store), p.clone(), Rc::clone(&ran));
        let hook = move || {
            r2.set(true);
            s2.remove(&p2);
        };
        with_read_hook(hook, || refresh(&store, &p));
        assert!(ran.get(), "{leg}: precondition: the hook fired in the read");
        assert_eq!(store.len(), 0, "{leg}");
        assert_eq!(store.get(&p), None, "{leg}");
    }
}

/// g3 leg F (WI-2 form): the newer writer's entry equals the one the refresh
/// copied out (remove, restore, re-register). Neither a value compare nor a
/// per-slot counter restarting on insert may let the refresh through.
#[test]
fn g3_f_refresh_does_not_clobber_an_equal_valued_newer_writer() {
    for (leg, refresh) in BOTH {
        let d = TempDir::new(&format!("g3f_{leg}"));
        let p = d.file("a.md", b"aaaa");
        let store = Arc::new(BaselineStore::default());
        store.register(&p);
        let e0 = store.get(&p);
        assert_eq!(e0.and_then(|e| e.hash), h(b"aaaa"), "{leg}: precondition");
        rewrite_keep_stat(&p, b"bbbb");
        let ran = Rc::new(Cell::new(false));
        let (s2, p2, r2) = (Arc::clone(&store), p.clone(), Rc::clone(&ran));
        let hook = move || {
            s2.remove(&p2);
            rewrite_keep_stat(&p2, b"aaaa");
            s2.register(&p2);
            assert_eq!(
                s2.get(&p2),
                e0,
                "precondition: an equal-valued newer writer"
            );
            r2.set(true);
        };
        with_read_hook(hook, || refresh(&store, &p));
        assert!(ran.get(), "{leg}: precondition: the hook fired in the read");
        assert_eq!(store.get(&p), e0, "{leg}: the newer writer survives");
        assert_eq!(store.len(), 1, "{leg}");
    }
}
