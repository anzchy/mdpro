//! ADR-0047 WI-009 WI 4: one request line in, one reply out, over a fake
//! host (plan WI-009 items 3, 5, 6, 7, 13, 20).
use super::*;
use std::process::Command;
use std::sync::{Arc, Mutex};

const TOKEN: &str = "t0ken-of-this-launch";

/// What the fake host saw, and what it answers.
#[allow(clippy::type_complexity)] // the side-effect hook below
#[derive(Default)]
struct Seen {
    calls: Vec<String>,
    labels: Option<Vec<String>>,
    probe_args: Option<Value>,
    run_probe: bool,
    /// Run during a page or input call, to simulate a reload or close.
    during: Option<Box<dyn Fn(&Generations) + Send>>,
    find: Option<Value>,
}

struct FakeHost {
    seen: Arc<Mutex<Seen>>,
    gens: Arc<Generations>,
}

impl FakeHost {
    fn side_effect(&self) {
        if let Some(f) = self.seen.lock().unwrap().during.as_ref() {
            f(&self.gens);
        }
    }
}

impl Host for FakeHost {
    fn labels(&self) -> Vec<String> {
        self.seen
            .lock()
            .unwrap()
            .labels
            .clone()
            .unwrap_or_else(|| vec!["main".into(), "doc-2".into()])
    }
    fn has_window(&self, label: &str) -> bool {
        label == "main" || label == "doc-2"
    }
    fn page(
        &self,
        label: &str,
        _req_id: &str,
        script: Script<'_>,
        args: &Value,
        _timeout: Duration,
    ) -> Result<Value, Failure> {
        let name = match script {
            Script::Find => "find".to_string(),
            Script::Count => "count".to_string(),
            Script::Probe => "probe".to_string(),
            Script::Eval(src) => format!("eval:{src}"),
        };
        {
            let mut seen = self.seen.lock().unwrap();
            seen.calls.push(format!("page {label} {name}"));
            if name == "probe" {
                seen.probe_args = Some(args.clone());
            }
        }
        self.side_effect();
        if name == "probe" && self.seen.lock().unwrap().run_probe {
            let id = json!("host-probe").to_string();
            let starter = super::super::page::starter(
                &id,
                &super::super::page::body(&Script::Probe),
                &args.to_string(),
            );
            let harness = format!(
                "globalThis.window=globalThis;globalThis.document={{querySelector:()=>null,querySelectorAll:()=>[]}};{starter};setTimeout(()=>console.log(JSON.stringify(window.__mdproCtl[{id}].v)),0);"
            );
            let output = Command::new("node")
                .arg("-e")
                .arg(harness)
                .output()
                .expect("execute probe");
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            return Ok(serde_json::from_slice(&output.stdout).expect("probe JSON"));
        }
        if name == "find" {
            return Ok(self
                .seen
                .lock()
                .unwrap()
                .find
                .clone()
                .unwrap_or(json!({ "found": false })));
        }
        Ok(json!({ "from": name }))
    }
    fn input(&self, label: &str, input: Input) -> Result<Value, Failure> {
        self.seen
            .lock()
            .unwrap()
            .calls
            .push(format!("input {label} {input:?}"));
        self.side_effect();
        Ok(json!(true))
    }
}

struct Rig {
    ch: Channel<FakeHost>,
    seen: Arc<Mutex<Seen>>,
    logs: Arc<Mutex<Vec<(String, Value)>>>,
}

fn rig(eval: bool) -> Rig {
    let gens = Arc::new(Generations::default());
    gens.started("main");
    gens.finished("main");
    let seen = Arc::new(Mutex::new(Seen::default()));
    let logs = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&logs);
    let ch = Channel {
        host: FakeHost {
            seen: Arc::clone(&seen),
            gens: Arc::clone(&gens),
        },
        token: TOKEN.into(),
        eval,
        ids: IdCache::default(),
        gens,
        log: Box::new(move |event: &str, ctx: Value| {
            sink.lock().unwrap().push((event.to_string(), ctx));
        }),
    };
    Rig { ch, seen, logs }
}

fn send(r: &Rig, id: &str, cmd: &str, args: Value) -> Value {
    let line = json!({ "token": TOKEN, "id": id, "cmd": cmd, "args": args }).to_string();
    serve_line(&r.ch, &line)
}

