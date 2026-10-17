//! Purpose: candidate B of ADR-0047's driver spike (WI-007): an in-repo
//! control channel. It exists only with the `control-channel` feature, which
//! implies `verify-run`, so a default build has none of it (S1.1), and it only
//! ever runs inside a guarded verify run dir.
//!
//! Pipeline: `main()` → `plugin(&verified_run)`, registered after every other
//! plugin (single-instance stays first, S4) → plugin setup mints a per-launch
//! token, binds `<run>/c.sock` (0600) and writes `control.json`
//! (`{socket, token, eval}`, `create_new`, 0600) → one thread per connection:
//! one JSON request line, `proto::admit`, `dispatch`, one reply line.
//!
//! Key decisions:
//! - A Unix socket in the private run dir, no TCP: Host and Origin do not apply
//!   (ADR-0047 decision 6). The path must fit `sun_path` (104 bytes); if it does
//!   not, the channel stays closed rather than move outside the run dir.
//! - Input is native (`input_macos`); reads are fixed page templates (`page`).
//!   `eval` is a command only when `MDPRO_CONTROL_EVAL=1` at launch (S1.3).
//! - Logged: `control.listen` once, `control.reject` per refused request. An
//!   accepted command logs nothing, so a journey slice looks like a person's.
//! - The token never reaches the log, stdout or an env var.

mod input_macos;
mod page;
mod proto;

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use rand::RngCore;
use serde_json::{json, Value};
use tauri::{plugin::TauriPlugin, AppHandle, Manager, Runtime, Wry};

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use crate::services::verify_run::VerifiedRun;
use proto::{Failure, Request};

const TOKEN_BYTES: usize = 32;
const EVAL_ENV: &str = "MDPRO_CONTROL_EVAL";
const HANDOFF_FILE: &str = "control.json";
const SOCKET_FILE: &str = "c.sock";
/// `sizeof(sockaddr_un.sun_path)` on macOS, including the terminating NUL.
const SUN_PATH_MAX: usize = 104;
const REQUEST_MAX_BYTES: u64 = 64 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);

struct Channel<R: Runtime> {
    app: AppHandle<R>,
    token: String,
    eval: bool,
    ids: proto::IdCache,
}

fn log(event: &str, status: LogStatus, level: LogLevel, context: Value, error: Option<String>) {
    logger::log_event(LogEntryPayload {
        level,
        event: event.to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error,
    });
}

fn listen_failed(reason: &str, error: Option<String>) {
    log(
        "control.listen",
        LogStatus::Fail,
        LogLevel::Error,
        json!({ "reason": reason }),
        error,
    );
}

fn new_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn write_handoff(path: &Path, socket: &Path, token: &str, eval: bool) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(
        json!({ "socket": socket, "token": token, "eval": eval })
            .to_string()
            .as_bytes(),
    )?;
    f.sync_all()
}

fn bind(socket: &Path) -> std::io::Result<UnixListener> {
    let listener = UnixListener::bind(socket)?;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// Opens the channel in `run_dir`, or logs why not and leaves it closed.
fn open<R: Runtime>(app: AppHandle<R>, run_dir: &Path) {
    let socket = run_dir.join(SOCKET_FILE);
    if socket.as_os_str().len() >= SUN_PATH_MAX {
        return listen_failed("socket_path_too_long", None);
    }
    let eval = std::env::var(EVAL_ENV).as_deref() == Ok("1");
    let token = new_token();
    let listener = match bind(&socket) {
        Ok(l) => l,
        Err(e) => return listen_failed("bind", Some(e.to_string())),
    };
    if let Err(e) = write_handoff(&run_dir.join(HANDOFF_FILE), &socket, &token, eval) {
        return listen_failed("handoff", Some(e.to_string()));
    }
    log(
        "control.listen",
        LogStatus::Success,
        LogLevel::Info,
        json!({ "socket": SOCKET_FILE, "eval": eval }),
        None,
    );
    let ch = Arc::new(Channel {
        app,
        token,
        eval,
        ids: proto::IdCache::default(),
    });
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let ch = Arc::clone(&ch);
            std::thread::spawn(move || serve(&ch, stream));
        }
    });
}

