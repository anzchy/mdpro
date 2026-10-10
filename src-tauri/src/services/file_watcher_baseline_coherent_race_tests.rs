//! D86 WI-1 (matrix k9, k10, k16): the stability laws of the single-handle
//! read, over an enumerated domain of mutations landing during the read (the
//! seam runs after the read, before the second fstat), plus metadata-only
//! mutations before it (the D32 invariant), and a per-host filesystem pin.
//!
//! The rows that only a moved ctime can catch (same-length rewrite with the
//! mtime restored, chmod, xattr), the before-read partition and the k16 pin
//! are macOS only: ext4's coarse timestamps (Linux, WSL) need not move ctime
//! between two quick operations.
#[cfg(target_os = "macos")]
use super::fixture::{chmod, mtime, rewrite_keep_stat, set_mtime};
use super::fixture::{append, shift_mtime, TempDir};
#[cfg(target_os = "macos")]
use super::race_fixture::{ctime_ns, set_xattr};
use super::race_fixture::{
    file_symlink, ino, rename_over_keep_stat, stat_pair, swap_parent_dir_keep_stat,
};
use super::read::coherent_read;
use super::seam::with_read_hook;
use super::BaselineStore;
use std::cell::Cell;
use std::fs;
use std::path::PathBuf;
use std::rc::Rc;

#[derive(Debug, Clone, Copy, PartialEq)]
enum M {
    None,
    #[cfg(target_os = "macos")]
    SameLenRewriteMtimeRestored,
    RewriteMtimeBumped,
    Append,
    Truncate,
    RenameOverKeepMtime,
    RenameOverIdenticalBytes,
    #[cfg(target_os = "macos")]
    Xattr,
    #[cfg(target_os = "macos")]
    Chmod,
    ParentDirSwapKeepStat,
    NoneThroughFileSymlink,
}

const ALL: &[M] = &[
    M::None,
    #[cfg(target_os = "macos")]
    M::SameLenRewriteMtimeRestored,
    M::RewriteMtimeBumped,
    M::Append,
    M::Truncate,
    M::RenameOverKeepMtime,
    M::RenameOverIdenticalBytes,
    #[cfg(target_os = "macos")]
    M::Xattr,
    #[cfg(target_os = "macos")]
    M::Chmod,
    M::ParentDirSwapKeepStat,
    M::NoneThroughFileSymlink,
];

/// Only an unmutated read (directly or through a file symlink) is stable.
fn expect_stable(m: M) -> bool {
    matches!(m, M::None | M::NoneThroughFileSymlink)
}

/// A fresh `"hello world"` file for row `m`, and the path the read uses:
/// `d/sub/a.md` for the parent swap, the link `d/l.md -> a.md` for the
/// symlink row, else `d/a.md`.
fn row_file(m: M) -> (TempDir, PathBuf) {
    let d = TempDir::new(&format!("{m:?}"));
    let p = match m {
        M::ParentDirSwapKeepStat => {
            fs::create_dir(d.path().join("sub")).expect("mkdir sub");
            d.file("sub/a.md", b"hello world")
        }
        M::NoneThroughFileSymlink => {
            let target = d.file("a.md", b"hello world");
            let l = file_symlink(d.path(), "l.md", "a.md");
            assert_eq!(stat_pair(&l), stat_pair(&target), "precondition: link stat is the target's");
            l
        }
        _ => d.file("a.md", b"hello world"),
    };
    (d, p)
}

/// The mutation as a one-shot hook that also sets `ran`.
fn hook(m: M, p: PathBuf, ran: Rc<Cell<bool>>) -> impl FnOnce() + 'static {
    move || {
        match m {
            M::None | M::NoneThroughFileSymlink => {}
            #[cfg(target_os = "macos")]
            M::SameLenRewriteMtimeRestored => rewrite_keep_stat(&p, b"HELLO WORLD"),
            M::RewriteMtimeBumped => {
                fs::write(&p, b"HELLO WORLD").expect("rewrite");
                shift_mtime(&p, 5);
            }
            M::Append => append(&p, b"!"),
            M::Truncate => fs::File::options()
                .write(true)
                .open(&p)
                .and_then(|f| f.set_len(5))
                .expect("truncate"),
            M::RenameOverKeepMtime => {
                let probe = rename_over_keep_stat(&p, b"HELLO WORLD");
                note_old_ctime(probe.old_ctime_moved);
            }
            M::RenameOverIdenticalBytes => {
                let probe = rename_over_keep_stat(&p, b"hello world");
                note_old_ctime(probe.old_ctime_moved);
            }
            #[cfg(target_os = "macos")]
            M::Xattr => set_xattr(&p, "com.apple.mdpro.test", b"1"),
            #[cfg(target_os = "macos")]
            M::Chmod => chmod(&p, 0o600),
            M::ParentDirSwapKeepStat => swap_parent_dir_keep_stat(&p, b"HELLO WORLD"),
        }
        ran.set(true);
    }
}

