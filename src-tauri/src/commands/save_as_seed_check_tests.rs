//! D111-WI-2 (Codex interleaving 10): a Save As reports in
//! `changed_since_read` whether its target still holds the bytes it wrote
//! once the watch is registered. Its own write with unchanged bytes stays
//! quiet; an external write between the write and the register is reported.
//! Real files, the real save path and a real notify watcher; the external
//! write lands through the module's test-only `hook`. macOS only.
use super::hook;
use super::save_as_watched_with;
use crate::commands::file::{FileError, SaveResult};
use crate::commands::file_save_fixture::Dir;
use crate::services::file_watcher::seed::kit;
use crate::services::file_watcher::FileWatcher;
use std::fs;
use std::path::Path;

async fn save_as(p: &Path, content: &str, fw: &FileWatcher) -> Result<SaveResult, FileError> {
    let path = p.to_string_lossy().into_owned();
    save_as_watched_with("d1".into(), content.into(), path, None, None, None, fw).await
}

/// The own write, small or past the hash cap, reads back unchanged.
#[tokio::test]
async fn d111_wi2_sa_a_an_own_save_as_with_unchanged_bytes_is_quiet() {
    let d = Dir::new("d111sa_a");
    let fw = FileWatcher::for_tests();
    let r = save_as(&d.path().join("a.md"), "mine\n", &fw).await;
    assert!(!r.expect("save as").changed_since_read, "small");

    const LINE: &str = "0123456789abcde\n";
    let over = kit::HASH_CAP_BYTES + 4096;
    let text = LINE.repeat((over / LINE.len() as u64) as usize);
    let r = save_as(&d.path().join("big.md"), &text, &fw).await;
    assert!(!r.expect("save as").changed_since_read, "past the cap");
}

/// An external write between the write and the register is reported: one
/// keeping the stat (only the hash tells), one changing the size (the seed
/// stores no stat, D129, so the check fails open).
#[tokio::test]
async fn d111_wi2_sa_b_a_write_between_save_and_register_is_reported() {
    let d = Dir::new("d111sa_b");
    let fw = FileWatcher::for_tests();
    let p = d.path().join("same.md");
    let q = p.clone();
    let guard = hook::install(move || kit::rewrite_keep_stat(&q, b"BBBB"));
    let r = save_as(&p, "AAAA", &fw).await.expect("save as");
    drop(guard);
    assert_eq!(
        fs::read(&p).expect("read"),
        b"BBBB",
        "precondition: hook ran"
    );
    assert!(r.success && r.changed_since_read, "same stat: {r:?}");

    let p = d.path().join("longer.md");
    let q = p.clone();
    let guard = hook::install(move || fs::write(&q, b"a much longer external body").unwrap());
    let r = save_as(&p, "AAAA", &fw).await.expect("save as");
    drop(guard);
    assert!(r.success && r.changed_since_read, "new size: {r:?}");
}
