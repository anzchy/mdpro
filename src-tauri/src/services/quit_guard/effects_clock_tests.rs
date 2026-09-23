//! D16F WI-9 (audit row 14): `effects::now_ms` is a monotonic, process-local
//! clock.
//!
//! Law: its reads never decrease, within a thread or across threads, and they
//! advance with real time. Its origin is the process, not the UNIX epoch, so a
//! wall-clock step (NTP, a manual change) can no longer move a quit deadline.

use crate::services::quit_guard::effects::now_ms;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The slack allowed on a 20 ms sleep, for coarse timers under load.
const MIN_SLEEP_DELTA_MS: u64 = 15;

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the test host's clock is after 1970")
        .as_millis() as u64
}

fn assert_non_decreasing(reads: &[u64], what: &str) {
    for (i, pair) in reads.windows(2).enumerate() {
        assert!(
            pair[1] >= pair[0],
            "{what}: read {} ({}) went back from read {} ({})",
            i + 1,
            pair[1],
            i,
            pair[0]
        );
    }
}

#[test]
fn wi9_the_origin_is_the_process_not_the_unix_epoch() {
    let epoch = epoch_ms();
    let now = now_ms();
    assert!(
        now < epoch / 2,
        "now_ms() = {now} is epoch-scale (epoch ms = {epoch}); it must be \
         measured from a process-local origin"
    );
}

#[test]
fn wi9_reads_are_monotonic_and_advance_across_reads_and_threads() {
    let sequential: Vec<u64> = (0..10_000).map(|_| now_ms()).collect();
    assert_non_decreasing(&sequential, "sequential reads");

    let before_spawn = now_ms();
    let handles: Vec<_> = (0..2)
        .map(|_| std::thread::spawn(|| (0..5_000).map(|_| now_ms()).collect::<Vec<u64>>()))
        .collect();
    for (t, handle) in handles.into_iter().enumerate() {
        let reads = handle.join().expect("reader thread panicked");
        assert!(
            reads[0] >= before_spawn,
            "thread {t} started at {} before the pre-spawn read {before_spawn}: \
             the origin is not shared across threads",
            reads[0]
        );
        assert_non_decreasing(&reads, &format!("thread {t}"));
    }

    let first = now_ms();
    std::thread::sleep(Duration::from_millis(20));
    let second = now_ms();
    assert!(
        second.saturating_sub(first) >= MIN_SLEEP_DELTA_MS,
        "a 20 ms sleep advanced now_ms() by only {} ms ({first} -> {second})",
        second.saturating_sub(first)
    );
}

#[test]
fn wi9_no_production_file_under_quit_guard_reads_the_wall_clock() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/services/quit_guard");
    let mut offenders = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("the quit_guard source directory is readable") {
        let path = entry.expect("a readable directory entry").path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_owned();
        if !name.ends_with(".rs") || name.ends_with("_tests.rs") {
            continue;
        }
        let text = std::fs::read_to_string(&path).expect("a readable source file");
        if text.contains("SystemTime") {
            offenders.push(name);
        }
    }
    assert!(
        offenders.is_empty(),
        "production quit_guard files still read the wall clock: {offenders:?}"
    );
}
