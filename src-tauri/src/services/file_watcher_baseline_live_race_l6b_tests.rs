//! D139: L6 (D32 WI-5) with a progress watchdog instead of a wall-clock join.
//!
//! The workload and the end-state checks are L6's, plus two counts (every
//! route reported, every op ticked). Only the join differs.
//! L6 gives the whole run `JOIN_TIMEOUT` (10 s), but its 82 `watch` /
//! `unwatch` calls run one after another under the watcher lock, and each
//! one restarts the FSEvents stream (notify 6.1.1 `watch_inner` /
//! `unwatch_inner`: `stop()` joins the run-loop thread, `run()` starts a new
//! one and waits for it). A restart costs about 5 ms on an idle machine
//! (L6 runs in 0.4 s) and 45-100 ms in a full `rust` lane (8.3 s of the
//! 10 s budget), so L6's budget measured how busy fseventsd and the
//! scheduler were, and it timed out under load.
//!
//! A deadlock stops every thread, so here each finished op ticks a shared
//! counter, and the run fails only if the counter does not move for `STALL`.
//! A slow but live run still passes, however long it takes.
use super::{ev, home, mark_write_end, mark_write_start, s, spawn, TempDir, CONTENT, EXTENDED};
use super::{FileWatcher, WatchOutcome, LOOPS, ROUTES};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The longest a live run may go without finishing one op. The slowest op
/// is one FSEvents restart, about 100 ms at worst in a full lane.
const STALL: Duration = Duration::from_secs(10);
/// How often the join re-reads the progress counter.
const TICK: Duration = Duration::from_millis(20);

/// Join `n` threads through `rx`. Fails if `progress` stops moving for
/// `STALL` before all `n` have reported, which is what a deadlock does.
fn join_while_progressing(
    rx: &mpsc::Receiver<Vec<WatchOutcome>>,
    n: usize,
    progress: &AtomicUsize,
) -> Vec<WatchOutcome> {
    let (mut out, mut joined) = (Vec::new(), 0);
    let (mut seen, mut moved_at) = (progress.load(Ordering::SeqCst), Instant::now());
    while joined < n {
        match rx.recv_timeout(TICK) {
            Ok(outcomes) => {
                out.extend(outcomes);
                joined += 1;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(e) => panic!("join channel closed: {e}"),
        }
        let now = progress.load(Ordering::SeqCst);
        if now != seen {
            (seen, moved_at) = (now, Instant::now());
        }
        assert!(
            moved_at.elapsed() < STALL,
            "no op finished for {STALL:?}: {joined} of {n} threads done after {now} ops"
        );
    }
    out
}

/// L6b: L6's per-thread watch/unwatch loops, routing and self-write marks
/// all finish while making progress, and afterwards "watched" and "has an
/// entry" agree per path.
#[test]
fn l6b_concurrent_watch_unwatch_and_routing_keep_progressing_to_the_end() {
    let _home = home("l6b");
    let d = TempDir::new("l6b");
    let paths: Arc<Vec<PathBuf>> = Arc::new(
        (0..4)
            .map(|i| d.file(&format!("p{i}.md"), b"abc"))
            .collect(),
    );
    let fw = Arc::new(FileWatcher::for_tests());
    let ops = Arc::new(AtomicUsize::new(0));
    let (tx, rx) = mpsc::channel();

    for i in 0..4 {
        let (fw, paths, ops) = (Arc::clone(&fw), Arc::clone(&paths), Arc::clone(&ops));
        spawn(&tx, move || {
            for _ in 0..LOOPS {
                fw.watch(&paths[i]);
                ops.fetch_add(1, Ordering::SeqCst);
                fw.unwatch(&paths[i]);
                ops.fetch_add(1, Ordering::SeqCst);
            }
            if i % 2 == 0 {
                fw.watch(&paths[i]);
                ops.fetch_add(1, Ordering::SeqCst);
            }
            Vec::new()
        });
    }
    for r in 0..2 {
        let (fw, paths, ops) = (Arc::clone(&fw), Arc::clone(&paths), Arc::clone(&ops));
        spawn(&tx, move || {
            (0..ROUTES)
                .map(|k| {
                    let kind = if (k + r) % 2 == 0 { EXTENDED } else { CONTENT };
                    let outcome = fw.route_for_tests(&ev(kind, &[&paths[k % 4]])).1;
                    ops.fetch_add(1, Ordering::SeqCst);
                    outcome
                })
                .collect()
        });
    }
    let (p0, marks) = (paths[0].clone(), Arc::clone(&ops));
    spawn(&tx, move || {
        for _ in 0..ROUTES {
            mark_write_start(&p0);
            mark_write_end(&p0);
            marks.fetch_add(1, Ordering::SeqCst);
        }
        Vec::new()
    });
    let outcomes = join_while_progressing(&rx, 7, &ops);

    assert_eq!(
        outcomes.len(),
        2 * ROUTES,
        "precondition: every route reported"
    );
    assert_eq!(ops.load(Ordering::SeqCst), 4 * 2 * LOOPS + 2 + 3 * ROUTES);
    for (i, p) in paths.iter().enumerate() {
        assert_eq!(fw.baseline_of(p).is_some(), i % 2 == 0, "entry for p{i}");
    }
    let mut watched = fw.watched();
    watched.sort();
    assert_eq!(watched, vec![s(&paths[0]), s(&paths[2])]);
}
