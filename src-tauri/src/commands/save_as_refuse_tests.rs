//! D111-WI-1: Save As onto the document's own path, while that document has
//! an unresolved external change, writes nothing (as ⌘S refuses). The
//! frontend sends the document's path as `refuse_path` only in that state;
//! `save_as_checked_with` compares it with the path the dialog returned.
//! Any other target is never blocked. Real files, the real save path and a
//! real notify watcher (`FileWatcher::for_tests()`). macOS only, like the
//! other Save As suites.
use super::save_as_checked_with;
use crate::commands::file::{FileError, SaveResult};
use crate::commands::file_save_fixture::{canon, Dir};
use crate::services::file_watcher::FileWatcher;
use std::fs;
use std::path::Path;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

async fn save_as(
    target: &Path,
    refuse: Option<String>,
    fw: &FileWatcher,
) -> Result<SaveResult, FileError> {
    save_as_checked_with(
        "d1".into(),
        "mine\n".into(),
        s(target),
        None,
        None,
        None,
        refuse,
        fw,
    )
    .await
}

/// The refused reply: nothing written, nothing registered, the flag set.
fn assert_refused(r: &SaveResult, target: &Path, fw: &FileWatcher, tag: &str) {
    assert!(r.blocked_by_pending_change, "{tag}: blocked");
    assert!(!r.success, "{tag}: not a success");
    assert!(!r.changed_since_read, "{tag}: no check ran");
    assert_eq!(r.path, s(target), "{tag}: the picked path");
    assert_eq!(
        fs::read(target).expect("read"),
        b"theirs\n",
        "{tag}: untouched"
    );
    assert!(fw.watched().is_empty(), "{tag}: nothing registered");
    assert_eq!(fw.baseline_of(target), None, "{tag}: no baseline");
}

/// The dialog returned exactly the document's own path string.
#[tokio::test]
async fn d111_wi1_a_save_as_onto_the_own_path_with_a_pending_change_writes_nothing() {
    let d = Dir::new("d111r_a");
    let p = d.file("doc.md", b"theirs\n");
    let fw = FileWatcher::for_tests();
    let r = save_as(&p, Some(s(&p)), &fw).await.expect("reply");
    assert_refused(&r, &p, &fw, "same string");
}

/// The same file under another spelling (the temp dir is a symlink to
/// `/private/...`) is still the document's own file.
#[tokio::test]
async fn d111_wi1_b_another_spelling_of_the_own_path_is_refused_too() {
    let d = Dir::new("d111r_b");
    let p = d.file("doc.md", b"theirs\n");
    let spelled = canon(&p);
    assert_ne!(s(&spelled), s(&p), "precondition: two spellings");
    let fw = FileWatcher::for_tests();
    let r = save_as(&p, Some(s(&spelled)), &fw).await.expect("reply");
    assert_refused(&r, &p, &fw, "canonical spelling");
}

/// A different target writes and registers as before, whatever is pending
/// on the document's own path.
#[tokio::test]
async fn d111_wi1_c_another_target_is_never_blocked() {
    let d = Dir::new("d111r_c");
    let own = d.file("doc.md", b"theirs\n");
    let other = d.path().join("copy.md");
    let fw = FileWatcher::for_tests();
    let r = save_as(&other, Some(s(&own)), &fw).await.expect("save");
    assert!(r.success && !r.blocked_by_pending_change, "{r:?}");
    assert_eq!(fs::read(&other).expect("read"), b"mine\n");
    assert_eq!(fs::read(&own).expect("read"), b"theirs\n", "own untouched");
    assert_eq!(fw.watched(), vec![s(&other)], "registered");
}

/// No `refuse_path` (no pending change): the own path is written.
#[tokio::test]
async fn d111_wi1_d_without_a_refuse_path_the_own_path_is_written() {
    let d = Dir::new("d111r_d");
    let p = d.file("doc.md", b"theirs\n");
    let fw = FileWatcher::for_tests();
    let r = save_as(&p, None, &fw).await.expect("save");
    assert!(r.success && !r.blocked_by_pending_change, "{r:?}");
    assert_eq!(fs::read(&p).expect("read"), b"mine\n");
    assert_eq!(fw.watched(), vec![s(&p)]);
}

/// A missing own file still refuses on the same string (canonicalisation
/// fails for both sides, so the raw strings decide).
#[tokio::test]
async fn d111_wi1_e_a_deleted_own_file_is_refused_by_its_string() {
    let d = Dir::new("d111r_e");
    let p = d.path().join("gone.md");
    let fw = FileWatcher::for_tests();
    let r = save_as(&p, Some(s(&p)), &fw).await.expect("reply");
    assert!(r.blocked_by_pending_change && !r.success, "{r:?}");
    assert!(!p.exists(), "nothing written");
    assert!(fw.watched().is_empty());
}

/// The command runs the same refusal: `save_file_dialog` asks
/// `refused_save_as` with its `refuse_path` before its one
/// `save_as_post_picker` call, and returns the refused reply.
#[test]
fn d111_wi1_f_save_file_dialog_refuses_before_it_saves() {
    use crate::services::file_watcher::kinds_fixture::{code_lines, fn_slice};
    const FILE_SRC: &str = include_str!("file.rs");
    let body = code_lines(fn_slice(FILE_SRC, "pub async fn save_file_dialog("))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(body.contains("refuse_path: Option<String>"), "{body}");
    let refuse = body
        .find("refused_save_as(")
        .unwrap_or_else(|| panic!("no refusal:\n{body}"));
    let save = body
        .find("save_as_post_picker(")
        .expect("the save transaction");
    assert!(refuse < save, "refusal before the save:\n{body}");
    assert!(
        body[refuse..save].contains("refuse_path.as_deref()"),
        "{body}"
    );
    assert!(
        body[refuse..save].contains("return Ok(Some(blocked))"),
        "{body}"
    );
}
