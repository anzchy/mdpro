//! Purpose: the agent control channel for ADR-0047 WI-006's spike
//! (candidate A, `tauri-plugin-wdio-webdriver`, vendored and patched).
//! Exists only with the `control-channel` feature, which implies
//! `verify-run`: a default build has neither this module nor the crate (S1.1),
//! and the channel only ever runs inside a guarded verify run dir.
//!
//! Pipeline: `main()` → `plugin(&verified_run)` before the builder → a
//! per-launch token from the OS RNG → the plugin binds 127.0.0.1:0 →
//! `on_listen` writes `control.json` (`{port, token, eval}`, created
//! exclusively, mode 0600) into the run dir and logs `control.listen`.
//!
//! Key decisions:
//! - The token never reaches the log, stdout or an env var; only the 0600 file
//!   in the private run dir carries it.
//! - `MDPRO_CONTROL_EVAL=1` registers the script routes; anything else leaves
//!   them unregistered (S1.3).
//! - A bind failure is logged (`control.listen` fail); the app keeps running
//!   without a channel, and the launcher sees no `control.json`.

use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

use rand::RngCore;
use serde_json::json;
use tauri::{plugin::TauriPlugin, Wry};

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use crate::services::verify_run::VerifiedRun;

const TOKEN_BYTES: usize = 32;
const EVAL_ENV: &str = "MDPRO_CONTROL_EVAL";
const HANDOFF_FILE: &str = "control.json";

fn new_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn log(status: LogStatus, level: LogLevel, context: serde_json::Value, error: Option<String>) {
    logger::log_event(LogEntryPayload {
        level,
        event: "control.listen".to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error,
    });
}

fn write_handoff(path: &PathBuf, port: u16, token: &str, eval: bool) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(
        json!({ "port": port, "token": token, "eval": eval })
            .to_string()
            .as_bytes(),
    )?;
    f.sync_all()
}

/// The control-channel plugin for this verify run, ready to register.
pub fn plugin(run: &VerifiedRun) -> TauriPlugin<Wry> {
    let token = new_token();
    let allow_eval = std::env::var(EVAL_ENV).as_deref() == Ok("1");
    let handoff = run.run_dir.join(HANDOFF_FILE);
    let handoff_token = token.clone();
    let on_listen: tauri_plugin_wdio_webdriver::OnListen = Box::new(move |r| match r {
        Ok(addr) => match write_handoff(&handoff, addr.port(), &handoff_token, allow_eval) {
            Ok(()) => log(
                LogStatus::Success,
                LogLevel::Info,
                json!({ "port": addr.port(), "eval": allow_eval }),
                None,
            ),
            Err(e) => log(
                LogStatus::Fail,
                LogLevel::Error,
                json!({ "stage": "handoff" }),
                Some(e.to_string()),
            ),
        },
        Err(e) => log(
            LogStatus::Fail,
            LogLevel::Error,
            json!({ "stage": "listen" }),
            Some(e),
        ),
    });
    tauri_plugin_wdio_webdriver::init(tauri_plugin_wdio_webdriver::Config {
        port: 0,
        token,
        allow_eval,
        on_listen,
    })
}
