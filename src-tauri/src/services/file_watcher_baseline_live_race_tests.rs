//! D32 WI-5 (matrix L6-L8): `watch` / `unwatch` and routing share the
//! baseline store without deadlock, same-path contention stays fail-safe,
//! and no file bytes are read under the watcher locks (ADR-0068).
//!
//! Every case runs under `TempHome`: `watch` / `unwatch` log through the real
//! logger, which writes to `$HOME/.mdpro/mdpro.log`.
use super::super::{mark_write_end, mark_write_start, FileWatcher, WatchOutcome};
use super::fixture::{ev, TempDir, CONTENT, EXTENDED};
use super::snapshot;
use crate::services::draft::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

#[allow(clippy::duplicate_mod, dead_code)]
#[path = "draft/draft_test_home.rs"]
mod draft_test_home;
use draft_test_home::TempHome;

const JOIN_TIMEOUT: Duration = Duration::from_secs(10);
/// watch/unwatch rounds per thread. A real FSEvents `watch` or `unwatch`
/// costs about 45 ms (measured: 240 ops in about 11 s), so the matrix's 200
/// rounds (1,600 ops in L6) cannot finish within `JOIN_TIMEOUT` even with no
/// baseline wiring at all. Routing stays at `ROUTES`, since it is cheap and
/// interleaves many times with each watch op.
const LOOPS: usize = 10;
const ROUTES: usize = 400;

fn home(label: &str) -> TempHome {
    TempHome::new(&format!("d32_wi5_{label}_{}", std::process::id()))
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Spawn `body`, which reports its outcomes (if any) on `tx` when done.
fn spawn<F>(tx: &mpsc::Sender<Vec<WatchOutcome>>, body: F)
where
    F: FnOnce() -> Vec<WatchOutcome> + Send + 'static,
{
    let tx = tx.clone();
    thread::spawn(move || {
        let _ = tx.send(body());
    });
}

/// Join `n` threads through `rx`, each within `JOIN_TIMEOUT`.
fn join_all(rx: &mpsc::Receiver<Vec<WatchOutcome>>, n: usize) -> Vec<WatchOutcome> {
    (0..n)
        .flat_map(|i| {
            rx.recv_timeout(JOIN_TIMEOUT)
                .unwrap_or_else(|e| panic!("thread {i} of {n} did not finish: {e}"))
        })
        .collect()
}

/// L6: per-thread paths, watch/unwatch loops, routing and self-write marks
/// all finish, and afterwards "watched" and "has an entry" agree per path.
#[test]
fn l6_concurrent_watch_unwatch_and_routing_do_not_deadlock() {
    let _home = home("l6");
    let d = TempDir::new("l6");
    let paths: Arc<Vec<PathBuf>> = Arc::new(
        (0..4)
            .map(|i| d.file(&format!("p{i}.md"), b"abc"))
            .collect(),
    );
    let fw = Arc::new(FileWatcher::for_tests());
    let (tx, rx) = mpsc::channel();

    for i in 0..4 {
        let (fw, paths) = (Arc::clone(&fw), Arc::clone(&paths));
        spawn(&tx, move || {
            for _ in 0..LOOPS {
                fw.watch(&paths[i]);
                fw.unwatch(&paths[i]);
            }
            if i % 2 == 0 {
                fw.watch(&paths[i]);
            }
            Vec::new()
        });
    }
    for r in 0..2 {
        let (fw, paths) = (Arc::clone(&fw), Arc::clone(&paths));
        spawn(&tx, move || {
            (0..ROUTES)
                .map(|k| {
                    let kind = if (k + r) % 2 == 0 { EXTENDED } else { CONTENT };
                    fw.route_for_tests(&ev(kind, &[&paths[k % 4]])).1
                })
                .collect()
        });
    }
    let p0 = paths[0].clone();
    spawn(&tx, move || {
        for _ in 0..ROUTES {
            mark_write_start(&p0);
            mark_write_end(&p0);
        }
        Vec::new()
    });
    join_all(&rx, 7);

    for (i, p) in paths.iter().enumerate() {
        assert_eq!(fw.baseline_of(p).is_some(), i % 2 == 0, "entry for p{i}");
    }
    let mut watched = fw.watched();
    watched.sort();
    assert_eq!(watched, vec![s(&paths[0]), s(&paths[2])]);
}

/// L7: two threads racing watch/unwatch on one unchanged file, plus routing:
/// no deadlock, any entry is the file's own snapshot, at most one entry.
#[test]
fn l7_same_path_watch_unwatch_contention_is_fail_safe() {
    let _home = home("l7");
    let d = TempDir::new("l7");
    let p = Arc::new(d.file("same.md", b"abc"));
    let expected = snapshot(&p);
    let fw = Arc::new(FileWatcher::for_tests());
    let (tx, rx) = mpsc::channel();

    for _ in 0..2 {
        let (fw, p) = (Arc::clone(&fw), Arc::clone(&p));
        spawn(&tx, move || {
            for _ in 0..LOOPS {
                fw.watch(&p);
                fw.unwatch(&p);
            }
            Vec::new()
        });
    }
    let (fw2, p2) = (Arc::clone(&fw), Arc::clone(&p));
    spawn(&tx, move || {
        (0..ROUTES)
            .map(|_| fw2.route_for_tests(&ev(EXTENDED, &[&p2])).1)
            .collect()
    });
    let outcomes = join_all(&rx, 3);

    assert_eq!(outcomes.len(), ROUTES, "precondition: every route reported");
    if let Some(entry) = fw.baseline_of(&p) {
        assert_eq!(entry, expected, "an entry holds only the file's bytes");
    }
    assert!(fw.baselines().len() <= 1, "len {}", fw.baselines().len());
    for o in &outcomes {
        assert!(
            matches!(
                o,
                WatchOutcome::IgnoredUnchanged
                    | WatchOutcome::EmittedModified
                    | WatchOutcome::Debounced
            ),
            "unexpected outcome {o:?}"
        );
    }
    assert!(fw.watched().len() <= 1, "{:?}", fw.watched());
}

#[cfg(unix)]
fn mkfifo(p: &Path) {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(p.as_os_str().as_bytes()).unwrap();
    // SAFETY: `c` is a valid NUL-terminated path that outlives the call.
    assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0, "mkfifo");
}

