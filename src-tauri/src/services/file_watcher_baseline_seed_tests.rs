//! D86 WI-3 (matrix r8, r8b, g4b, g3 F3/F4, g3s): the seed module reads once
//! and never under the lock, `read_for_open` returns the bytes it hashed, and
//! a seeded register obeys the WI-2 ticket law like a snapshot register.
use super::super::fixture::{h, TempDir};
use super::super::seam::with_read_hook;
use super::super::{next_ticket, snapshot, BaselineStore, Entry};
use super::read_for_open;
use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;

const SRC: &str = include_str!("file_watcher_baseline_seed.rs");

/// Production part of the seed module, comment lines dropped.
fn code() -> Vec<&'static str> {
    let prod = SRC.split("\n#[cfg(test)]").next().unwrap_or(SRC);
    prod.lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect()
}

/// The lines of the fn whose header contains `anchor`, through its closing
/// brace (brace-counted).
fn body(anchor: &str) -> Vec<&'static str> {
    let lines = code();
    let start = lines
        .iter()
        .position(|l| l.contains(anchor))
        .unwrap_or_else(|| panic!("`{anchor}` not found in the seed module"));
    let mut depth = 0i32;
    let mut opened = false;
    for (i, l) in lines[start..].iter().enumerate() {
        depth += l.matches('{').count() as i32 - l.matches('}').count() as i32;
        opened |= l.contains('{');
        if opened && depth == 0 {
            return lines[start..=start + i].to_vec();
        }
    }
    panic!("`{anchor}` never closes");
}

/// r8: the seed module never takes the lock, and `register_seeded` never
/// reads: it stores the seed it was given through `put`.
#[test]
fn r8_seed_module_never_takes_the_lock_and_never_rereads() {
    let all = code();
    assert!(all.len() > 5, "non-vacuity: the scan sees code");
    for line in &all {
        assert!(
            !line.contains(".lock(") && !line.contains("locked("),
            "{line}"
        );
    }
    let reg = body("fn register_seeded").join("\n");
    for banned in [
        "snapshot(",
        "coherent_read(",
        "read_once(",
        "File::open(",
        "fs::read",
        "read_for_open(",
    ] {
        assert!(
            !reg.contains(banned),
            "`{banned}` in register_seeded:\n{reg}"
        );
    }
    assert!(
        reg.contains("put(") || reg.contains("put_at("),
        "non-vacuity: register_seeded stores through put:\n{reg}"
    );
    let rfo = body("fn read_for_open").join("\n");
    assert_eq!(rfo.matches("read_once(").count(), 1, "{rfo}");
}

/// The binding `let NAME = read_once(` introduces, or `None` for a
/// destructuring `let ReadOnce { .. } = read_once(`.
fn read_binding(line: &str) -> Option<String> {
    let lhs = line
        .trim()
        .strip_prefix("let ")?
        .split(" = read_once(")
        .next()?;
    (!lhs.starts_with("ReadOnce")).then(|| lhs.trim().to_string())
}

/// The first top-level element of the tuple in `Ok((…))`.
fn first_ok_element(text: &str) -> String {
    let start = text.find("Ok((").expect("an `Ok((` return") + "Ok((".len();
    let mut depth = 0i32;
    for (i, c) in text[start..].char_indices() {
        match c {
            '(' | '{' | '[' => depth += 1,
            ')' | '}' | ']' => depth -= 1,
            ',' if depth == 0 => return text[start..start + i].trim().to_string(),
            _ => {}
        }
    }
    panic!("no top-level `,` in the Ok tuple: {text}");
}

