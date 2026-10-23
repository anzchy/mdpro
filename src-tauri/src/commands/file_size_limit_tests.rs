//! D46 WI-4 (cases RS-1..RS-4 of `.claude/tdd-guardian/tests-20261003-130127.md`)
//! — the Rust side of the mocked `invoke` rejection the frontend tests use.
//!
//! **Law (size gate)**: *monotone threshold, measured size kept as reported.*
//! `open_file_from_path(p)` returns `Err(FileTooLarge { path == p, size ==
//! metadata.len() })` iff `len > MAX_FILE_SIZE`; a file at or below the limit is
//! never rejected as too large.
//!
//! **Law (wire shape)**: `FileError` serializes externally tagged, and
//! `to_value(from_value(to_value(e))) == to_value(e)` for every variant. The JS
//! fixtures (OF-4, D46-R3, OW-1) must equal these literals.
//!
//! Characterization tests: they start green. Nothing is mocked — real
//! filesystem, real serde. The rejected side uses sparse `set_len` files (only
//! metadata is read before the gate). The accepted side writes real ASCII
//! bytes (~10 MB per case): a sparse file is all NUL, and encoding detection on
//! that content is not pinned here, so it could flake as `EncodingError`.
//! Domains are enumerated; proptest is not a dependency.

use super::*;
use serde_json::{json, Value};
use std::fs::File;
use std::path::{Path, PathBuf};

/// A per-test fixture directory, removed on drop so a failing assertion does
/// not leave multi-megabyte files behind.
struct FixtureDir(PathBuf);

