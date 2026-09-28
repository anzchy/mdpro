//! S-8 (ADR-0040 WI-7): every toggle writes one `mcp.server.toggle` group
//! (one `actionId`, `[start, success|fail]`) whose values come from closed
//! enum domains, over every outcome: on ok, off ok, bind in use, persist
//! failed (real), config unreadable, exiting, status unavailable. The log is
//! the temp `$HOME`'s `~/.mdpro/mdpro.log` (`TestHome`, logger forced on).
//! Failure messages never print a token.

use super::switch_tests::{seed_disk, set};
use crate::services::app_exit::run_exit_cleanup;
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::switch::McpSwitchError;
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{
    force_logger_on, hold_port, loopback, read_published, remove_test_dir, temp_files_dir,
    test_env, test_env0,
};
use crate::services::window_restore::test_home::{write_raw_config, TestHome};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const EVENT: &str = "mcp.server.toggle";
const STATUS_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/mcp-status-contract.json"
);
/// OS and parser text that must never reach a toggle line.
const FORBIDDEN_TEXT: [&str; 4] = [
    "os error",
    "Permission denied",
    "line 1 column",
    "Address already in use",
];

/// What the scenarios leave behind for the log assertions.
#[derive(Default)]
struct Seen {
    directions: Vec<&'static str>,
    tokens: Vec<String>,
    dirs: Vec<PathBuf>,
}

impl Seen {
    fn controller(&mut self, label: &str) -> (PathBuf, McpController) {
        let dir = temp_files_dir(label);
        self.dirs.push(dir.clone());
        let c = McpController::new(test_env0(&dir));
        (dir, c)
    }
    fn capture_token(&mut self, dir: &Path) {
        let (_, token) = read_published(dir).expect("published");
        self.tokens.push(token);
    }
    fn toggled(&mut self, enabled: bool) {
        self.directions.push(if enabled { "on" } else { "off" });
    }
}

/// Restores `~/.mdpro` to 0o700 on drop.
#[cfg(unix)]
struct ModeRestore(PathBuf);
#[cfg(unix)]
impl Drop for ModeRestore {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o700));
    }
}

/// Scenario 3: the real persist fails to write under a read-only
/// `~/.mdpro`. Returns false (skipped) when this process can still write.
#[cfg(unix)]
async fn real_persist_failed(home: &Path, seen: &mut Seen) -> bool {
    use std::os::unix::fs::PermissionsExt;
    seed_disk(home, true);
    let (dir, c) = seen.controller("s8-3");
    c.reconcile(true, plain()).await.expect("snapshot");
    seen.capture_token(&dir);
    let mdpro = home.join(".mdpro");
    assert!(
        mdpro.join("mdpro.log").exists(),
        "the log must exist before chmod"
    );
    fs::set_permissions(&mdpro, fs::Permissions::from_mode(0o555)).expect("chmod 555");
    let restore = ModeRestore(mdpro.clone());
    let probe = mdpro.join("write_probe");
    let ran = if fs::write(&probe, b"x").is_ok() {
        let _ = fs::remove_file(&probe);
        false
    } else {
        let res = set(&c, false).await;
        seen.toggled(false);
        assert_eq!(res.map(|_| ()), Err(McpSwitchError::PersistFailed));
        true
    };
    drop(restore);
    c.reconcile(false, plain()).await.expect("cleanup");
    ran
}