fn send_to(r: &Rig, window: &str, id: &str, cmd: &str) -> Value {
    let line = json!({ "token": TOKEN, "id": id, "cmd": cmd, "window": window }).to_string();
    serve_line(&r.ch, &line)
}

fn calls(r: &Rig) -> Vec<String> {
    r.seen.lock().unwrap().calls.clone()
}

fn code(v: &Value) -> &str {
    v["error"]["code"].as_str().unwrap_or("")
}

#[test]
fn ping_answers_pong() {
    let r = rig(false);
    assert_eq!(
        send(&r, "p1", "ping", json!({})),
        json!({ "id": "p1", "ok": true, "value": "pong" })
    );
}

#[test]
fn a_wrong_token_is_refused_and_logged_without_any_token() {
    let r = rig(false);
    let line = json!({ "token": "guess", "id": "a1", "cmd": "ping" }).to_string();
    let v = serve_line(&r.ch, &line);
    assert_eq!(code(&v), "unauthorized");
    let logs = r.logs.lock().unwrap().clone();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].0, "control.reject");
    assert_eq!(logs[0].1["reason"], json!("unauthorized"));
    let all = format!("{logs:?}{v}");
    assert!(!all.contains(TOKEN) && !all.contains("guess"));
}

#[test]
fn a_line_that_is_not_json_gets_bad_request_with_an_empty_id() {
    let r = rig(false);
    let v = serve_line(&r.ch, "{not json");
    assert_eq!(code(&v), "bad_request");
    assert_eq!(v["id"], json!(""));
}

#[test]
fn windows_lists_the_labels_sorted() {
    let r = rig(false);
    assert_eq!(
        send(&r, "w1", "windows", json!({}))["value"],
        json!(["doc-2", "main"])
    );
}

#[test]
fn an_unknown_window_is_refused_before_anything_runs() {
    let r = rig(false);
    assert_eq!(code(&send_to(&r, "nope", "p1", "probe")), "no_such_window");
    assert!(calls(&r).is_empty());
}

#[test]
fn a_page_command_on_a_page_not_ready_is_a_driver_failure() {
    let r = rig(false);
    let v = send_to(&r, "doc-2", "p1", "probe");
    assert_eq!(code(&v), "page_not_ready");
    assert_eq!(v["error"]["class"], json!("driver_failure"));
    assert!(calls(&r).is_empty());
}

#[test]
fn a_probe_on_a_ready_page_returns_its_value() {
    let r = rig(false);
    let v = send(&r, "p1", "probe", json!({ "kind": "focus" }));
    assert_eq!(v["value"], json!({ "from": "probe" }));
    assert_eq!(calls(&r), vec!["page main probe"]);
}

#[test]
fn probe_passes_sorted_host_labels_and_an_empty_boundary_to_the_page() {
    let r = rig(false);
    r.seen.lock().unwrap().labels = Some(vec!["zeta".into(), "main".into()]);
    assert_eq!(
        send(&r, "labels-1", "probe", json!({ "kind": "focus" }))["ok"],
        json!(true)
    );
    assert_eq!(
        r.seen.lock().unwrap().probe_args,
        Some(json!({ "kind": "focus", "windowLabels": ["main", "zeta"] }))
    );

    r.seen.lock().unwrap().labels = Some(vec![]);
    assert_eq!(send(&r, "labels-2", "probe", json!({}))["ok"], json!(true));
    assert_eq!(
        r.seen.lock().unwrap().probe_args,
        Some(json!({ "kind": null, "windowLabels": [] }))
    );

    r.seen.lock().unwrap().run_probe = true;
    r.seen.lock().unwrap().labels = Some(vec!["zeta".into(), "main".into()]);
    assert_eq!(
        send(&r, "labels-3", "probe", json!({}))["value"]["windowLabels"],
        json!(["main", "zeta"])
    );
    r.seen.lock().unwrap().labels = Some(vec![]);
    assert_eq!(
        send(&r, "labels-4", "probe", json!({}))["value"]["windowLabels"],
        json!([])
    );
}

#[test]
fn a_reload_during_a_page_command_discards_its_result() {
    let r = rig(false);
    r.seen.lock().unwrap().during = Some(Box::new(|g: &Generations| g.started("main")));
    let v = send(&r, "p1", "probe", json!({}));
    assert_eq!(code(&v), "window_reloaded");
    assert_eq!(v["error"]["class"], json!("driver_failure"));
    assert!(v.get("value").is_none());
}

