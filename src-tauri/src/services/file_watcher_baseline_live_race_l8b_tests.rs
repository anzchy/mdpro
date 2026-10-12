//! D120: L8 (D32 WI-5) with an explicit FIFO handshake instead of a sleep.
//!
//! L8 took "A has not finished after 100 ms" to mean "A is blocked reading
//! the FIFO", then released A with one non-blocking writer open. When A had
//! not reached its `open` of the FIFO yet (its thread started late, or its
//! FSEvents restart under the watcher lock was slow, or B took the locks
//! first), that open failed with ENXIO and was ignored, A then blocked in
//! `open` with no writer ever coming, and L8 failed `a_done` (D120). The
//! same interleaving also made B's check vacuous: B can finish before A
//! reads anything, whatever lock the read runs under.
//!
//! Here the writer end is retried until it opens, which happens only while A
//! waits in the FIFO's `open`, and it is held open while B runs, so A is
//! provably blocked in its read (a writer, no data, no EOF) for all of B.
use super::{home, mkfifo, s, FileWatcher, TempDir, JOIN_TIMEOUT};
use std::fs::{File, OpenOptions};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

/// How often the writer open is retried while no reader waits.
const RETRY: Duration = Duration::from_millis(5);

/// Open `p`'s write end without blocking, retrying until a reader waits in
/// `open` (ENXIO until then), within `JOIN_TIMEOUT`. While the returned end
/// stays open, that reader is blocked in `read`; dropping it gives EOF.
fn hold_writer(p: &Path) -> File {
    let deadline = Instant::now() + JOIN_TIMEOUT;
    loop {
        let opened = OpenOptions::new()
            .write(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(p);
        match opened {
            Ok(writer) => return writer,
            Err(e) if e.raw_os_error() == Some(libc::ENXIO) && Instant::now() < deadline => {
                thread::sleep(RETRY)
            }
            Err(e) => panic!("no reader opened the FIFO within {JOIN_TIMEOUT:?}: {e}"),
        }
    }
}

/// L8b: while one `watch` is held inside its read of a FIFO's bytes, another
/// path's `watch` / `unwatch` still completes, so the read runs under
/// neither the watcher lock nor the list lock.
#[test]
fn l8b_watch_reads_file_bytes_outside_the_watcher_locks_by_handshake() {
    let _home = home("l8b");
    let d = TempDir::new("l8b");
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
    let writer = hold_writer(&pipe);

    let (tx_b, rx_b) = mpsc::channel();
    let (fw_b, plain_b) = (Arc::clone(&fw), plain.clone());
    thread::spawn(move || {
        fw_b.watch(&plain_b);
        fw_b.unwatch(&plain_b);
        let _ = tx_b.send(());
    });
    let b_done = rx_b.recv_timeout(JOIN_TIMEOUT).is_ok();
    let a_held = rx_a.try_recv().is_err();

    drop(writer);
    let a_done = rx_a.recv_timeout(JOIN_TIMEOUT).is_ok();
    assert!(a_held, "precondition: watch(pipe) stayed in its FIFO read");
    assert!(
        b_done,
        "watch/unwatch of another path finished while A was in its read"
    );
    assert!(a_done, "watch(pipe) finished once the FIFO hit EOF");
    assert!(fw.watched().contains(&s(&pipe)), "{:?}", fw.watched());
}