fn fixture_list(fixture: &Value, key: &str) -> BTreeSet<String> {
    fixture[key]
        .as_array()
        .expect("fixture list")
        .iter()
        .map(|x| x.as_str().expect("fixture string").to_string())
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn s8_toggle_log_is_grouped_and_enum_bounded_over_every_outcome() {
    let h = TestHome::new("wi7_s8");
    let _log = force_logger_on();
    let mut seen = Seen::default();

    // 1. on ok / off ok, from Running.
    seed_disk(&h.dir, true);
    let (dir, c) = seen.controller("s8-1");
    c.reconcile(true, plain()).await.expect("snapshot");
    seen.capture_token(&dir);
    for enabled in [false, true] {
        set(&c, enabled).await.expect("toggle ok");
        seen.toggled(enabled);
    }
    seen.capture_token(&dir);
    c.reconcile(false, plain()).await.expect("cleanup");

    // 2. bind in use.
    seed_disk(&h.dir, false);
    let (_held, p) = hold_port();
    let dir2 = temp_files_dir("s8-2");
    seen.dirs.push(dir2.clone());
    let c2 = McpController::new(test_env(&dir2, loopback(p)));
    set(&c2, true).await.expect("Ok with phase failed");
    seen.toggled(true);

    // 3. real persist failed (skipped as root).
    #[cfg(unix)]
    if !real_persist_failed(&h.dir, &mut seen).await {
        println!("S-8: scenario 3 skipped — this process can write into a 0o555 dir");
    }

    // 4. config unreadable.
    write_raw_config(&h.dir, "{ not json");
    let (dir4, c4) = seen.controller("s8-4");
    c4.reconcile(true, plain()).await.expect("snapshot");
    seen.capture_token(&dir4);
    let res = set(&c4, false).await;
    seen.toggled(false);
    assert_eq!(res.map(|_| ()), Err(McpSwitchError::ConfigUnreadable));
    c4.reconcile(false, plain()).await.expect("cleanup");

    // 5. exiting.
    seed_disk(&h.dir, false);
    let (_, c5) = seen.controller("s8-5");
    std::thread::scope(|s| {
        s.spawn(|| run_exit_cleanup(&c5));
    });
    let res = set(&c5, true).await;
    seen.toggled(true);
    assert_eq!(res.map(|_| ()), Err(McpSwitchError::Exiting));

    // 6. status unavailable.
    let (_, c6) = seen.controller("s8-6");
    c6.poison_snapshot_for_test();
    let res = set(&c6, true).await;
    seen.toggled(true);
    assert_eq!(res.map(|_| ()), Err(McpSwitchError::StatusUnavailable));

    // The log, as JSONL, toggle lines only.
    let text = fs::read_to_string(h.dir.join(".mdpro").join("mdpro.log")).expect("log exists");
    let lines: Vec<(&str, Value)> = text
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok().map(|v| (l, v)))
        .filter(|(_, v)| v["event"] == EVENT)
        .collect();

    // (a) one group per toggle, in call order, [start, success|fail].
    let mut groups: Vec<(String, Vec<&Value>)> = Vec::new();
    for (_, v) in &lines {
        let id = v["actionId"].as_str().expect("actionId is a string");
        match groups.iter_mut().find(|(g, _)| g == id) {
            Some((_, records)) => records.push(v),
            None => groups.push((id.to_string(), vec![v])),
        }
    }
    assert_eq!(groups.len(), seen.directions.len(), "groups vs toggles");

    let fixture: Value =
        serde_json::from_str(&fs::read_to_string(STATUS_FIXTURE).expect("fixture")).expect("JSON");
    let phases = fixture_list(&fixture, "phase");
    let mut errors = fixture_list(&fixture, "switchError");
    errors.extend(fixture_list(&fixture, "error"));
    let allowed_keys: BTreeSet<&str> = ["direction", "phase", "error"].into();

    for (i, ((_, records), direction)) in groups.iter().zip(&seen.directions).enumerate() {
        let statuses: Vec<&str> = records
            .iter()
            .map(|r| r["status"].as_str().expect("status"))
            .collect();
        assert!(
            statuses == ["start", "success"] || statuses == ["start", "fail"],
            "toggle {i}: statuses {statuses:?}"
        );
        for (j, r) in records.iter().enumerate() {
            let at = format!("toggle {i} line {j}");
            // (b) context keys, and duration on the terminal line only.
            let ctx = r["context"].as_object().expect("context is an object");
            for k in ctx.keys() {
                assert!(allowed_keys.contains(k.as_str()), "{at}: context key {k}");
            }
            let has_duration = r.get("durationMs").is_some_and(|d| !d.is_null());
            assert_eq!(has_duration, j == 1, "{at}: durationMs presence");
            // (c) closed domains.
            assert_eq!(ctx.get("direction"), Some(&Value::from(*direction)), "{at}");
            if let Some(e) = r.get("error").filter(|e| !e.is_null()) {
                let e = e.as_str().expect("error is a string");
                assert!(errors.contains(e), "{at}: top-level error {e:?}");
            }
            if let Some(ph) = ctx.get("phase") {
                assert!(phases.contains(ph.as_str().expect("phase")), "{at}: phase");
            }
            if let Some(e) = ctx.get("error") {
                assert!(errors.contains(e.as_str().expect("error")), "{at}: error");
            }
        }
    }

    // (d) no secret, path or OS text on any toggle line.
    let home = h.dir.to_string_lossy().to_string();
    for (n, (raw, _)) in lines.iter().enumerate() {
        for (t, token) in seen.tokens.iter().enumerate() {
            assert!(
                !raw.contains(token.as_str()),
                "line {n} contains token #{t}"
            );
        }
        for dir in &seen.dirs {
            assert!(
                !raw.contains(dir.to_string_lossy().as_ref()),
                "line {n}: files dir"
            );
        }
        assert!(
            !raw.contains(home.as_str()),
            "line {n} contains the HOME path"
        );
        for text in FORBIDDEN_TEXT {
            assert!(!raw.contains(text), "line {n} contains {text:?}");
        }
    }
    for dir in &seen.dirs {
        remove_test_dir(dir);
    }
}
