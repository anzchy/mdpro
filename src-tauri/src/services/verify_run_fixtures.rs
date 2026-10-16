//! Test-only fixture for the verify-run guard (ADR-0047 WI-002 / WI-4, WI-5):
//! `Run::valid()`, a run dir that passes every check (and `Run::for_child()`,
//! the same dir with the parent's environment left alone, D239), built under
//! `canonicalize(temp_dir())` with an injected parent (the real
//! `<passwd home>/Library/Application Support/mdpro-verify/runs` is never
//! touched), plus env, mode and snapshot helpers.
//!
//! Every value holds `crate::HOME_LOCK`. Field order: `Drop::drop` removes the
//! tree and restores log settings, then `_env` restores the four variables,
//! then `_lock` releases the lock.
#![allow(dead_code)]
use super::{check, GuardError, VerifiedRun};
use crate::models::{LogLevel, LogSettings};
use crate::services::logger::{get_log_settings, set_log_settings};
use crate::HOME_LOCK;
use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;

pub(super) const HOME: &str = "HOME";
pub(super) const CF_HOME: &str = "CFFIXED_USER_HOME";
pub(super) const RUN: &str = "MDPRO_VERIFY_RUN";
pub(super) const NONCE: &str = "MDPRO_VERIFY_NONCE";
const VARS: [&str; 4] = [HOME, CF_HOME, RUN, NONCE];

