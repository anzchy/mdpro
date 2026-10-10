//! Real-FSEvents integration pair for the hand-built Events in the
//! `process_event` tests (D32 WI-2: o15).
//!
//! Wired from `file_watcher.rs` with
//! `#[cfg(all(test, target_os = "macos"))] #[path = ...] mod fsevents_tests;`.
//! Ignored by default because it depends on the OS event stream; run it
//! manually with `cargo test -- --ignored fsevents` (device step R0).

use super::baseline::BaselineStore;
use super::kinds_fixture::{unique_path, T};
use super::watch_log::{classify_event_kind, ALL_KINDS};
use super::{process_event, WatchOutcome};
use notify::{RecursiveMode, Watcher};
use std::collections::HashMap;
use std::io::Write;
use std::sync::{mpsc, Mutex};
use std::time::Duration;

const SETTLE: Duration = Duration::from_millis(200);
const FIRST_WAIT: Duration = Duration::from_secs(5);
const DRAIN_WAIT: Duration = Duration::from_millis(500);

#[test]
#[ignore = "real FSEvents; cargo test -- --ignored fsevents"]
fn o15_fsevents_content_write_reaches_process_event_as_emitted_modify() {
    let dir = unique_path("o15dir").with_extension("");
    std::fs::create_dir_all(&dir).unwrap();
    let f = dir.join("target.md");
    std::fs::write(&f, b"abc").unwrap();

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |r| {
        let _ = tx.send(r);
    })
    .unwrap();
    watcher.watch(&f, RecursiveMode::NonRecursive).unwrap();
    std::thread::sleep(SETTLE);

    let mut file = std::fs::OpenOptions::new().append(true).open(&f).unwrap();
    file.write_all(b"12345").unwrap();
    drop(file);
    assert_eq!(
        std::fs::metadata(&f).unwrap().len(),
        8,
        "precondition: file grew"
    );

    let target = std::fs::canonicalize(&f).unwrap();
    let map = Mutex::new(HashMap::new());
    let mut found = false;
    let mut received = 0;
    loop {
        let wait = if found { DRAIN_WAIT } else { FIRST_WAIT };
        let event = match rx.recv_timeout(wait) {
            Ok(Ok(event)) => event,
            Ok(Err(_)) => continue,
            Err(_) => break,
        };
        received += 1;
        let class = classify_event_kind(&event.kind);
        assert!(ALL_KINDS.contains(&class.kind), "{:?}", event.kind);
        let (emitted, outcome) = process_event(&event, &map, &BaselineStore::default(), T);
        if let (Some(em), WatchOutcome::EmittedModified) = (emitted, outcome) {
            let emitted_path = std::fs::canonicalize(&em.path).ok();
            found |= emitted_path.as_ref() == Some(&target);
        }
    }
    let _ = watcher.unwatch(&f);
    let _ = std::fs::remove_dir_all(&dir);
    assert!(received > 0, "FSEvents delivered nothing");
    assert!(
        found,
        "no EmittedModified for {target:?} among {received} events"
    );
}
