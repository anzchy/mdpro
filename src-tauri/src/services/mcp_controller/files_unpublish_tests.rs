//! Test cases for `services::mcp_controller::files::unpublish` and the
//! publish/unpublish invariant (ADR-0040 WI-1, F-5 and F-6).
//!
//! Split from `files_tests.rs` to keep both files under 300 lines. Every
//! directory comes from `temp_files_dir`, which asserts it is under
//! `temp_dir()` before any test touches it (F-7).

use super::*;
use crate::services::mcp_controller::test_support::{remove_test_dir, temp_files_dir};
use std::fs;
use std::path::{Path, PathBuf};

const TOK64: &str = "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f";

fn fresh(label: &str) -> PathBuf {
    let dir = temp_files_dir(label);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[derive(Clone, Copy, Debug)]
enum Op {
    PublishOk,
    PublishFailToken,
    Unpublish,
}

/// Reference model: the last successful publish survives only if nothing
/// that clears the files comes after it.
fn model(seq: &[Op]) -> Option<(u16, String)> {
    let mut state = None;
    for (i, op) in seq.iter().enumerate() {
        state = match op {
            Op::PublishOk => Some((41000 + i as u16, format!("{i:064x}"))),
            Op::PublishFailToken | Op::Unpublish => None,
        };
    }
    state
}

fn read_state(dir: &Path) -> Option<(u16, String)> {
    let port = fs::read_to_string(dir.join("server.port")).ok()?;
    let token = fs::read_to_string(dir.join("server.token")).ok()?;
    Some((port.parse().ok()?, token))
}

fn invariant_holds(dir: &Path) -> bool {
    !dir.join("server.port").exists() || dir.join("server.token").is_file()
}

// F-5: "port present => token present" after every call, for all 121 sequences of length <= 4.
#[test]
fn f5_port_implies_token_over_every_sequence_up_to_length_4() {
    let alphabet = [Op::PublishOk, Op::PublishFailToken, Op::Unpublish];
    let mut seqs: Vec<Vec<Op>> = vec![vec![]];
    for len in 1..=4 {
        let prev: Vec<Vec<Op>> = seqs
            .iter()
            .filter(|s| s.len() == len - 1)
            .cloned()
            .collect();
        for s in prev {
            for op in alphabet {
                let mut n = s.clone();
                n.push(op);
                seqs.push(n);
            }
        }
    }
    assert_eq!(seqs.len(), 121);
    let mut failures = Vec::new();
    for seq in &seqs {
        let dir = fresh("f5");
        for (i, op) in seq.iter().enumerate() {
            let token = dir.join("server.token");
            match op {
                Op::PublishOk => {
                    let _ = publish(&dir, 41000 + i as u16, &format!("{i:064x}"));
                }
                Op::PublishFailToken => {
                    let _ = fs::remove_file(&token);
                    fs::create_dir(&token).unwrap();
                    let _ = publish(&dir, 41000 + i as u16, &format!("{i:064x}"));
                    if !invariant_holds_with_dir_token(&dir) {
                        failures.push(format!(
                            "{seq:?} step {i}: port present after failed publish"
                        ));
                    }
                    fs::remove_dir(&token).unwrap();
                }
                Op::Unpublish => unpublish(&dir),
            }
            if !invariant_holds(&dir) {
                failures.push(format!("{seq:?} step {i}: port present without token"));
            }
        }
        let (got, want) = (read_state(&dir), model(seq));
        if got != want {
            failures.push(format!("{seq:?} -> got {got:?}, want {want:?}"));
        }
        remove_test_dir(&dir);
    }
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// While the obstacle dir sits at `server.token`, no token file can exist, so
/// the invariant reduces to "no port file".
fn invariant_holds_with_dir_token(dir: &Path) -> bool {
    !dir.join("server.port").exists()
}

/// Full `(relative path, bytes)` listing, recursive. `None` if `dir` is missing.
fn snapshot(dir: &Path, skip_mcp: bool) -> Option<Vec<(String, Vec<u8>)>> {
    fn walk(root: &Path, at: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for e in fs::read_dir(at).unwrap() {
            let p = e.unwrap().path();
            let rel = p.strip_prefix(root).unwrap().to_string_lossy().into_owned();
            if p.is_dir() {
                out.push((format!("{rel}/"), Vec::new()));
                walk(root, &p, out);
            } else {
                out.push((rel, fs::read(&p).unwrap()));
            }
        }
    }
    if !dir.exists() {
        return None;
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out.retain(|(r, _)| !(skip_mcp && (r == "server.port" || r == "server.token")));
    out.sort();
    Some(out)
}

// F-6: unpublish run 0/1/2 times over every starting state; siblings keep their bytes.
#[test]
fn f6_unpublish_is_idempotent_and_conserves_siblings() {
    for start in ["missing", "empty", "port-only", "token-only", "both"] {
        for runs in 0..=2 {
            let dir = temp_files_dir("f6");
            if start != "missing" {
                fs::create_dir_all(dir.join("drafts")).unwrap();
                fs::write(dir.join("drafts/a.md"), b"draft\x00bytes").unwrap();
                fs::write(dir.join("config.json"), b"{}").unwrap();
            }
            if start == "port-only" || start == "both" {
                fs::write(dir.join("server.port"), "41234").unwrap();
            }
            if start == "token-only" || start == "both" {
                fs::write(dir.join("server.token"), TOK64).unwrap();
            }
            let before_all = snapshot(&dir, false);
            let before_sib = snapshot(&dir, true);
            let mut after_one = None;
            for r in 0..runs {
                let d = dir.clone();
                let res = std::panic::catch_unwind(move || unpublish(&d));
                assert!(res.is_ok(), "{start} run {r}: unpublish panicked");
                if r == 0 {
                    after_one = snapshot(&dir, false);
                }
            }
            let ctx = format!("start={start} runs={runs}");
            if runs == 0 {
                assert!(snapshot(&dir, false) == before_all, "{ctx}: state changed");
            } else {
                assert!(!dir.join("server.port").exists(), "{ctx}: port remains");
                assert!(!dir.join("server.token").exists(), "{ctx}: token remains");
                assert!(snapshot(&dir, false) == after_one, "{ctx}: not idempotent");
                assert!(
                    snapshot(&dir, true) == before_sib,
                    "{ctx}: siblings changed"
                );
            }
            if start == "missing" {
                assert!(!dir.exists(), "{ctx}: missing dir was created");
            }
            remove_test_dir(&dir);
        }
    }
}