/// Open the FIFO's write end without blocking (fails when no reader waits),
/// which releases a reader blocked in `open`; the end closes at once (EOF).
#[cfg(unix)]
fn release(p: &Path) {
    use std::os::unix::fs::OpenOptionsExt;
    let _ = std::fs::OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(p);
}

/// L8: while one `watch` is blocked reading a FIFO's bytes, another path's
/// `watch` / `unwatch` still completes, so the read runs under neither the
/// watcher lock nor the list lock.
#[test]
fn l8_watch_does_not_read_file_bytes_under_the_watcher_locks() {
    let _home = home("l8");
    let d = TempDir::new("l8");
    let pipe = d.path().join("pipe.md");
    mkfifo(&pipe);
    let plain = d.file("plain.md", b"abc");
    let fw = Arc::new(FileWatcher::for_tests());

    let (tx_a, rx_a) = mpsc::channel();
    let (fw_a, pipe_a) = (Arc::clone(&fw), pipe.clone());
    thread::spawn(move || {
        fw_a.watch(&pipe_a);
        let _ = tx_a.send(());
    });
    thread::sleep(Duration::from_millis(100));
    let a_blocked = rx_a.try_recv().is_err();

    let (tx_b, rx_b) = mpsc::channel();
    let (fw_b, plain_b) = (Arc::clone(&fw), plain.clone());
    thread::spawn(move || {
        fw_b.watch(&plain_b);
        fw_b.unwatch(&plain_b);
        let _ = tx_b.send(());
    });
    let b_done = rx_b.recv_timeout(Duration::from_secs(2)).is_ok();

    release(&pipe);
    let a_done = rx_a.recv_timeout(Duration::from_secs(2)).is_ok() || !a_blocked;
    assert!(
        a_blocked,
        "precondition: watch(pipe) blocks reading the FIFO"
    );
    assert!(
        b_done,
        "watch/unwatch of another path finished while A was blocked"
    );
    assert!(a_done, "watch(pipe) finished once the FIFO had a writer");
    assert!(fw.watched().contains(&s(&pipe)), "{:?}", fw.watched());
}
