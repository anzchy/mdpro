// D32 WI-3: lock L5 is a leaf with no I/O under it (matrix B14, B15, and the
// coordinator addendum's B18′, which replaces B18's guard-scope parser).
use super::fixture::{h, TempDir};
use super::{snapshot, BaselineStore};
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const BLOCKED_PROBE: Duration = Duration::from_millis(100);
const TIMEOUT: Duration = Duration::from_secs(2);

#[cfg(unix)]
fn mkfifo(p: &Path) {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(p.as_os_str().as_bytes()).unwrap();
    // SAFETY: `c` is a valid NUL-terminated path that outlives the call.
    assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0, "mkfifo");
}

/// Open the FIFO for writing once a reader is waiting, write `bytes`, close.
/// Non-blocking open with a deadline, so a missing reader fails, not hangs.
#[cfg(unix)]
fn feed(p: &Path, bytes: &[u8]) {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let deadline = Instant::now() + TIMEOUT;
    loop {
        let opened = std::fs::OpenOptions::new()
            .write(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(p);
        match opened {
            Ok(mut w) => return w.write_all(bytes).expect("write FIFO"),
            Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Err(e) => panic!("no reader opened the FIFO within {TIMEOUT:?}: {e}"),
        }
    }
}

/// While thread A is blocked in `blocked_op` (file I/O on a FIFO), thread B
/// runs every store operation on `plain` and must finish. `bytes` unblocks A.
#[cfg(unix)]
fn assert_store_usable_while_blocked(
    store: &BaselineStore,
    pipe: &Path,
    plain: &Path,
    blocked_op: fn(&BaselineStore, &Path),
    bytes: &[u8],
) {
    thread::scope(|s| {
        let (tx_a, rx_a) = mpsc::channel();
        s.spawn(move || {
            blocked_op(store, pipe);
            let _ = tx_a.send(());
        });
        thread::sleep(BLOCKED_PROBE);
        assert!(
            rx_a.try_recv().is_err(),
            "precondition: A is blocked in I/O"
        );
        let (tx_b, rx_b) = mpsc::channel();
        s.spawn(move || {
            store.register(plain);
            let got = store.get(plain);
            store.refresh_if_present(plain);
            let _ = tx_b.send((got, store.is_unchanged(plain)));
        });
        let b = rx_b.recv_timeout(TIMEOUT);
        feed(pipe, bytes);
        assert!(rx_a.recv_timeout(TIMEOUT).is_ok(), "A completes once fed");
        let (got, unchanged) = b.expect("B finished while A was blocked in I/O");
        assert_eq!(got, Some(snapshot(plain)));
        assert!(unchanged, "B's own file is unchanged");
    });
}

/// B14: `register` and `refresh_if_present` do their file I/O outside the
/// lock, so a read that blocks does not block other store users.
#[cfg(unix)]
#[test]
fn b14_store_lock_is_not_held_across_file_io_in_register_and_refresh() {
    let d = TempDir::new("b14");
    let pipe = d.path().join("pipe.md");
    mkfifo(&pipe);
    let store = BaselineStore::default();

    let plain = d.file("plain.md", b"plain");
    assert_store_usable_while_blocked(&store, &pipe, &plain, BaselineStore::register, b"x");
    assert_eq!(
        store.get(&pipe).and_then(|e| e.hash),
        h(b"x"),
        "register phase"
    );

    let plain2 = d.file("plain2.md", b"plain two");
    let refresh: fn(&BaselineStore, &Path) = BaselineStore::refresh_if_present;
    assert_store_usable_while_blocked(&store, &pipe, &plain2, refresh, b"y");
    assert_eq!(
        store.get(&pipe).and_then(|e| e.hash),
        h(b"y"),
        "refresh phase"
    );
}

/// B15: a poisoned lock is recovered; no operation panics, and the store
/// still records and fails open.
#[test]
fn b15_store_survives_a_poisoned_lock_without_panicking() {
    let d = TempDir::new("b15");
    let p = d.file("p.md", b"poison");
    let store = BaselineStore::default();
    store.poison_for_tests();
    let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        store.register(&p);
        let registered = store.get(&p);
        store.remove(&p);
        store.refresh_if_present(&p);
        (registered, store.is_unchanged(&p), store.len())
    }));
    let (registered, unchanged, len) = run.expect("no panic on a poisoned lock");
    assert_eq!(registered, Some(snapshot(&p)), "register still records");
    assert!(!unchanged, "fails open after remove");
    assert_eq!(len, 0);
}

