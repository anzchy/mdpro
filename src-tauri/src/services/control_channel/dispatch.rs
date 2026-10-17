//! Purpose: runs one admitted control-channel request against a `Host`
//! (ADR-0047 WI-009 WI 4, from candidate B's spike).
//!
//! Key decisions:
//! - Every command on a window runs between `Generations::begin` and `end`:
//!   a page still loading, a reload or a close is a driver failure, and a
//!   page result from a page that has since reloaded is discarded (items 7,
//!   20). For an input command the event may already have landed, so its
//!   outcome is unknown.
//! - `eval` is a command only when the launch marker enabled it (items 5, 15).
//! - Key, modifier and text values are checked by the platform's key table;
//!   here only their shape.

use std::time::Duration;

use serde_json::{json, Value};

use super::proto::{self, Failure, Request};
use super::server::{Channel, Host, Input, Script};

const MAX_REPEAT: u64 = 200;

fn arg_str<'a>(req: &'a Request, key: &str) -> Result<&'a str, Failure> {
    req.args
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| Failure::new("bad_request", format!("args.{key} is required")))
}

pub fn dispatch<H: Host>(ch: &Channel<H>, req: &Request) -> Result<Value, Failure> {
    match req.cmd.as_str() {
        "ping" => return Ok(json!("pong")),
        "windows" => {
            let mut labels = ch.host.labels();
            labels.sort();
            return Ok(json!(labels));
        }
        "eval" if !ch.eval => {
            return Err(Failure::new("eval_disabled", "eval is off for this run"))
        }
        _ => {}
    }
    if !ch.host.has_window(&req.window) {
        return Err(Failure::new(
            "no_such_window",
            format!("no window labelled {}", req.window),
        ));
    }
    let generation = ch.gens.begin(&req.window)?;
    let result = on_window(ch, req);
    match ch.gens.end(&req.window, generation) {
        Ok(()) => result,
        Err(f) if proto::is_mutating(&req.cmd) => Err(f.outcome_unknown()),
        Err(f) => Err(f),
    }
}

fn on_window<H: Host>(ch: &Channel<H>, req: &Request) -> Result<Value, Failure> {
    let timeout = Duration::from_millis(req.timeout_ms());
    let page = |script: Script<'_>, args: &Value| {
        ch.host.page(&req.window, &req.id, script, args, timeout)
    };
    let input = |i: Input| ch.host.input(&req.window, i);
    match req.cmd.as_str() {
        "find" => page(Script::Find, &req.args),
        "count" => page(Script::Count, &req.args),
        "probe" => page(Script::Probe, &req.args),
        "eval" => {
            let args = req.args.get("args").cloned().unwrap_or(Value::Null);
            page(Script::Eval(arg_str(req, "script")?), &args)
        }
        "activate" => input(Input::Activate),
        "key" => input(key(req)?),
        "type" => input(Input::Text(arg_str(req, "text")?.to_string())),
        "click" => {
            let (x, y) = click_point(req, |a| page(Script::Find, a))?;
            input(Input::Click { x, y })
        }
        _ => Err(Failure::new(
            "unknown_command",
            format!("no command {}", req.cmd),
        )),
    }
}

fn key(req: &Request) -> Result<Input, Failure> {
    let mods: Vec<String> =
        serde_json::from_value(req.args.get("mods").cloned().unwrap_or(json!([])))
            .map_err(|_| Failure::new("bad_request", "args.mods is a list of names"))?;
    let repeat = req
        .args
        .get("repeat")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, MAX_REPEAT) as usize;
    Ok(Input::Key {
        key: arg_str(req, "key")?.to_string(),
        mods,
        repeat,
    })
}

/// `click {x, y}` in CSS px, or `click {using, value, index?, at?: "center"|"end"}`.
fn click_point(
    req: &Request,
    find: impl Fn(&Value) -> Result<Value, Failure>,
) -> Result<(f64, f64), Failure> {
    let num = |v: &Value| v.as_f64().unwrap_or(0.0);
    if let (Some(x), Some(y)) = (
        req.args.get("x").and_then(Value::as_f64),
        req.args.get("y").and_then(Value::as_f64),
    ) {
        return Ok((x, y));
    }
    let found = find(&req.args)?;
    if found["found"] != json!(true) {
        return Err(Failure::new("no_such_element", "no element matches"));
    }
    let r = &found["rect"];
    let (rx, ry, rw, rh) = (num(&r["x"]), num(&r["y"]), num(&r["w"]), num(&r["h"]));
    let at_end = req.args.get("at").and_then(Value::as_str) == Some("end");
    Ok((
        if at_end { rx + rw - 2.0 } else { rx + rw / 2.0 },
        ry + rh / 2.0,
    ))
}
