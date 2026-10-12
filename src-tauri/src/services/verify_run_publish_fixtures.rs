//! Test-only fixtures for `instance.json` publication (ADR-0047 WI-002 fix,
//! matrix `tests-20261007-230837.md` WI-1): a symlink-not-followed
//! `Fingerprint`, directory `entries`, the `instance.json` reader, publication
//! targets under a `Run`, the `app.verify_run` log reader, and the
//! existing-entry generator the refusal law runs over. Feature-on only.
#![allow(dead_code)]
use super::verify_run_fixtures::Run;
use super::VerifiedRun;
use rand::rngs::StdRng;
use rand::Rng;
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

const HEX: &[u8] = b"0123456789abcdef";

pub(super) fn hex(rng: &mut StdRng, n: usize) -> String {
    (0..n).map(|_| HEX[rng.gen_range(0..16)] as char).collect()
}

/// Everything observable about one directory entry, symlinks not followed.
/// `bytes` is read only for a regular file the test can open; `link` is the
/// `read_link` target of a symlink.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Fingerprint {
    pub(super) kind: String,
    pub(super) ino: u64,
    pub(super) nlink: u64,
    pub(super) mode: u32,
    pub(super) len: u64,
    pub(super) mtime_ns: i128,
    pub(super) bytes: Option<Vec<u8>>,
    pub(super) link: Option<PathBuf>,
}

pub(super) fn fingerprint(p: &Path) -> Fingerprint {
    let md = fs::symlink_metadata(p).unwrap_or_else(|e| panic!("lstat {}: {e}", p.display()));
    let ft = md.file_type();
    Fingerprint {
        kind: format!("{ft:?}"),
        ino: md.ino(),
        nlink: md.nlink(),
        mode: md.permissions().mode(),
        len: md.len(),
        mtime_ns: i128::from(md.mtime()) * 1_000_000_000 + i128::from(md.mtime_nsec()),
        bytes: if ft.is_file() { fs::read(p).ok() } else { None },
        link: if ft.is_symlink() {
            fs::read_link(p).ok()
        } else {
            None
        },
    }
}

/// The names directly inside `dir`.
pub(super) fn entries(dir: &Path) -> BTreeSet<String> {
    fs::read_dir(dir)
        .expect("read dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect()
}

pub(super) fn names(list: &[&str]) -> BTreeSet<String> {
    list.iter().map(|s| s.to_string()).collect()
}

/// `instance.json` at `path`, parsed.
pub(super) fn instance(path: &Path) -> Value {
    let text = fs::read_to_string(path).expect("read instance.json");
    serde_json::from_str(&text).expect("instance.json is JSON")
}

pub(super) fn keys(v: &Value) -> BTreeSet<String> {
    v.as_object().expect("object").keys().cloned().collect()
}

/// The publication postcondition at `path`: exactly `{nonce, pid, buildId}`
/// with these values, in a regular file of mode 0600 with one link.
pub(super) fn assert_published(path: &Path, nonce: &str, pid: u32, build_id: &str) {
    let v = instance(path);
    assert_eq!(keys(&v), names(&["nonce", "pid", "buildId"]));
    assert_eq!(v["nonce"], nonce);
    assert_eq!(v["pid"], pid);
    assert_eq!(v["buildId"], build_id);
    let md = fs::symlink_metadata(path).expect("instance.json");
    assert!(
        md.file_type().is_file(),
        "instance.json is not a regular file"
    );
    assert_eq!(md.permissions().mode() & 0o777, 0o600);
    assert_eq!(md.nlink(), 1, "instance.json has another hard link");
}

/// A fresh 0700 subdir `name` of the run dir, as a publication target with
/// the fixture's nonce. Publication does not re-run `check`.
pub(super) fn target(fx: &Run, name: &str) -> VerifiedRun {
    VerifiedRun {
        run_dir: fx.mkdir(&fx.run.join(name)),
        nonce: fx.nonce.clone(),
    }
}

/// The whole `<run>/.mdpro/mdpro.log`, or "" when nothing was logged.
pub(super) fn log_text(fx: &Run) -> String {
    fs::read_to_string(fx.run.join(".mdpro").join("mdpro.log")).unwrap_or_default()
}

/// Every `app.verify_run` line of the fixture's log.
pub(super) fn verify_run_lines(fx: &Run) -> Vec<Value> {
    log_text(fx)
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).expect("JSONL"))
        .filter(|v| v["event"] == "app.verify_run")
        .collect()
}

