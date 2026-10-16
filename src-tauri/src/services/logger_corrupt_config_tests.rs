//! D25 issue 2 — a corrupt `config.json` at launch: the MCP server starts,
//! the status reports `unreadable`, and the file log stays silent.
//!
//! This pins a **deliberate fail-closed choice** (ADR-0042 decision 6, which
//! amends ADR-0040 decision 6): logging stays off when the user's logging
//! choice cannot be read, even though the MCP launch gate fails *open*
//! (ADR-0039) over the same file. The two disagree on purpose, so the cost
//! ADR-0042 records — "a launch with a corrupt config leaves no file-log
//! trace" — is real behaviour, not a bug. Changing any one leg (making the
//! log fail open, or the launch fail closed) means revisiting that ADR first.
//!
//! Lives under `logger` so it can reach `resolve_initial_settings`: the
//! settings cache is a process-wide `OnceLock` that cannot be re-initialised
//! from a test, so the logger leg feeds the real `load_preferences()` result
//! through the same decision `settings_cache` makes, then installs it.
//! Real filesystem under `TestHome` (temp `$HOME`, `HOME_LOCK`), real
//! controller, real loopback bind; nothing mocked, the real `~/.mdpro` is
//! never touched.

use super::*;
use crate::services::mcp_controller::controller::McpController;
use crate::services::mcp_controller::launch::launch;
use crate::services::mcp_controller::snapshot::McpPhase;
use crate::services::mcp_controller::test_routers::plain;
use crate::services::mcp_controller::test_support::{
    remove_test_dir, temp_files_dir, test_env0, GENEROUS,
};
use crate::services::mcp_launch::{
    current_status, decide_mcp_launch, read_server_enabled, McpConfigReadError, McpConfigured,
    McpLaunchDecision, StartReason,
};
use crate::services::window_restore::test_home::{read_config_bytes, write_raw_config, TestHome};
use std::sync::Arc;
use tokio::time::timeout;

/// Restores the process-wide log settings on drop.
struct RestoreLogSettings(LogSettings);
impl Drop for RestoreLogSettings {
    fn drop(&mut self) {
        set_log_settings(self.0.clone());
    }
}

/// One corrupt-config fixture drives all three legs.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn d25_issue2_corrupt_config_starts_mcp_reports_unreadable_and_logs_nothing() {
    let h = TestHome::new("d25_issue2_corrupt_config");
    let before = write_raw_config(&h.dir, "{ not valid json");
    let log_file = h.dir.join(".mdpro").join("mdpro.log");
    assert!(!log_file.exists(), "precondition: no log file yet");

    // (c) logger: the settings the launch-time cache would resolve to.
    let loaded = read_initial_logging();
    assert!(
        loaded.is_none(),
        "precondition: load_preferences must fail on the corrupt fixture"
    );
    let effective = resolve_initial_settings(loaded);
    assert!(
        !effective.enabled,
        "a corrupt config must leave logging disabled (ADR-0042 decision 6)"
    );
    let _restore = RestoreLogSettings(get_log_settings());
    set_log_settings(effective);
    for level in [
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ] {
        assert!(!should_log(level), "should_log({level:?}) must be false");
    }

    // (a) launch: fail-open, and the server actually reaches Running.
    let decision = decide_mcp_launch(read_server_enabled());
    assert_eq!(
        decision,
        McpLaunchDecision::Start(StartReason::ConfigUnreadable(McpConfigReadError::Parse)),
        "a corrupt config must start the server (ADR-0039 fail-open)"
    );
    let files_dir = temp_files_dir("d25-issue2");
    let controller = Arc::new(McpController::new(test_env0(&files_dir)));
    timeout(GENEROUS, launch(controller.clone(), decision, plain()))
        .await
        .expect("launch hung")
        .expect("launch task");
    let snap = controller.snapshot().expect("snapshot");

    // (b) status: what `mcp_get_status` returns.
    let status = current_status(&controller, "b".into()).expect("status is Ok");

    timeout(GENEROUS, controller.stop())
        .await
        .expect("stop hung")
        .expect("stop snapshot");
    remove_test_dir(&files_dir);

    assert_eq!(
        snap.phase,
        McpPhase::Running,
        "server did not start: {snap:?}"
    );
    assert!(snap.port.is_some(), "no port bound: {snap:?}");
    assert_eq!(status.configured, McpConfigured::Unreadable);
    assert!(status.running, "status must report the running server");

    // (c) continued: the launch emitted its fail-open and post-start lines,
    // and none of them reached the file.
    assert!(
        !log_file.exists(),
        "the file log was written despite fail-closed logging: {:?}",
        std::fs::read_to_string(&log_file)
    );
    assert_eq!(
        read_config_bytes(&h.dir),
        before,
        "nothing may repair the corrupt config"
    );
}