impl FixtureDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir()
            .join("mdpro_file_size_limit_tests")
            .join(format!("{label}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create fixture dir");
        FixtureDir(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for FixtureDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Failure-message summary that never prints document content: an `Ok` from a
/// mutated gate would otherwise dump ~10 MB through `Debug`.
fn describe(r: &Result<OpenFileResult, FileError>) -> String {
    match r {
        Ok(opened) => format!("Ok(content.len={})", opened.document.content.len()),
        Err(err) => format!("Err({err:?})"),
    }
}

const FIVE_GIB: u64 = 5 * 1024 * 1024 * 1024;
const PAGE: u64 = 4096;

/// RS-1: sparse files above the limit are rejected with the exact path and the
/// untruncated measured size (5 GiB exceeds u32 and stays a safe JS integer).
#[test]
fn rs1_files_above_limit_are_rejected_with_path_and_exact_size() {
    let dir = FixtureDir::new("rs1");
    for n in [MAX_FILE_SIZE + 1, MAX_FILE_SIZE + PAGE, FIVE_GIB] {
        let p = dir.path().join(format!("over_{n}.md"));
        let file = File::create(&p).expect("create sparse fixture");
        file.set_len(n).expect("set_len sparse fixture");
        drop(file);
        let p_str = p.to_string_lossy().to_string();

        let r = open_file_from_path(&p_str, None);

        assert!(
            matches!(
                r,
                Err(FileError::FileTooLarge { ref path, size }) if *path == p_str && size == n
            ),
            "n={n}: expected FileTooLarge {{ path: {p_str}, size: {n} }}, got {}",
            describe(&r)
        );
        std::fs::remove_file(&p).expect("remove sparse fixture");
    }
}

/// RS-1 (acceptance literal): `MAX_FILE_SIZE + 1` reports `size: 10485761`.
#[test]
fn rs1_one_byte_over_reports_size_10485761() {
    let dir = FixtureDir::new("rs1_literal");
    let p = dir.path().join("one_over.md");
    File::create(&p)
        .expect("create sparse fixture")
        .set_len(MAX_FILE_SIZE + 1)
        .expect("set_len sparse fixture");

    let r = open_file_from_path(&p.to_string_lossy(), None);

    assert!(
        matches!(
            r,
            Err(FileError::FileTooLarge {
                size: 10_485_761,
                ..
            })
        ),
        "got {}",
        describe(&r)
    );
}

/// RS-2: real ASCII content at and just below the limit opens, and the decoded
/// content keeps every byte.
#[test]
fn rs2_files_at_and_just_below_limit_open_with_full_content() {
    let dir = FixtureDir::new("rs2");
    for n in [MAX_FILE_SIZE - 1, MAX_FILE_SIZE] {
        let p = dir.path().join(format!("under_{n}.md"));
        let len = usize::try_from(n).expect("fixture size fits usize");
        std::fs::write(&p, vec![b'a'; len]).expect("write fixture");

        let r = open_file_from_path(&p.to_string_lossy(), None);

        match r {
            Ok(opened) => assert_eq!(opened.document.content.len(), len, "n={n}"),
            Err(err) => panic!("n={n}: expected Ok, got {err:?}"),
        }
        std::fs::remove_file(&p).expect("remove fixture");
    }
}

/// RS-2: an empty file is never rejected as too large.
#[test]
fn rs2_empty_file_is_not_too_large() {
    let dir = FixtureDir::new("rs2_empty");
    let p = dir.path().join("empty.md");
    std::fs::write(&p, b"").expect("write empty fixture");

    let r = open_file_from_path(&p.to_string_lossy(), None);

    assert!(
        !matches!(r, Err(FileError::FileTooLarge { .. })),
        "got {}",
        describe(&r)
    );
}

/// RS-3: the exact value the vitest mocks reject `invoke` with.
#[test]
fn rs3_file_too_large_serializes_to_the_mocked_literal() {
    let err = FileError::FileTooLarge {
        path: "/tmp/big.md".into(),
        size: 10_485_761,
    };

    let value = serde_json::to_value(&err).expect("serialize FileTooLarge");

    assert_eq!(
        value,
        json!({"FileTooLarge": {"path": "/tmp/big.md", "size": 10_485_761}})
    );
}

/// One fixture per variant with its expected wire literal. The exhaustive
/// `match` (no `_` arm) makes a new variant fail to compile until a row is
/// added here.
fn wire_literal(err: &FileError) -> Value {
    match err {
        FileError::FileNotFound { .. } => json!({"FileNotFound": {"path": "/tmp/a.md"}}),
        FileError::PermissionDenied { .. } => {
            json!({"PermissionDenied": {"path": "/tmp/a.md"}})
        }
        FileError::EncodingError { .. } => {
            json!({"EncodingError": {"path": "/tmp/a.md", "detected": "unknown"}})
        }
        FileError::FileTooLarge { .. } => {
            json!({"FileTooLarge": {"path": "/tmp/a.md", "size": 10_485_761}})
        }
        FileError::DiskFull => json!("DiskFull"),
        FileError::InvalidPath { .. } => json!({"InvalidPath": {"path": "/tmp/a.md"}}),
        FileError::IoError { .. } => json!({"IoError": {"message": "boom"}}),
        FileError::ExternalChangeConflict { .. } => {
            json!({"ExternalChangeConflict": {"path": "/tmp/a.md"}})
        }
        FileError::AlreadyOpen { .. } => json!({"AlreadyOpen": {"path": "/tmp/a.md"}}),
    }
}

fn every_variant() -> Vec<FileError> {
    let path = || "/tmp/a.md".to_string();
    vec![
        FileError::FileNotFound { path: path() },
        FileError::PermissionDenied { path: path() },
        FileError::EncodingError {
            path: path(),
            detected: "unknown".into(),
        },
        FileError::FileTooLarge {
            path: path(),
            size: 10_485_761,
        },
        FileError::DiskFull,
        FileError::InvalidPath { path: path() },
        FileError::IoError {
            message: "boom".into(),
        },
        FileError::ExternalChangeConflict { path: path() },
        FileError::AlreadyOpen { path: path() },
    ]
}

/// RS-4: every variant's wire shape matches its literal, and the round-trip
/// through `Deserialize` re-serializes to the same value.
#[test]
fn rs4_every_variant_has_its_wire_shape_and_round_trips() {
    let variants = every_variant();
    assert_eq!(variants.len(), 9, "one fixture per FileError variant");

    for err in &variants {
        let value = serde_json::to_value(err).expect("serialize");
        assert_eq!(value, wire_literal(err), "wire shape of {err:?}");

        let back: FileError = serde_json::from_value(value.clone()).expect("deserialize");
        let again = serde_json::to_value(&back).expect("re-serialize");
        assert_eq!(again, value, "round-trip of {err:?}");
    }
}
