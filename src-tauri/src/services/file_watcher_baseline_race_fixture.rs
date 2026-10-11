//! D86 test helpers for mutations that race the baseline read: ctime and
//! inode readers, an xattr writer, a rename-over and a parent-directory swap
//! that both keep the path's `(mtime, size)`, and a same-directory file
//! symlink. Every helper asserts its own precondition, so a filesystem that
//! does not behave as assumed fails loudly instead of making a case vacuous.
//! The readers use `fs::metadata` and so follow symlinks. Everything but
//! `stat_pair` and `latest_of` is `#[cfg(unix)]` (D160): they need inodes,
//! ctimes or symlinks, and their suites are unix-only.
#[cfg(unix)]
use super::fixture::{mtime, set_mtime};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// `(mtime, size)` of `p`, following symlinks. The test's own reader, kept
/// independent of the code under test.
pub(crate) fn stat_pair(p: &Path) -> Option<(SystemTime, u64)> {
    let m = fs::metadata(p).ok()?;
    Some((m.modified().ok()?, m.len()))
}

#[cfg(unix)]
/// `p`'s ctime in nanoseconds since the epoch.
pub(crate) fn ctime_ns(p: &Path) -> i128 {
    meta_ctime_ns(&fs::metadata(p).expect("stat for ctime"))
}

#[cfg(unix)]
fn meta_ctime_ns(m: &fs::Metadata) -> i128 {
    i128::from(m.ctime()) * 1_000_000_000 + i128::from(m.ctime_nsec())
}

#[cfg(unix)]
/// ctime of the inode behind an open handle.
fn fd_ctime_ns(f: &fs::File) -> i128 {
    meta_ctime_ns(&f.metadata().expect("fstat probe"))
}

#[cfg(unix)]
/// `p`'s inode number.
pub(crate) fn ino(p: &Path) -> u64 {
    fs::metadata(p).expect("stat for ino").ino()
}

/// Set the extended attribute `name` on `p` (macOS `setxattr` signature).
#[cfg(target_os = "macos")]
pub(crate) fn set_xattr(p: &Path, name: &str, value: &[u8]) {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(p.as_os_str().as_bytes()).expect("path");
    let name = std::ffi::CString::new(name).expect("name");
    // SAFETY: both strings are NUL-terminated and outlive the call; `value`
    // is a valid slice of `value.len()` bytes.
    let rc = unsafe {
        libc::setxattr(
            path.as_ptr(),
            name.as_ptr(),
            value.as_ptr().cast(),
            value.len(),
            0,
            0,
        )
    };
    assert_eq!(rc, 0, "setxattr on {p:?}");
}

#[cfg(unix)]
/// What a probe handle on the replaced inode saw across a rename-over.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RenameProbe {
    pub(crate) old_ctime_moved: bool,
}

#[cfg(unix)]
/// Replace `p` by renaming a same-length sibling holding `bytes` over it,
/// with the sibling's mtime set to `p`'s. Asserts the path's `(mtime, size)`
/// is unchanged and its inode is new; reports whether the old inode's ctime
/// moved, seen through a handle opened before the rename.
pub(crate) fn rename_over_keep_stat(p: &Path, bytes: &[u8]) -> RenameProbe {
    let pre = stat_pair(p);
    let ino_before = ino(p);
    assert_eq!(pre.map(|s| s.1), Some(bytes.len() as u64), "precondition: same length");
    let mut tmp = p.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes).expect("write sibling");
    set_mtime(&tmp, mtime(p));
    let probe = fs::File::open(p).expect("probe handle");
    let c0 = fd_ctime_ns(&probe);
    fs::rename(&tmp, p).expect("rename over");
    let c1 = fd_ctime_ns(&probe);
    assert_eq!(stat_pair(p), pre, "precondition: path stat unchanged");
    assert_ne!(ino(p), ino_before, "precondition: a new inode");
    RenameProbe {
        old_ctime_moved: c0 != c1,
    }
}

#[cfg(unix)]
/// `p` is `<base>/sub/<name>`. Build `<base>/sub_new/<name>` holding the
/// same-length `bytes` with `p`'s mtime, then swap the directories:
/// `sub -> sub_old`, `sub_new -> sub`. The old file inode is never written,
/// renamed or unlinked; asserts its ctime (through a probe handle) did not
/// move, the path's `(mtime, size)` is unchanged, and the inode is new.
pub(crate) fn swap_parent_dir_keep_stat(p: &Path, bytes: &[u8]) {
    let sub = p.parent().expect("parent dir");
    let base = sub.parent().expect("base dir");
    let name = p.file_name().expect("file name");
    let (sub_new, sub_old) = (base.join("sub_new"), base.join("sub_old"));
    let pre = stat_pair(p);
    let ino_before = ino(p);
    fs::create_dir(&sub_new).expect("create sub_new");
    let staged = sub_new.join(name);
    fs::write(&staged, bytes).expect("write staged");
    set_mtime(&staged, mtime(p));
    let probe = fs::File::open(p).expect("probe handle");
    let c0 = fd_ctime_ns(&probe);
    fs::rename(sub, &sub_old).expect("rename sub -> sub_old");
    fs::rename(&sub_new, sub).expect("rename sub_new -> sub");
    let c1 = fd_ctime_ns(&probe);
    assert_eq!(c0, c1, "precondition: the old inode's ctime did not move");
    assert_eq!(stat_pair(p), pre, "precondition: path stat unchanged");
    assert_ne!(ino(p), ino_before, "precondition: a new inode");
    assert_eq!(fs::read(p).expect("read swapped"), bytes, "precondition: new bytes");
}

#[cfg(unix)]
/// `<d>/<link> -> <target>` (relative, same directory). Asserts it is a
/// symlink and returns its path.
pub(crate) fn file_symlink(d: &Path, link: &str, target: &str) -> PathBuf {
    let l = d.join(link);
    std::os::unix::fs::symlink(target, &l).expect("symlink");
    assert!(
        fs::symlink_metadata(&l).expect("lstat").file_type().is_symlink(),
        "precondition: {l:?} is a symlink"
    );
    l
}

// D86 WI-2: the raw-keyed ticket map, read with the literal path given. It
// never calls `baseline_key` or `canonicalize`, so it cannot agree with an
// implementation that keys `latest` any other way (matrix Gap 5).
use super::BaselineStore;

impl BaselineStore {
    /// `latest[raw]`, looked up by exactly `raw`.
    pub(crate) fn latest_of(&self, raw: &Path) -> Option<u64> {
        self.locked().latest.get(raw).copied()
    }
}