#[test]
fn a_reload_during_input_leaves_the_outcome_unknown() {
    let r = rig(false);
    r.seen.lock().unwrap().during = Some(Box::new(|g: &Generations| g.started("main")));
    let v = send(&r, "k1", "key", json!({ "key": "Escape" }));
    assert_eq!(code(&v), "window_reloaded");
    assert_eq!(v["outcome"], json!("unknown"));
}

#[test]
fn eval_is_refused_unless_the_marker_enabled_it() {
    let r = rig(false);
    assert_eq!(
        code(&send(&r, "e1", "eval", json!({ "script": "return 1" }))),
        "eval_disabled"
    );
    assert!(calls(&r).is_empty());
    let r = rig(true);
    assert_eq!(
        send(&r, "e1", "eval", json!({ "script": "return 1" }))["value"],
        json!({ "from": "eval:return 1" })
    );
    assert_eq!(code(&send(&r, "e2", "eval", json!({}))), "bad_request");
}

#[test]
fn key_passes_name_mods_and_a_clamped_repeat() {
    let r = rig(false);
    send(
        &r,
        "k1",
        "key",
        json!({ "key": "ArrowLeft", "mods": ["shift"], "repeat": 999 }),
    );
    send(&r, "k2", "key", json!({ "key": "Escape" }));
    assert_eq!(
        calls(&r),
        vec![
            r#"input main Key { key: "ArrowLeft", mods: ["shift"], repeat: 200 }"#,
            r#"input main Key { key: "Escape", mods: [], repeat: 1 }"#,
        ]
    );
    assert_eq!(
        code(&send(
            &r,
            "k3",
            "key",
            json!({ "key": "a", "mods": "shift" })
        )),
        "bad_request"
    );
    assert_eq!(code(&send(&r, "k4", "key", json!({}))), "bad_request");
}

#[test]
fn type_and_activate_reach_the_host() {
    let r = rig(false);
    send(&r, "t1", "type", json!({ "text": "x" }));
    send(&r, "a1", "activate", json!({}));
    assert_eq!(
        calls(&r),
        vec![r#"input main Text("x")"#, "input main Activate"]
    );
    assert_eq!(code(&send(&r, "t2", "type", json!({}))), "bad_request");
}

#[test]
fn click_by_point_or_by_element() {
    let r = rig(false);
    send(&r, "c1", "click", json!({ "x": 10.0, "y": 20.0 }));
    r.seen.lock().unwrap().find =
        Some(json!({ "found": true, "rect": { "x": 100.0, "y": 50.0, "w": 40.0, "h": 10.0 } }));
    send(
        &r,
        "c2",
        "click",
        json!({ "using": "css", "value": "button" }),
    );
    send(
        &r,
        "c3",
        "click",
        json!({ "using": "css", "value": "button", "at": "end" }),
    );
    assert_eq!(
        calls(&r),
        vec![
            "input main Click { x: 10.0, y: 20.0 }",
            "page main find",
            "input main Click { x: 120.0, y: 55.0 }",
            "page main find",
            "input main Click { x: 138.0, y: 55.0 }",
        ]
    );
}

#[test]
fn clicking_a_missing_element_is_no_such_element() {
    let r = rig(false);
    assert_eq!(
        code(&send(
            &r,
            "c1",
            "click",
            json!({ "using": "css", "value": "x" })
        )),
        "no_such_element"
    );
}

#[test]
fn a_repeated_input_id_does_not_run_twice() {
    let r = rig(false);
    send(&r, "k1", "key", json!({ "key": "Escape" }));
    assert_eq!(
        code(&send(&r, "k1", "key", json!({ "key": "Escape" }))),
        "duplicate"
    );
    assert_eq!(calls(&r).len(), 1);
}

#[test]
fn an_unknown_command_is_named() {
    let r = rig(false);
    assert_eq!(code(&send(&r, "u1", "fly", json!({}))), "unknown_command");
}

#[test]
fn no_reply_carries_the_token() {
    let r = rig(true);
    for (id, cmd) in [
        ("a", "ping"),
        ("b", "windows"),
        ("c", "probe"),
        ("d", "fly"),
    ] {
        assert!(!send(&r, id, cmd, json!({})).to_string().contains(TOKEN));
    }
}
