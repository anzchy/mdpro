use super::normalize_release_id;
use std::path::{Path, PathBuf};

const UNKNOWN: &str = "unknown";

/// The env var name, assembled so this file's own source never contains it
/// as a string literal (r09 scans every `.rs` file, this one included).
const NEEDLE: &str = concat!("MDPRO_", "RELEASE_ID");

fn sha() -> String {
    "0123456789abcdef0123456789abcdef01234567".to_string()
}

fn id(version: &str) -> String {
    format!("{version}@{}", sha())
}

fn assert_unknown(raw: &str) {
    assert_eq!(normalize_release_id(Some(raw)), UNKNOWN, "input {raw:?}");
}

#[test]
fn r01_none_and_empty_give_unknown() {
    assert_eq!(normalize_release_id(None), UNKNOWN);
    assert_eq!(normalize_release_id(Some("")), UNKNOWN);
}

#[test]
fn r02_valid_ids_come_back_as_the_same_slice() {
    let versions = [
        "0.3.1",
        "0.0.0",
        "10.20.30",
        "1.2.3-rc.1",
        "1.2.3-alpha-2.x",
        "0.3.1-0",
        "18446744073709551616.0.1",
    ];
    for v in versions {
        let raw = id(v);
        let out = normalize_release_id(Some(&raw));
        assert_eq!(out, raw, "version {v:?}");
        assert!(
            std::ptr::eq(out, raw.as_str()),
            "not the input slice: {v:?}"
        );
    }
    let other = "0.3.1@fedcba9876543210fedcba9876543210fedcba98";
    assert_eq!(normalize_release_id(Some(other)), other);
}

#[test]
fn r03_the_sha_is_exactly_40_lowercase_hex() {
    let s = sha();
    for bad in [
        format!("0.3.1@{}", &s[..39]),
        format!("0.3.1@{s}0"),
        format!("0.3.1@{}", &s[..7]),
        format!("0.3.1@{}", s.to_uppercase()),
        format!("0.3.1@{}g", &s[..39]),
        format!("0.3.1@{}", "0123456789abcdef".repeat(4)),
        "0.3.1@".to_string(),
        format!("0.3.1@{} ", s),
        format!("0.3.1@{}\n", s),
    ] {
        assert_unknown(&bad);
    }
}

#[test]
fn r04_the_version_is_strict_semver_without_build_metadata() {
    for bad in [
        "",
        "0.3",
        "0.3.1.4",
        "v0.3.1",
        "01.2.3",
        "1.02.3",
        "1.2.03",
        "00.0.0",
        "1.2.3+build",
        "1.2.3-rc.1+b",
        "1.2.3-",
        "1.2.3-rc_1",
        "1.2.3-rc 1",
        " 0.3.1",
        "a.b.c",
        "1..3",
        ".1.2",
        "1.2.",
        "-1.2.3",
        "1.2.3-é",
        "\u{0661}.2.3",
        "unknown",
    ] {
        assert_unknown(&id(bad));
    }
}

#[test]
fn r05_separator_and_shape() {
    let s = sha();
    for bad in [
        s.clone(),
        "0.3.1".to_string(),
        format!("0.3.1{s}"),
        format!("0.3.1@0.3.1@{s}"),
        format!("0.3.1 @{s}"),
        format!("0.3.1@ {s}"),
        format!("release-0.3.1@{}", &s[..7]),
        "0123456789abcdef".repeat(4),
        UNKNOWN.to_string(),
    ] {
        assert_unknown(&bad);
    }
}

#[test]
fn r06_build_id_is_not_a_release_id_and_vice_versa() {
    // The two ids are separate contracts (D175 option B): a valid buildId is
    // never a valid releaseId, and a valid releaseId is never a valid buildId.
    let build_id = "fedcba9876543210".repeat(4);
    assert_unknown(&build_id);
    let release = id("0.3.1");
    assert_eq!(
        crate::services::build_info::normalize_build_id(Some(&release)),
        UNKNOWN
    );
}

fn rs_files(dir: &Path, acc: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("read src dir") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            rs_files(&path, acc);
        } else if path.extension().is_some_and(|e| e == "rs") {
            acc.push(path);
        }
    }
}

#[test]
fn r07_release_id_read_only_by_option_env_in_main_rs() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    rs_files(&root.join("src"), &mut files);
    files.push(root.join("build.rs"));
    files.sort();
    let quoted = format!("\"{NEEDLE}\"");
    let mut hits = Vec::new();
    for file in &files {
        let src = std::fs::read_to_string(file).expect("read rs file");
        let rel = file.strip_prefix(root).expect("under manifest dir");
        let rel = rel.to_string_lossy().replace('\\', "/");
        for line in src.lines() {
            let t = line.trim_start();
            if t.starts_with("//") {
                continue;
            }
            if line.contains(&quoted) {
                hits.push((rel.clone(), t.to_string()));
            }
        }
    }
    assert_eq!(
        hits.len(),
        1,
        "code lines naming the release id var: {hits:?}"
    );
    assert_eq!(hits[0].0, "src/main.rs", "{hits:?}");
    let compact: String = hits[0].1.chars().filter(|c| !c.is_whitespace()).collect();
    assert!(
        compact.contains(&format!("=option_env!({quoted});")),
        "{hits:?}"
    );
}
