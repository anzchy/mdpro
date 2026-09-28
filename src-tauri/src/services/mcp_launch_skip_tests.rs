//! Temp-HOME cases for the launch Skip path (ADR-0039, WI-4).
//!
//! SK-01 … SK-03. A Skip launch through the app's own `ControllerEnv`
//! (`http_server::app_controller_env`, i.e. `data_dir()/mdpro`) and
//! `mcp_controller::launch` must remove exactly `data_dir()/mdpro/
//! {server.port, server.token}` without reading them, and conserve the rest.
//! (The old `on_skip` wrapper had only these callers and was removed; Skip
//! never binds, so the app port is never touched.)

use super::*;
use crate::services::http_server;
use crate::services::mcp_controller::files;
use crate::services::mcp_controller::launch::launch;
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::GENEROUS;
use crate::services::window_restore::test_home::{
    config_file, read_config_bytes, seed_config, TestHome,
};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::time::timeout;

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

/// The Skip launch logs, and the logger's settings cache loads (and may
/// materialise) `config.json` once per process, in whatever HOME is current.
/// Warm it inside this temp HOME and drop what it wrote, so every check below
/// sees only what the Skip itself does.
fn warm_logger(temp_home: &Path) {
    let _ = crate::services::logger::get_log_settings();
    let _ = fs::remove_file(config_file(temp_home));
}

/// The production Skip: the app's env, a Skip decision, `launch`, awaited.
async fn skip_launch() {
    let env = http_server::app_controller_env().expect("data_dir()");
    let c = Arc::new(McpController::new(env));
    let skip = McpLaunchDecision::Skip(SkipReason::Disabled);
    timeout(GENEROUS, launch(c, skip, plain()))
        .await
        .expect("skip launch returned")
        .expect("skip launch task");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sk01_removes_the_stale_pair_and_conserves_siblings_and_preferences() {
    let h = TestHome::new("mcp_sk01");
    warm_logger(&h.dir);
    let dir = mdpro_dir(&h.dir);
    files::publish(&dir, 4242, "tok").unwrap();
    let other = dir.join("other.json");
    fs::write(&other, b"{\"x\":1}").unwrap();
    let other_before = fs::read(&other).unwrap();
    let prefs_before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(false));

    // Non-vacuous: all four files exist before the call.
    assert!(dir.join("server.port").exists());
    assert!(dir.join("server.token").exists());
    assert!(other.exists());
    assert!(config_file(&h.dir).exists());

    skip_launch().await;

    assert!(!dir.join("server.port").exists(), "server.port survived");
    assert!(!dir.join("server.token").exists(), "server.token survived");
    assert_eq!(fs::read(&other).unwrap(), other_before);
    assert_eq!(read_config_bytes(&h.dir), prefs_before);
    assert_eq!(sorted_names(&dir), vec!["other.json".to_string()]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sk02_nothing_to_clean_returns_normally_creates_nothing_and_is_idempotent() {
    let h = TestHome::new("mcp_sk02");
    warm_logger(&h.dir);
    let dir = mdpro_dir(&h.dir);
    assert!(!dir.exists(), "temp HOME was not clean");

    skip_launch().await;
    assert!(!dir.exists(), "first skip created data_dir()/mdpro");
    skip_launch().await;
    assert!(!dir.exists(), "second skip created data_dir()/mdpro");
    assert!(!config_file(&h.dir).exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sk03_a_partial_stale_state_with_only_the_token_is_cleaned() {
    let h = TestHome::new("mcp_sk03");
    warm_logger(&h.dir);
    let dir = mdpro_dir(&h.dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("server.token"), "tok").unwrap();
    assert!(
        !dir.join("server.port").exists(),
        "precondition: no port file"
    );

    skip_launch().await;

    assert!(
        !dir.join("server.token").exists(),
        "half-pair token survived"
    );
}