const SRC: &str = include_str!("file_watcher_baseline.rs");
const HELPERS: [&str; 4] = ["copy_out", "put", "put_if_present", "take"];
const OPS: [&str; 4] = ["register", "refresh_if_present", "remove", "is_unchanged"];
// WI-4b: the K5 test hook may do I/O, so no map helper may reach it.
const IO_TOKENS: [&str; 10] = [
    "between_read_and_restat(",
    "snapshot(",
    "metadata(",
    "File::open(",
    "fs::",
    "read(",
    "canonicalize(",
    "baseline_key(",
    "read_capped(",
    "stat_of(",
];

/// `fn <name>` on this line, after any `pub` / `pub(crate)`.
fn fn_name(line: &str) -> Option<&str> {
    let t = line.trim_start();
    let t = t
        .strip_prefix("pub(crate) ")
        .or_else(|| t.strip_prefix("pub "))
        .unwrap_or(t);
    let rest = t.strip_prefix("fn ")?;
    let end = rest.find(|c: char| !(c.is_alphanumeric() || c == '_'))?;
    Some(&rest[..end])
}

/// Each non-comment line of the non-test code, with the fn it belongs to
/// ("" outside any fn). A column-0 line that is not a fn header ends a fn.
fn owned_lines(src: &str) -> Vec<(&str, &str)> {
    let production = src.split("\n#[cfg(test)]").next().unwrap_or(src);
    let mut owner = "";
    production
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .map(|line| {
            if let Some(name) = fn_name(line) {
                owner = name;
            } else if !line.is_empty() && !line.starts_with(char::is_whitespace) {
                owner = "";
            }
            (owner, line)
        })
        .collect()
}

/// B18′: the mutex is taken only in `locked()`, only the four map helpers
/// call `locked()`, and those helpers do no I/O.
#[test]
fn b18_prime_lock_only_in_locked_and_only_io_free_helpers_use_it() {
    let lines = owned_lines(SRC);
    let defined: Vec<&str> = lines.iter().filter_map(|(_, l)| fn_name(l)).collect();
    for name in HELPERS.iter().chain(&OPS).chain(&["locked"]) {
        assert!(defined.contains(name), "non-vacuity: fn {name} exists");
    }
    let lock_owners: Vec<&str> = lines
        .iter()
        .filter(|(_, l)| l.contains(".lock("))
        .map(|(o, _)| *o)
        .collect();
    assert_eq!(
        lock_owners,
        vec!["locked"],
        "(i) one `.lock(`, inside fn locked"
    );
    let callers: Vec<&str> = lines
        .iter()
        .filter(|(_, l)| l.contains("locked(") && fn_name(l) != Some("locked"))
        .map(|(o, _)| *o)
        .collect();
    assert!(!callers.is_empty(), "non-vacuity: `locked(` is called");
    for caller in &callers {
        assert!(
            HELPERS.contains(caller),
            "(ii) `locked(` called from {caller}"
        );
    }
    for (owner, line) in &lines {
        if HELPERS.contains(owner) {
            for token in IO_TOKENS {
                assert!(!line.contains(token), "(iii) {owner} does I/O: {line}");
            }
        }
        if OPS.contains(owner) {
            assert!(
                !line.contains("locked(") && !line.contains(".lock("),
                "{owner}: {line}"
            );
        }
    }
    let body = |name: &str| -> Vec<&str> {
        lines
            .iter()
            .filter(|(o, _)| *o == name)
            .map(|(_, l)| *l)
            .collect()
    };
    let is_unchanged = body("is_unchanged");
    assert!(
        is_unchanged.iter().any(|l| l.contains("copy_out(")),
        "is_unchanged copies out"
    );
    assert!(
        is_unchanged
            .iter()
            .any(|l| IO_TOKENS.iter().any(|t| l.contains(t))),
        "non-vacuity: is_unchanged does I/O (outside the helpers)"
    );
}