/// The basename of the run dir, as the log names it.
pub(super) fn base(fx: &Run) -> String {
    fx.run
        .file_name()
        .expect("run name")
        .to_str()
        .expect("utf8")
        .to_string()
}

/// One generated pre-existing `instance.json`: its kind, the paths whose
/// fingerprints must survive a refused publication, and a path that must
/// still be absent afterwards (a dangling link's target).
pub(super) struct Seed {
    pub(super) kind: &'static str,
    pub(super) watched: Vec<PathBuf>,
    pub(super) absent: Option<PathBuf>,
}

/// Put one existing entry at `<v.run_dir>/instance.json`. `pid_b` is the
/// pid the caller will publish with next; a prior publication uses it or not.
pub(super) fn seed_entry(rng: &mut StdRng, fx: &Run, v: &VerifiedRun, pid_b: u32) -> Seed {
    let dir = &v.run_dir;
    let entry = dir.join("instance.json");
    let seed = |kind, watched, absent| Seed {
        kind,
        watched,
        absent,
    };
    let unique = format!("{}", uuid::Uuid::new_v4().simple());
    match rng.gen_range(0..12) {
        0 => {
            let n = rng.gen_range(0..=256);
            let body: Vec<u8> = (0..n).map(|_| rng.gen()).collect();
            fs::write(&entry, body).expect("seed file");
            let mode = [0o600, 0o644, 0o400, 0o000][rng.gen_range(0..4)];
            fs::set_permissions(&entry, fs::Permissions::from_mode(mode)).expect("chmod");
            seed("regular file", vec![entry], None)
        }
        1 => {
            fs::write(&entry, b"").expect("seed empty");
            seed("empty file", vec![entry], None)
        }
        2 => {
            let pid_a = if rng.gen() {
                pid_b
            } else {
                pid_b.wrapping_add(1)
            };
            super::publish(v, pid_a, None).expect("prior publication");
            seed("prior publication", vec![entry], None)
        }
        3 => {
            let sib = dir.join("sib.json");
            fs::write(&sib, b"S").expect("sibling");
            std::os::unix::fs::symlink(&sib, &entry).expect("symlink");
            seed("symlink to sibling", vec![entry, sib], None)
        }
        4 => {
            let out = fx.root.join(format!("outside-{unique}.json"));
            fs::write(&out, b"O").expect("outside");
            std::os::unix::fs::symlink(&out, &entry).expect("symlink");
            seed("symlink outside", vec![entry, out], None)
        }
        5 => {
            let gone = fx.root.join(format!("nowhere-{unique}.json"));
            std::os::unix::fs::symlink(&gone, &entry).expect("symlink");
            seed("dangling symlink", vec![entry], Some(gone))
        }
        6 => {
            let d = fx.mkdir(&dir.join("somedir"));
            std::os::unix::fs::symlink(&d, &entry).expect("symlink");
            seed("symlink to dir", vec![entry, d], None)
        }
        7 => {
            std::os::unix::fs::symlink("instance.json", &entry).expect("symlink");
            seed("self-loop symlink", vec![entry], None)
        }
        8 => {
            fs::create_dir(&entry).expect("mkdir");
            seed("empty dir", vec![entry], None)
        }
        9 => {
            fs::create_dir(&entry).expect("mkdir");
            let keep = entry.join("keep");
            fs::write(&keep, b"k").expect("keep");
            seed("non-empty dir", vec![entry, keep], None)
        }
        10 => {
            let c = std::ffi::CString::new(entry.as_os_str().as_encoded_bytes()).expect("cstr");
            // SAFETY: `c` is a valid NUL-terminated path for the call.
            let rc = unsafe { libc::mkfifo(c.as_ptr(), 0o600) };
            assert_eq!(rc, 0, "mkfifo");
            seed("fifo", vec![entry], None)
        }
        _ => {
            let sib = dir.join("sib");
            fs::write(&sib, b"H").expect("sibling");
            fs::hard_link(&sib, &entry).expect("hard link");
            seed("hard link to sibling", vec![entry, sib], None)
        }
    }
}