/// Restores the four guard variables to what they were at capture.
pub(super) struct EnvRestore(Vec<(&'static str, Option<OsString>)>);

impl EnvRestore {
    fn capture() -> Self {
        EnvRestore(VARS.iter().map(|v| (*v, std::env::var_os(v))).collect())
    }
}

impl Drop for EnvRestore {
    fn drop(&mut self) {
        for (k, v) in &self.0 {
            match v {
                Some(v) => set_var(k, v),
                None => unset_var(k),
            }
        }
    }
}

/// `HOME_LOCK` plus an `EnvRestore`, for tests that need no run dir.
pub(super) struct EnvLock {
    _env: EnvRestore,
    _lock: MutexGuard<'static, ()>,
}

pub(super) fn lock_env() -> EnvLock {
    let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    EnvLock {
        _env: EnvRestore::capture(),
        _lock: lock,
    }
}

pub(super) fn set_var(k: &str, v: impl AsRef<OsStr>) {
    // SAFETY: every caller holds HOME_LOCK.
    unsafe { std::env::set_var(k, v) };
}

pub(super) fn unset_var(k: &str) {
    // SAFETY: every caller holds HOME_LOCK.
    unsafe { std::env::remove_var(k) };
}

pub(super) fn chmod(p: &Path, mode: u32) {
    fs::set_permissions(p, fs::Permissions::from_mode(mode)).expect("chmod");
}

pub(super) fn canonical_tmp() -> PathBuf {
    fs::canonicalize(std::env::temp_dir()).expect("canonical temp dir")
}

/// 24 lowercase hex chars, the first a letter so a case change is a change.
pub(super) fn fresh_nonce() -> String {
    let hex = uuid::Uuid::new_v4().simple().to_string();
    format!("a{}", &hex[..23])
}

/// `(rel path, file type, len, mtime_ns, mode)` of every entry under a root,
/// symlinks not followed.
pub(super) type Snapshot = BTreeMap<PathBuf, (String, u64, i128, u32)>;

pub(super) fn snapshot(root: &Path) -> Snapshot {
    let mut out = Snapshot::new();
    walk(root, root, &mut out);
    out
}

fn walk(root: &Path, dir: &Path, out: &mut Snapshot) {
    let Ok(items) = fs::read_dir(dir) else {
        return;
    };
    for item in items.flatten() {
        let p = item.path();
        let Ok(md) = fs::symlink_metadata(&p) else {
            continue;
        };
        let kind = format!("{:?}", md.file_type());
        let mtime = i128::from(md.mtime()) * 1_000_000_000 + i128::from(md.mtime_nsec());
        let rel = p.strip_prefix(root).expect("under root").to_path_buf();
        out.insert(rel, (kind, md.len(), mtime, md.mode()));
        if md.is_dir() {
            walk(root, &p, out);
        }
    }
}

/// Whether any entry under `root` is named `name`.
pub(super) fn contains_named(root: &Path, name: &str) -> bool {
    snapshot(root)
        .keys()
        .any(|p| p.file_name().is_some_and(|n| n == name))
}

/// A run dir that passes every check (matrix WI-4 `Run::valid()`).
pub(super) struct Run {
    pub(super) root: PathBuf,
    pub(super) parent: PathBuf,
    pub(super) run: PathBuf,
    pub(super) nonce: String,
    pub(super) uid: u32,
    prime: Option<(PathBuf, LogSettings)>,
    _env: EnvRestore,
    _lock: MutexGuard<'static, ()>,
}

impl Run {
    pub(super) fn valid() -> Self {
        Self::build(false, true)
    }

    /// `valid()` with the logger forced on at Info. The settings cache is
    /// primed under a throwaway HOME outside `root` first (matrix F3), so its
    /// first-use read (`logger::read_initial_logging`, read-only since M1a
    /// WI-1) touches neither the fixture nor the real `~/.mdpro`.
    pub(super) fn logged() -> Self {
        Self::build(true, true)
    }

    /// A run dir for a test that hands it to a spawned child (D239). The
    /// parent's HOME, CFFIXED_USER_HOME, MDPRO_VERIFY_RUN, MDPRO_VERIFY_NONCE
    /// and logger stay as they were: pointing the process-wide HOME at the
    /// run dir let any test logging without `HOME_LOCK` write `<run>/.mdpro`.
    /// The child gets its environment from `Command::env`.
    pub(super) fn for_child() -> Self {
        Self::build(false, false)
    }

    fn build(log: bool, repoint: bool) -> Self {
        let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let env = EnvRestore::capture();
        let tmp = canonical_tmp();
        let root = tmp.join(format!("mdpro-vr-{}", uuid::Uuid::new_v4().simple()));
        let parent = root.join("runs");
        let run = parent.join(format!("r-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&run).expect("create run dir");
        chmod(&parent, 0o700);
        chmod(&run, 0o700);
        let nonce = fresh_nonce();
        let launch = run.join("launch.json");
        fs::write(&launch, format!("{{\"nonce\":\"{nonce}\"}}")).expect("write launch.json");
        let uid = fs::metadata(&launch).expect("launch.json metadata").uid();
        let prime = log.then(|| {
            let dir = tmp.join(format!("mdpro-vr-prime-{}", uuid::Uuid::new_v4().simple()));
            fs::create_dir_all(&dir).expect("create prime home");
            set_var(HOME, &dir);
            let prev = get_log_settings();
            set_log_settings(LogSettings {
                enabled: true,
                level: LogLevel::Info,
            });
            (dir, prev)
        });
        let fx = Run {
            root,
            parent,
            run,
            nonce,
            uid,
            prime,
            _env: env,
            _lock: lock,
        };
        if repoint {
            fx.point_paths_at(&fx.run.clone());
            set_var(NONCE, &fx.nonce);
        }
        fx
    }

    /// `HOME`, `CFFIXED_USER_HOME` and `MDPRO_VERIFY_RUN` all set to `p`.
    pub(super) fn point_paths_at(&self, p: &Path) {
        for v in [HOME, CF_HOME, RUN] {
            set_var(v, p);
        }
    }

    /// The injected arguments of a defect-free call.
    pub(super) fn args(&self) -> (PathBuf, u32) {
        (self.parent.clone(), self.uid)
    }

    pub(super) fn check(&self) -> Result<VerifiedRun, GuardError> {
        check(&self.parent, self.uid)
    }

    pub(super) fn snapshot(&self) -> Snapshot {
        snapshot(&self.root)
    }

    pub(super) fn launch(&self) -> PathBuf {
        self.run.join("launch.json")
    }

    pub(super) fn write_launch(&self, text: &str) {
        fs::write(self.launch(), text).expect("write launch.json");
    }

    /// `mkdir -p p`, every created level 0700.
    pub(super) fn mkdir(&self, p: &Path) -> PathBuf {
        fs::create_dir_all(p).expect("mkdir");
        let mut at = p.to_path_buf();
        while at.starts_with(&self.root) && at != self.root {
            chmod(&at, 0o700);
            at.pop();
        }
        p.to_path_buf()
    }
}

impl Drop for Run {
    fn drop(&mut self) {
        let _ = fs::set_permissions(&self.parent, fs::Permissions::from_mode(0o700));
        let _ = fs::set_permissions(&self.run, fs::Permissions::from_mode(0o700));
        let _ = fs::remove_dir_all(&self.root);
        if let Some((dir, prev)) = self.prime.take() {
            set_log_settings(prev);
            let _ = fs::remove_dir_all(dir);
        }
    }
}

/// The `pw_dir` of `uid` read through the test's own `getpwuid_r`, or `None`
/// when there is no entry. Independent of the code under test.
pub(super) fn passwd_dir(uid: u32) -> Option<Vec<u8>> {
    let mut buf = vec![0u8; 16 * 1024];
    // SAFETY: an all-zero `passwd` is a valid out-parameter.
    let mut pwd: libc::passwd = unsafe { std::mem::zeroed() };
    let mut result: *mut libc::passwd = std::ptr::null_mut();
    // SAFETY: every pointer is valid for the call; `buf` outlives `pwd`.
    let rc = unsafe {
        libc::getpwuid_r(
            uid,
            &mut pwd,
            buf.as_mut_ptr().cast(),
            buf.len(),
            &mut result,
        )
    };
    if rc != 0 || result.is_null() || pwd.pw_dir.is_null() {
        return None;
    }
    // SAFETY: `pw_dir` is a NUL-terminated string inside `buf`.
    Some(
        unsafe { std::ffi::CStr::from_ptr(pwd.pw_dir) }
            .to_bytes()
            .to_vec(),
    )
}