fn serve<R: Runtime>(ch: &Channel<R>, stream: UnixStream) {
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let mut line = String::new();
    let read = BufReader::new((&stream).take(REQUEST_MAX_BYTES)).read_line(&mut line);
    if read.is_err() || line.is_empty() {
        return;
    }
    let reply = match proto::parse(&line) {
        Err(f) => proto::reply_err("", &f),
        Ok(req) => match proto::admit(&req, &ch.token, &ch.ids) {
            Err(f) => {
                log(
                    "control.reject",
                    LogStatus::Fail,
                    LogLevel::Info,
                    json!({ "reason": f.code }),
                    None,
                );
                proto::reply_err(&req.id, &f)
            }
            Ok(()) => match dispatch(ch, &req) {
                Ok(v) => proto::reply_ok(&req.id, v),
                Err(f) => proto::reply_err(&req.id, &f),
            },
        },
    };
    let mut out = &stream;
    let _ = out.write_all(format!("{reply}\n").as_bytes());
}

fn arg_str<'a>(req: &'a Request, key: &str) -> Result<&'a str, Failure> {
    req.args
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| Failure::new("bad_request", format!("args.{key} is required")))
}

fn dispatch<R: Runtime>(ch: &Channel<R>, req: &Request) -> Result<Value, Failure> {
    if req.cmd == "ping" {
        return Ok(json!("pong"));
    }
    if req.cmd == "windows" {
        let mut labels: Vec<String> = ch.app.webview_windows().into_keys().collect();
        labels.sort();
        return Ok(json!(labels));
    }
    let win = ch.app.get_webview_window(&req.window).ok_or_else(|| {
        Failure::new(
            "no_such_window",
            format!("no window labelled {}", req.window),
        )
    })?;
    let timeout = Duration::from_millis(req.timeout_ms());
    match req.cmd.as_str() {
        "find" => page::run(&win, &req.id, page::Script::Find, &req.args, timeout),
        "count" => page::run(&win, &req.id, page::Script::Count, &req.args, timeout),
        "probe" => page::run(&win, &req.id, page::Script::Probe, &req.args, timeout),
        "eval" if !ch.eval => Err(Failure::new("eval_disabled", "eval is off for this run")),
        "eval" => {
            let args = req.args.get("args").cloned().unwrap_or(Value::Null);
            page::run(
                &win,
                &req.id,
                page::Script::Eval(arg_str(req, "script")?),
                &args,
                timeout,
            )
        }
        "activate" => input_macos::activate(&win).map(|key| json!({ "key": key })),
        "key" => {
            let mods: Vec<String> =
                serde_json::from_value(req.args.get("mods").cloned().unwrap_or(json!([])))
                    .map_err(|_| Failure::new("bad_request", "args.mods is a list of names"))?;
            let times = req
                .args
                .get("repeat")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 200) as usize;
            let p =
                input_macos::press(arg_str(req, "key")?, input_macos::mod_flags(&mods)?, times)?;
            input_macos::keys(&win, vec![p]).map(|()| json!(true))
        }
        "type" => input_macos::keys(&win, input_macos::text_presses(arg_str(req, "text")?)?)
            .map(|()| json!(true)),
        "click" => click(&win, req, timeout),
        _ => Err(Failure::new(
            "unknown_command",
            format!("no command {}", req.cmd),
        )),
    }
}

/// `click {x, y}` in CSS px, or `click {using, value, index?, at?: "center"|"end"}`.
fn click<R: Runtime>(
    win: &tauri::WebviewWindow<R>,
    req: &Request,
    timeout: Duration,
) -> Result<Value, Failure> {
    let (x, y) = match (
        req.args.get("x").and_then(Value::as_f64),
        req.args.get("y").and_then(Value::as_f64),
    ) {
        (Some(x), Some(y)) => (x, y),
        _ => {
            let found = page::run(win, &req.id, page::Script::Find, &req.args, timeout)?;
            if found["found"] != json!(true) {
                return Err(Failure::new("no_such_element", "no element matches"));
            }
            let r = &found["rect"];
            let (rx, ry, rw, rh) = (num(&r["x"]), num(&r["y"]), num(&r["w"]), num(&r["h"]));
            let at_end = req.args.get("at").and_then(Value::as_str) == Some("end");
            (
                if at_end { rx + rw - 2.0 } else { rx + rw / 2.0 },
                ry + rh / 2.0,
            )
        }
    };
    input_macos::click(win, x, y).map(|(wx, wy)| json!({ "css": [x, y], "window": [wx, wy] }))
}

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}

/// The control-channel plugin for this verify run, ready to register last.
pub fn plugin(run: &VerifiedRun) -> TauriPlugin<Wry> {
    let run_dir = run.run_dir.clone();
    tauri::plugin::Builder::new("mdpro-control")
        .setup(move |app, _api| {
            open(app.clone(), &run_dir);
            Ok(())
        })
        .build()
}