/// r8b: `read_for_open` reads once, through `read_once`, and returns the
/// bytes of that read, never the bytes of another read.
#[test]
fn r8b_read_for_open_returns_the_bytes_it_hashed() {
    let lines = body("fn read_for_open");
    let text = lines.join("\n");
    assert!(text.contains("fn read_for_open"), "non-vacuity");
    assert!(lines.len() > 3, "non-vacuity: a real body:\n{text}");
    assert_eq!(text.matches("read_once(").count(), 1, "(i):\n{text}");
    for banned in [
        "fs::",
        "File::",
        "OpenOptions",
        "read_to_end",
        "read_to_string",
        "snapshot(",
        "coherent_read(",
        "stat_of(",
    ] {
        assert!(!text.contains(banned), "(ii) `{banned}`:\n{text}");
    }
    let call = lines
        .iter()
        .find(|l| l.contains("read_once("))
        .expect("the read_once line");
    let first = first_ok_element(&text);
    match read_binding(call) {
        Some(binding) => assert_eq!(first, format!("{binding}.bytes"), "(iii):\n{text}"),
        None => {
            assert!(call.contains("bytes"), "(iii) destructures bytes: {call}");
            assert_eq!(first, "bytes", "(iii):\n{text}");
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Op {
    S(usize, Entry, u64),
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

fn every_order(files: &[PathBuf], ops: &[Op], check: impl Fn(&BaselineStore, &[Op])) {
    let orders = permutations(ops.len());
    assert_eq!(orders.len(), (1..=ops.len()).product::<usize>());
    for order in orders {
        let store = BaselineStore::default();
        let applied: Vec<Op> = order.iter().map(|&i| ops[i]).collect();
        for op in &applied {
            match *op {
                Op::S(f, seed, t) => {
                    store.register_seeded(&files[f], seed, t);
                }
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

/// g4b: last writer by ticket wins, seed or snapshot alike, in every order.
#[test]
fn g4b_last_writer_wins_with_seeded_registers() {
    let d = TempDir::new("g4b");
    let files = vec![d.file("a.md", b"aaa"), d.file("b.md", b"bbb")];
    let (a, b) = (&files[0], &files[1]);
    let seed_x = read_for_open(&d.file("x.md", b"xxxx")).expect("read x").1;
    let seed_y = read_for_open(&d.file("y.md", b"yyyyyy")).expect("read y").1;
    assert_eq!(seed_x.hash, h(b"xxxx"), "precondition: a real seed");
    assert_eq!(seed_y.hash, h(b"yyyyyy"), "precondition: a real seed");
    assert_ne!(seed_x, seed_y, "precondition: distinct seeds");
    assert_ne!(Some(seed_y), Some(snapshot(a)), "precondition");
    let t: Vec<u64> = (0..5).map(|_| next_ticket()).collect();
    let ops = [
        Op::S(0, seed_x, t[0]),
        Op::R(0, t[1]),
        Op::X(0, t[2]),
        Op::S(0, seed_y, t[3]),
        Op::R(1, t[4]),
    ];
    every_order(&files, &ops, |store, applied| {
        assert_eq!(store.get(a), Some(seed_y), "{applied:?}");
        assert_eq!(store.latest_of(a), Some(t[3]), "{applied:?}");
        assert_eq!(store.get(b), Some(snapshot(b)), "{applied:?}");
        assert_eq!(store.len(), 2, "{applied:?}");
    });
    let ops = [
        Op::S(0, seed_x, t[0]),
        Op::R(0, t[1]),
        Op::X(0, t[2]),
        Op::R(1, t[4]),
    ];
    every_order(&files, &ops, |store, applied| {
        assert_eq!(store.get(a), None, "a removed last: {applied:?}");
        assert_eq!(store.latest_of(a), Some(t[2]), "{applied:?}");
        assert_eq!(store.get(b), Some(snapshot(b)), "{applied:?}");
        assert_eq!(store.len(), 1, "{applied:?}");
    });
}

type Refresh = fn(&BaselineStore, &Path);
const IF_PRESENT: Refresh = |s, p| s.refresh_if_present(p);
const AFTER_SAVE: Refresh = |s, p| s.refresh_after_save(p, b"bbbb");
const BOTH: [(&str, Refresh); 2] = [("if_present", IF_PRESENT), ("after_save", AFTER_SAVE)];

/// g3 leg F, WI-3 form (F3, F4): a remove then a seeded register equal to
/// the copied entry lands inside the refresh's read; the seed survives.
#[test]
fn g3_f_seeded_newer_writer_with_an_equal_value_survives_the_refresh() {
    for (leg, refresh) in BOTH {
        let d = TempDir::new(&format!("g3f_seed_{leg}"));
        let p = d.file("a.md", b"aaaa");
        let store = Arc::new(BaselineStore::default());
        store.register(&p);
        let seed_a = read_for_open(&p).expect("read").1;
        assert_eq!(Some(seed_a), store.get(&p), "{leg}: precondition");
        assert_eq!(seed_a.hash, h(b"aaaa"), "{leg}");
        fs::write(&p, b"bbbb").expect("rewrite bbbb");
        let ran = Rc::new(Cell::new(false));
        let (s2, p2, r2) = (Arc::clone(&store), p.clone(), Rc::clone(&ran));
        let hook = move || {
            s2.remove(&p2);
            s2.register_seeded(&p2, seed_a, next_ticket());
            r2.set(true);
        };
        with_read_hook(hook, || refresh(&store, &p));
        assert!(ran.get(), "{leg}: precondition: the hook fired in the read");
        assert_eq!(store.get(&p), Some(seed_a), "{leg}: the seed survives");
        assert_eq!(store.len(), 1, "{leg}");
    }
}

/// g3s: leg A with a seeded register of `"cccc"` inside the refresh's read.
#[test]
fn g3s_seeded_register_inside_the_refresh_read_wins() {
    for (leg, refresh) in BOTH {
        let d = TempDir::new(&format!("g3s_{leg}"));
        let p = d.file("a.md", b"aaaa");
        let store = Arc::new(BaselineStore::default());
        store.register(&p);
        fs::write(&p, b"bbbb").expect("rewrite bbbb");
        let seeded = Rc::new(Cell::new(None));
        let (s2, p2, out) = (Arc::clone(&store), p.clone(), Rc::clone(&seeded));
        let hook = move || {
            fs::write(&p2, b"cccc").expect("write cccc");
            let seed = read_for_open(&p2).expect("read cccc").1;
            s2.register_seeded(&p2, seed, next_ticket());
            out.set(Some(seed));
        };
        with_read_hook(hook, || refresh(&store, &p));
        let seed = seeded.get().expect("precondition: the hook fired");
        assert_eq!(seed.hash, h(b"cccc"), "{leg}: precondition");
        assert_eq!(store.get(&p), Some(seed), "{leg}: the seed survives");
        assert_eq!(store.len(), 1, "{leg}");
    }
}
