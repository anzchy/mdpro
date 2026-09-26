//! Temp-HOME cases for `mcp_launch::on_skip` (ADR-0039, WI-4).
//!
//! SK-01 … SK-03. `on_skip` must remove exactly `data_dir()/mdpro/
//! {server.port, server.token}` without reading them, and conserve the rest.

use super::*;
use crate::services::http_server;
use crate::services::window_restore::test_home::{
    config_file, read_config_bytes, seed_config, TestHome,
};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

/// `data_dir()/mdpro`, asserted to live inside the temp HOME first. Copied
/// verbatim from `app_exit_tests.rs`: on WSL with XDG_DATA_HOME set,
/// `data_dir()` ignores $HOME and cleanup would hit the developer's real
/// config files; this makes that fail loudly.
fn mdpro_dir(temp_home: &Path) -> PathBuf {
    let data = dirs::data_dir().unwrap();
    assert!(
        data.starts_with(temp_home),
        "data_dir() {:?} escaped temp HOME {:?}",
        data,
        temp_home
    );
    data.join("mdpro")
}

fn sorted_names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn sk01_removes_the_stale_pair_and_conserves_siblings_and_preferences() {
    let h = TestHome::new("mcp_sk01");
    let dir = mdpro_dir(&h.dir);
    http_server::write_server_config(4242, "tok").unwrap();
    let other = dir.join("other.json");
    fs::write(&other, b"{\"x\":1}").unwrap();
    let other_before = fs::read(&other).unwrap();
    let prefs_before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(false));

    // Non-vacuous: all four files exist before the call.
    assert!(dir.join("server.port").exists());
    assert!(dir.join("server.token").exists());
    assert!(other.exists());
    assert!(config_file(&h.dir).exists());

    on_skip();

    assert!(!dir.join("server.port").exists(), "server.port survived");
    assert!(!dir.join("server.token").exists(), "server.token survived");
    assert_eq!(fs::read(&other).unwrap(), other_before);
    assert_eq!(read_config_bytes(&h.dir), prefs_before);
    assert_eq!(sorted_names(&dir), vec!["other.json".to_string()]);
}

#[test]
fn sk02_nothing_to_clean_returns_normally_creates_nothing_and_is_idempotent() {
    let h = TestHome::new("mcp_sk02");
    let dir = mdpro_dir(&h.dir);
    assert!(!dir.exists(), "temp HOME was not clean");

    on_skip();
    assert!(!dir.exists(), "first on_skip created data_dir()/mdpro");
    on_skip();
    assert!(!dir.exists(), "second on_skip created data_dir()/mdpro");
    assert!(!config_file(&h.dir).exists());
}

#[test]
fn sk03_a_partial_stale_state_with_only_the_token_is_cleaned() {
    let h = TestHome::new("mcp_sk03");
    let dir = mdpro_dir(&h.dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("server.token"), "tok").unwrap();
    assert!(
        !dir.join("server.port").exists(),
        "precondition: no port file"
    );

    on_skip();

    assert!(
        !dir.join("server.token").exists(),
        "half-pair token survived"
    );
}
