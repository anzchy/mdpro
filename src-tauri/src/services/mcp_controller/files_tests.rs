//! Test cases for `services::mcp_controller::files` (ADR-0040 WI-1: F-1..F-4,
//! F-7). F-5 and F-6 live in `files_unpublish_tests.rs`.
//!
//! Wired from `files.rs` with `#[cfg(test)] #[path = ...] mod tests;`. Every
//! directory comes from `temp_files_dir`, which asserts it is under
//! `temp_dir()` before any test touches it (F-7).

use super::*;
use crate::services::mcp_controller::test_support::{
    assert_test_dir, probe_mode_umask, remove_test_dir, temp_files_dir,
};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

const TOK64: &str = "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f";

fn fresh(label: &str) -> PathBuf {
    let dir = temp_files_dir(label);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn entries(dir: &Path) -> BTreeSet<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect()
}

fn mode_of(p: &Path) -> u32 {
    fs::metadata(p).unwrap().permissions().mode() & 0o777
}

fn create_with_mode(p: &Path, mode: u32, bytes: &[u8]) {
    use std::io::Write;
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(p)
        .unwrap();
    f.set_permissions(fs::Permissions::from_mode(mode)).unwrap();
    f.write_all(bytes).unwrap();
}

// F-1: round trip over ports {1,1024,41234,65535} x three token shapes.
#[test]
fn f1_publish_round_trips_every_port_and_token_shape() {
    let ff = "f".repeat(64);
    let mut failures = Vec::new();
    for port in [1u16, 1024, 41234, 65535] {
        for (shape, tok) in ["a", TOK64, ff.as_str()].into_iter().enumerate() {
            let dir = fresh("f1");
            let res = publish(&dir, port, tok);
            let got = (
                res,
                fs::read_to_string(dir.join("server.port")).ok(),
                fs::read_to_string(dir.join("server.token")).ok(),
                entries(&dir),
            );
            let want = (
                Ok(()),
                Some(port.to_string()),
                Some(tok.to_string()),
                ["server.port", "server.token"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
            );
            if got != want {
                // Never print token values: name the shape and the fields.
                failures.push(format!(
                    "({port}, token shape #{shape}): result {:?}/{:?}, port {:?}/{:?}, \
                     token equal {}, entries {:?}/{:?}",
                    got.0,
                    want.0,
                    got.1,
                    want.1,
                    got.2 == want.2,
                    got.3,
                    want.3
                ));
            }
            remove_test_dir(&dir);
        }
    }
    assert!(
        failures.is_empty(),
        "round-trip failures:\n{}",
        failures.join("\n")
    );
}

// F-2: token is 0600 with (a) empty dir, (b) stale 0644 target, (c) stale 0644 tmp.
#[test]
fn f2_token_file_is_0600_over_permissive_stale_target_or_tmp() {
    for pre in ["empty", "stale-target", "stale-tmp"] {
        let dir = fresh("f2");
        match pre {
            "stale-target" => create_with_mode(&dir.join("server.token"), 0o644, b"old"),
            "stale-tmp" => create_with_mode(&dir.join(TOKEN_TMP_NAME), 0o644, b"old"),
            _ => {}
        }
        assert_eq!(publish(&dir, 41234, TOK64), Ok(()), "pre-state {pre}");
        let token = dir.join("server.token");
        assert_eq!(mode_of(&token), 0o600, "pre-state {pre}");
        assert!(
            fs::read_to_string(&token).unwrap() == TOK64,
            "pre-state {pre}: token file content"
        );
        let debris: Vec<_> = entries(&dir)
            .into_iter()
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(debris.is_empty(), "pre-state {pre}: tmp debris {debris:?}");
        remove_test_dir(&dir);
    }
}

// F-2b: `open_owner_only` is 0600 before any write, and replaces (not reuses) a 0644 file.
#[test]
fn f2b_open_owner_only_is_0600_before_any_write_and_replaces_old_inode() {
    let dir = fresh("f2b");
    if probe_mode_umask(&dir) & 0o066 == 0 {
        eprintln!("umask too strict to discriminate");
        remove_test_dir(&dir);
        return;
    }
    // (a) fresh path
    let fx = open_owner_only(&dir.join("x")).unwrap();
    let mx = fx.metadata().unwrap();
    assert_eq!(mx.permissions().mode() & 0o777, 0o600, "(a) mode");
    assert_eq!(mx.len(), 0, "(a) len");

    // (b) pre-existing 0644 "old", with the old fd held open
    let y = dir.join("y");
    create_with_mode(&y, 0o644, b"old");
    let mut old = File::open(&y).unwrap();
    let fy = open_owner_only(&y).unwrap();
    let my = fy.metadata().unwrap();
    assert_ne!(my.ino(), old.metadata().unwrap().ino(), "(b) inode reused");
    assert_eq!(
        old.metadata().unwrap().nlink(),
        0,
        "(b) old inode still linked"
    );
    let mut via_old = String::new();
    old.read_to_string(&mut via_old).unwrap();
    assert_eq!(via_old, "old", "(b) old fd content");
    assert_eq!(my.len(), 0, "(b) len");
    assert_eq!(my.permissions().mode() & 0o777, 0o600, "(b) mode");
    assert_eq!(
        fs::read_to_string(&y).unwrap(),
        "",
        "(b) path still holds old bytes"
    );
    remove_test_dir(&dir);
}

// F-3: a directory at server.token -> Err(WriteToken), and no server.port (fresh or stale).
#[test]
fn f3_failed_token_write_leaves_no_port_file() {
    for stale_port in [false, true] {
        let dir = fresh("f3");
        if stale_port {
            fs::write(dir.join("server.port"), "999").unwrap();
        }
        fs::create_dir(dir.join("server.token")).unwrap();
        assert_eq!(publish(&dir, 41234, TOK64), Err(FilesError::WriteToken));
        assert!(
            !dir.join("server.port").exists(),
            "stale_port={stale_port}: port left behind"
        );
        remove_test_dir(&dir);
    }
}

// F-4: no FilesError variant renders a path or OS text.
#[test]
fn f4_files_error_carries_no_path_or_os_text() {
    fn witness(e: FilesError) -> FilesError {
        match e {
            FilesError::CreateDir | FilesError::WriteToken | FilesError::WritePort => e,
        }
    }
    let tmp = std::env::temp_dir().to_string_lossy().into_owned();
    for e in [
        FilesError::CreateDir,
        FilesError::WriteToken,
        FilesError::WritePort,
    ]
    .map(witness)
    {
        for s in [format!("{e:?}"), format!("{e}")] {
            assert!(!s.contains('/'), "{s:?} contains '/'");
            assert!(!s.contains("os error"), "{s:?} contains OS text");
            assert!(!s.contains(tmp.as_str()), "{s:?} contains temp_dir");
        }
    }
}

// F-7: the guard accepts temp dirs ...
#[test]
fn f7_temp_files_dir_is_under_temp_dir() {
    let dir = temp_files_dir("guard");
    assert!(dir.starts_with(std::env::temp_dir()));
    assert_test_dir(&dir);
}

// F-7: ... and panics on the real app data dir. Hand-built path: tests never
// call `dirs::data_dir()`, and the guard only inspects the path string.
#[test]
#[should_panic(expected = "not under temp_dir")]
fn f7_guard_rejects_app_data_dir() {
    assert_test_dir(Path::new("/Users/nobody/Library/Application Support/mdpro"));
}