thread_local! {
    static OLD_CTIME_MOVED: Cell<Option<bool>> = const { Cell::new(None) };
}

/// Keep the rename-over probe result for the row's assertion message.
fn note_old_ctime(moved: bool) {
    OLD_CTIME_MOVED.with(|c| c.set(Some(moved)));
}

fn take_note() -> Option<bool> {
    OLD_CTIME_MOVED.with(|c| c.take())
}

/// k9: Some ⇒ coherent (bytes and stat equal the disk when it returns), with
/// the exact per-row table so `return None` and path re-reads are pinned.
#[test]
fn k9_coherent_read_never_reports_a_stale_read_as_stable() {
    for &m in ALL {
        let (_d, p) = row_file(m);
        let ran = Rc::new(Cell::new(false));
        let r = with_read_hook(hook(m, p.clone(), Rc::clone(&ran)), || coherent_read(&p));
        let note = take_note();
        assert!(ran.get(), "{m:?}: the hook ran");
        if let Some((stat, bytes)) = &r {
            assert_eq!(bytes, &fs::read(&p).unwrap(), "{m:?}: law, bytes ({note:?})");
            assert_eq!(Some(*stat), stat_pair(&p), "{m:?}: law, stat ({note:?})");
        }
        assert_eq!(r.is_some(), expect_stable(m), "{m:?}: table (old_ctime_moved {note:?})");
        if expect_stable(m) {
            let expected = (stat_pair(&p).unwrap(), b"hello world".to_vec());
            assert_eq!(r, Some(expected), "{m:?}: exact read");
        }
    }
}

/// k10, during the read: `is_unchanged ⇒ disk == registered bytes and the
/// path is the registered inode`, with the exact table (xattr and chmod
/// during the read are the accepted fail-open cost).
#[test]
fn k10_is_unchanged_during_read_partition() {
    for &m in ALL {
        let (_d, p) = row_file(m);
        let store = BaselineStore::default();
        store.register(&p);
        let ino_at_register = ino(&p);
        let ran = Rc::new(Cell::new(false));
        let r = store.is_unchanged_with(&p, hook(m, p.clone(), Rc::clone(&ran)));
        let note = take_note();
        assert!(ran.get(), "{m:?}: the hook ran");
        if r {
            assert_eq!(fs::read(&p).unwrap(), b"hello world", "{m:?}: law, bytes");
            assert_eq!(ino(&p), ino_at_register, "{m:?}: law, inode");
        }
        assert_eq!(r, expect_stable(m), "{m:?}: table (old_ctime_moved {note:?})");
        if m == M::NoneThroughFileSymlink {
            assert!(store.is_unchanged(&p), "{m:?}: follow-up with no hook");
        }
    }
}

/// k10, before the read: a ctime that moved before the read is not a
/// change, because nothing stored carries a ctime (D32). macOS only: the
/// precondition needs ctime to move, which ext4 need not do this quickly.
#[cfg(target_os = "macos")]
#[test]
fn k10_is_unchanged_before_read_partition() {
    let rows: [(&str, fn(&std::path::Path)); 2] = [
        ("ChmodBeforeRead", |p| chmod(p, 0o600)),
        ("TouchMtimeRestoredBeforeRead", |p| set_mtime(p, mtime(p))),
    ];
    for (row, mutate) in rows {
        let d = TempDir::new(row);
        let p = d.file("a.md", b"hello world");
        let store = BaselineStore::default();
        store.register(&p);
        let (c0, b0, s0) = (ctime_ns(&p), fs::read(&p).unwrap(), stat_pair(&p));
        mutate(&p);
        assert_ne!(ctime_ns(&p), c0, "{row}: precondition, ctime moved");
        assert_eq!(fs::read(&p).unwrap(), b0, "{row}: precondition, bytes");
        assert_eq!(stat_pair(&p), s0, "{row}: precondition, stat");
        let r = store.is_unchanged(&p);
        if r {
            assert_eq!(fs::read(&p).unwrap(), b"hello world", "{row}: law");
        }
        assert!(r, "{row}: a ctime moved before the read is not a change");
    }
}

/// k16: does a rename-over move the replaced inode's ctime on this host?
/// Pinned to the value observed on the implementer's host. macOS only: the
/// ext4 pin never ran, and its coarse ctime need not move this quickly.
#[cfg(target_os = "macos")]
#[test]
fn k16_rename_over_old_inode_ctime_is_pinned_per_host() {
    let d = TempDir::new("k16");
    let p = d.file("a.md", b"hello world");
    let moved = rename_over_keep_stat(&p, b"HELLO WORLD").old_ctime_moved;
    #[cfg(target_os = "macos")]
    assert!(moved, "APFS: unlinking the replaced inode moves its ctime");
    #[cfg(target_os = "linux")]
    assert!(moved, "ext4: unlinking the replaced inode moves its ctime");
}
