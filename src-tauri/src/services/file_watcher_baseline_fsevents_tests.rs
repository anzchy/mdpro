//! Real-FSEvents integration pair for the synthetic-event routing cases
//! (D32 matrix FS1, FS2). macOS only and `#[ignore]`d: they depend on the OS
//! event stream and the `xattr` tool. Run by hand at the device check with
//! `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored d32_fsevents`.
//! FS1 was rewritten for the 2026-10-10 scope amendment (ADR-0068): (a) an
//! xattr within 30 s of a write and (b) within 30 s of a save through
//! `save_file_with` each produce zero emissions. FS2 is the positive control.
use super::super::kinds_fixture::{unique_path, T};
use super::super::{process_event, WatchOutcome};
use super::fixture::{append, fresh, EXTENDED};
use super::BaselineStore;
use crate::commands::file::save_file_with;
use notify::{Event, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// FSEvents clears a file's accumulated flags about every 30 s (ADR-0068).
const RESIDUAL_WINDOW: Duration = Duration::from_secs(30);
const SETTLE: Duration = Duration::from_millis(200);
const CREATE_QUIET: Duration = Duration::from_secs(1);
const FIRST_WAIT: Duration = Duration::from_secs(5);
const DRAIN_WAIT: Duration = Duration::from_millis(500);

/// A watched `target.md` holding "abc", registered in a fresh store.
struct Setup {
    dir: PathBuf,
    file: PathBuf,
    store: BaselineStore,
    watcher: notify::RecommendedWatcher,
    rx: mpsc::Receiver<notify::Result<Event>>,
}

impl Setup {
    fn new(label: &str) -> Self {
        let dir = unique_path(label).with_extension("");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("target.md");
        std::fs::write(&file, b"abc").unwrap();
        std::thread::sleep(CREATE_QUIET);
        let store = BaselineStore::default();
        store.register(&file);
        let (tx, rx) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |r| {
            let _ = tx.send(r);
        })
        .unwrap();
        watcher.watch(&file, RecursiveMode::NonRecursive).unwrap();
        std::thread::sleep(SETTLE);
        Self {
            dir,
            file,
            store,
            watcher,
            rx,
        }
    }

    /// Every event until the stream goes quiet.
    fn drain(&self) -> Vec<Event> {
        let mut events = Vec::new();
        loop {
            let wait = if events.is_empty() {
                FIRST_WAIT
            } else {
                DRAIN_WAIT
            };
            match self.rx.recv_timeout(wait) {
                Ok(Ok(event)) => events.push(event),
                Ok(Err(_)) => continue,
                Err(_) => break,
            }
        }
        events
    }
}

impl Drop for Setup {
    fn drop(&mut self) {
        let _ = self.watcher.unwatch(&self.file);
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn write_xattr(p: &Path) {
    let status = std::process::Command::new("xattr")
        .args(["-w", "com.apple.lastuseddate#PS", "d32"])
        .arg(p)
        .status()
        .expect("run xattr");
    assert!(status.success(), "precondition: xattr -w succeeded");
}

/// Route every drained event through one debounce map; assert that none
/// emits, that every Extended one is `IgnoredUnchanged`, and that at least
/// one Extended event arrived (precondition, not assumed).
fn assert_zero_emissions(s: &Setup, events: &[Event]) {
    let map = fresh();
    let mut extended = 0;
    for e in events {
        let (emitted, outcome) = process_event(e, &map, &s.store, T);
        assert!(emitted.is_none(), "emitted {outcome:?} for {e:?}");
        if e.kind == EXTENDED {
            extended += 1;
            assert_eq!(outcome, WatchOutcome::IgnoredUnchanged, "{e:?}");
        }
    }
    assert!(extended > 0, "no Extended event among {events:?}");
}

/// FS1(a): write, register, then within 30 s LaunchServices' xattr rewrite.
/// FSEvents still carries the write's residual flags (Create, Metadata(Any),
/// Content) beside Extended; none of them emits (ADR-0068 decisions 1, 3).
#[test]
#[ignore = "real FSEvents; cargo test -- --ignored d32_fsevents"]
fn d32_fsevents_fs1a_xattr_within_30s_of_write_emits_nothing() {
    let written = Instant::now();
    let s = Setup::new("fs1a");
    assert!(
        written.elapsed() < RESIDUAL_WINDOW,
        "precondition: inside 30 s"
    );
    write_xattr(&s.file);
    let events = s.drain();
    assert_eq!(std::fs::read(&s.file).unwrap(), b"abc", "content unchanged");
    assert_zero_emissions(&s, &events);
}

/// FS1(b): register, save through the real save seam (atomic temp + rename),
/// then within 30 s the xattr rewrite. The save refreshed the baseline, so
/// the late self-write flags and the xattr burst all compare against the
/// saved bytes and none emits (ADR-0068 decision 4, D32 WI-6).
#[tokio::test]
#[ignore = "real FSEvents; cargo test -- --ignored d32_fsevents"]
async fn d32_fsevents_fs1b_xattr_within_30s_of_save_emits_nothing() {
    let s = Setup::new("fs1b");
    let saved = Instant::now();
    save_file_with(
        "fs1b".into(),
        "saved by fs1b\n".into(),
        Some(s.file.to_string_lossy().to_string()),
        None,
        None,
        None,
        &s.store,
    )
    .await
    .expect("save");
    assert!(
        saved.elapsed() < RESIDUAL_WINDOW,
        "precondition: inside 30 s"
    );
    write_xattr(&s.file);
    let events = s.drain();
    assert_eq!(std::fs::read(&s.file).unwrap(), b"saved by fs1b\n");
    assert_zero_emissions(&s, &events);
}

/// FS2: a real append followed by an xattr write still emits `modified`.
#[test]
#[ignore = "real FSEvents; cargo test -- --ignored d32_fsevents"]
fn d32_fsevents_fs2_real_data_write_still_emits_modified() {
    let s = Setup::new("fs2");
    append(&s.file, b"x");
    write_xattr(&s.file);
    let events = s.drain();
    let target = std::fs::canonicalize(&s.file).unwrap();
    let map = fresh();
    let found = events.iter().any(|e| {
        let (emitted, outcome) = process_event(e, &map, &s.store, T);
        let path = emitted.and_then(|em| std::fs::canonicalize(em.path).ok());
        outcome == WatchOutcome::EmittedModified && path.as_ref() == Some(&target)
    });
    assert_eq!(std::fs::metadata(&s.file).unwrap().len(), 4, "file grew");
    assert!(found, "no EmittedModified for {target:?} among {events:?}");
}
