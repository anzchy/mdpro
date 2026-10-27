//! Purpose: the agent control channel (ADR-0047 WI-009), ported from
//! candidate B's spike (`79bde78a`). It exists only with the `control-channel`
//! feature, which implies `verify-run`, so a default build has none of it, and
//! it only ever runs inside a guarded verify run dir.
//!
//! Pipeline: `main()` → `plugin(&verified_run)`, registered after every other
//! plugin (single-instance stays first, item 11) → setup: `optin::read` → no
//! marker or a refused one: no socket, no `control.json` → otherwise mint the
//! token, bind `<run>/ctl.sock` (0600), write `control.json` → one thread per
//! connection: one request line, `server::serve_line`, one reply line. Page
//! loads and window closes feed `Generations`; `RunEvent::Exit` removes the
//! socket and `control.json`.
//!
//! Key decisions:
//! - `proto`: the request contract, with no I/O. `handoff`: the token,
//!   `control.json` and the socket, inside the verified run dir. `optin`:
//!   the launcher's marker, without which the channel stays closed.
//!   `server` / `dispatch`: the protocol over a `Host`; `TauriHost` below is
//!   the real one. `generation`: page readiness and reloads.
//! - A Unix socket in the private run dir, no TCP: Host and Origin do not apply
//!   (ADR-0047 decision 6).
//! - Logged: `control.listen` once (open, skipped or failed, with the reason),
//!   `control.reject` per refused request, `control.late_result_dropped`, and
//!   `control.close` at exit. An accepted command logs nothing, so a journey
//!   slice looks like a person's. The token never reaches the log.

pub mod dispatch;
pub mod generation;
pub mod handoff;
#[cfg(target_os = "macos")]
mod input_macos;
#[cfg(not(target_os = "macos"))]
mod input_other;
pub mod optin;
pub mod page;
pub mod proto;
pub mod server;

#[cfg(target_os = "macos")]
use input_macos as input;
#[cfg(not(target_os = "macos"))]
use input_other as input;

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::plugin::TauriPlugin;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, RunEvent, Runtime, WindowEvent, Wry};

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use crate::services::verify_run::VerifiedRun;
use generation::Generations;
use optin::OptIn;
use proto::Failure;
use server::{Channel, Host, Input, Script};

const REQUEST_MAX_BYTES: u64 = 64 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);

fn log(event: &str, status: LogStatus, level: LogLevel, context: Value) {
    logger::log_event(LogEntryPayload {
        level,
        event: event.to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error: None,
    });
}

/// The sink `server` logs through. A rejected request is a failure; the rest
/// are information.
fn sink(event: &str, context: Value) {
    let status = if event == "control.reject" {
        LogStatus::Fail
    } else {
        LogStatus::Success
    };
    log(event, status, LogLevel::Info, context);
}

/// The running app as the channel's host.
struct TauriHost<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriHost<R> {
    fn window(&self, label: &str) -> Result<tauri::WebviewWindow<R>, Failure> {
        self.app
            .get_webview_window(label)
            .ok_or_else(|| Failure::driver("window_closed", format!("no window labelled {label}")))
    }
}

impl<R: Runtime> Host for TauriHost<R> {
    fn labels(&self) -> Vec<String> {
        self.app.webview_windows().into_keys().collect()
    }

    fn has_window(&self, label: &str) -> bool {
        self.app.get_webview_window(label).is_some()
    }

    fn page(
        &self,
        label: &str,
        req_id: &str,
        script: Script<'_>,
        args: &Value,
        timeout: Duration,
    ) -> Result<Value, Failure> {
        let dropped = |count: u64| {
            sink(
                "control.late_result_dropped",
                json!({ "window": label, "count": count }),
            )
        };
        page::run(
            &self.window(label)?,
            req_id,
            script,
            args,
            timeout,
            &dropped,
        )
    }

    fn input(&self, label: &str, input: Input) -> Result<Value, Failure> {
        input::input(&self.window(label)?, input)
    }
}

/// Opens the channel in `run_dir` if the marker allows it, or logs why not.
fn open<R: Runtime>(app: AppHandle<R>, run_dir: &Path, gens: Arc<Generations>) {
    // SAFETY: getuid has no preconditions and cannot fail.
    let uid = unsafe { libc::getuid() };
    let eval = match optin::read(run_dir, uid) {
        OptIn::Open { eval } => eval,
        OptIn::Absent => return listen_closed(LogStatus::Cancel, "no_optin"),
        OptIn::Refused(reason) => return listen_closed(LogStatus::Fail, reason),
    };
    let socket = run_dir.join(handoff::SOCKET_FILE);
    if !handoff::socket_fits(&socket) {
        return listen_closed(LogStatus::Fail, "socket_path_too_long");
    }
    let token = handoff::new_token();
    let listener = match handoff::bind(&socket) {
        Ok(l) => l,
        Err(_) => return listen_closed(LogStatus::Fail, "bind"),
    };
    if handoff::write_handoff(&run_dir.join(handoff::HANDOFF_FILE), &socket, &token, eval).is_err()
    {
        return listen_closed(LogStatus::Fail, "handoff");
    }
    log(
        "control.listen",
        LogStatus::Success,
        LogLevel::Info,
        json!({ "socket": handoff::SOCKET_FILE, "eval": eval }),
    );
    let ch = Arc::new(Channel {
        host: TauriHost { app },
        token,
        eval,
        ids: proto::IdCache::default(),
        gens,
        log: Box::new(sink),
    });
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let ch = Arc::clone(&ch);
            std::thread::spawn(move || serve(&ch, stream));
        }
    });
}

fn listen_closed(status: LogStatus, reason: &str) {
    let level = if status == LogStatus::Fail {
        LogLevel::Error
    } else {
        LogLevel::Info
    };
    log("control.listen", status, level, json!({ "reason": reason }));
}

fn serve<H: Host>(ch: &Channel<H>, stream: UnixStream) {
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let mut line = String::new();
    let read = BufReader::new((&stream).take(REQUEST_MAX_BYTES)).read_line(&mut line);
    if read.is_err() || line.is_empty() {
        return;
    }
    let reply = server::serve_line(ch, &line);
    let mut out = &stream;
    let _ = out.write_all(format!("{reply}\n").as_bytes());
}

fn closed(run_dir: &Path) {
    handoff::remove_handoff(run_dir);
    log(
        "control.close",
        LogStatus::Success,
        LogLevel::Info,
        json!({ "socket": handoff::SOCKET_FILE }),
    );
}

/// The control-channel plugin for this verify run, ready to register last.
pub fn plugin(run: &VerifiedRun) -> TauriPlugin<Wry> {
    let run_dir: PathBuf = run.run_dir.clone();
    let exit_dir = run_dir.clone();
    let gens = Arc::new(Generations::default());
    let (on_load, on_close) = (Arc::clone(&gens), Arc::clone(&gens));
    tauri::plugin::Builder::new("mdpro-control")
        .js_init_script(page::INIT_SCRIPT)
        .setup(move |app, _api| {
            open(app.clone(), &run_dir, gens);
            Ok(())
        })
        .on_page_load(move |webview, payload| match payload.event() {
            PageLoadEvent::Started => on_load.started(webview.label()),
            PageLoadEvent::Finished => on_load.finished(webview.label()),
        })
        .on_event(move |_app, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } => on_close.closed(label),
            RunEvent::Exit => closed(&exit_dir),
            _ => {}
        })
        .build()
}
