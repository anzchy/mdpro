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
    assert_fifo_entry(&store, &pipe, b"x", "register phase");

    let plain2 = d.file("plain2.md", b"plain two");
    let refresh: fn(&BaselineStore, &Path) = BaselineStore::refresh_if_present;
    assert_store_usable_while_blocked(&store, &pipe, &plain2, refresh, b"y");
    assert_fifo_entry(&store, &pipe, b"y", "refresh phase");
}

/// D86-WI-1: feeding a FIFO moves its mtime/ctime past the reader's first
/// fstat, so a blocked read is unstable and fails open (hash `None`). The
/// writer can still win the race, in which case the read is stable.
#[cfg(unix)]
fn assert_fifo_entry(store: &BaselineStore, pipe: &Path, fed: &[u8], phase: &str) {
    let e = store
        .get(pipe)
        .unwrap_or_else(|| panic!("{phase}: entry stored"));
    assert!(e.stat.is_some(), "{phase}: stat recorded");
    assert!(
        e.hash.is_none() || e.hash == h(fed),
        "{phase}: hash is None (fail open) or the fed bytes, got {:?}",
        e.hash
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
// D86 WI-1: the read module (`read_once`, `coherent_read`, `snapshot`) is
// scanned too, so it can neither lock nor be called under the lock.
const READ_SRC: &str = include_str!("file_watcher_baseline_read.rs");
// D86 WI-2: the ticket module (`register_at`, `remove_at`, `admit`) too.
const GEN_SRC: &str = include_str!("file_watcher_baseline_gen.rs");
// D86 WI-3: the open path's seed module (`read_for_open`, `register_seeded`).
const SEED_SRC: &str = include_str!("file_watcher_baseline_seed.rs");
// D112 refactor: `is_filtered_kind`, moved out of the parent.
const KIND_SRC: &str = include_str!("file_watcher_baseline_kind.rs");
// D112-WI-2: `is_unchanged_why` and `is_unchanged`, moved out of the parent.
const CHECK_SRC: &str = include_str!("file_watcher_baseline_check.rs");
const HELPERS: [&str; 4] = ["copy_out", "put", "put_if_present", "take"];
const OPS: [&str; 5] = [
    "register",
    "refresh_if_present",
    "remove",
    "is_unchanged",
    "is_unchanged_why",
];
// WI-4b: the K5 test hook may do I/O, so no map helper may reach it.
const IO_TOKENS: [&str; 14] = [
    "between_read_and_restat(",
    "coherent_read(",
    "coherent_read_upto(",
    "read_once_upto(",
    "read_once(",
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

/// `fn <name>` on this line, after any `pub` / `pub(crate)` / `pub(super)`.
fn fn_name(line: &str) -> Option<&str> {
    let t = line.trim_start();
    let t = t
        .strip_prefix("pub(crate) ")
        .or_else(|| t.strip_prefix("pub(super) "))
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
    let mut lines = owned_lines(SRC);
    lines.extend(owned_lines(READ_SRC));
    lines.extend(owned_lines(GEN_SRC));
    lines.extend(owned_lines(SEED_SRC));
    lines.extend(owned_lines(KIND_SRC));
    lines.extend(owned_lines(CHECK_SRC));
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
    // D112-WI-2: `is_unchanged` delegates to `is_unchanged_why`, so the
    // copy-out and the I/O are pinned on the latter.
    assert!(
        body("is_unchanged")
            .iter()
            .any(|l| l.contains("is_unchanged_why(")),
        "is_unchanged delegates to is_unchanged_why"
    );
    let why = body("is_unchanged_why");
    assert!(
        why.iter().any(|l| l.contains("copy_out(")),
        "is_unchanged_why copies out"
    );
    assert!(
        why.iter().any(|l| IO_TOKENS.iter().any(|t| l.contains(t))),
        "non-vacuity: is_unchanged_why does I/O (outside the helpers)"
    );
}
