//! D279-WI-3 source pins: the external-open glue resolves its target from
//! `MenuFocus` once (GL-1), looks the window up before it sends, so a gone
//! window is an `Err` (GL-2), sends to the very label it looked up (GL-3),
//! and no non-test file under `src-tauri/src` emits `file:open` to every
//! window (EP-L9).
//!
//! Cases GL-1, GL-2, GL-3 and EP-L9 of
//! `.claude/tdd-guardian/tests-20261018-100701.md`.
//!
//! **Below Level 6: source-text inspection, a supplement only.** The crate
//! has no `tauri::test` feature, so no lane cheaper than the device observes
//! a real `emit_to`. The real checks are device items D279-a and D279-b. The
//! needles live in consts, so a rename is a one-line edit with a stated
//! reason. No `regex` dependency: the matching is hand-rolled below.

const GLUE_REL: &str = "src/services/open_route/tauri_glue.rs";
const WINDOW_REL: &str = "src/commands/window.rs";
/// The event name, as it appears quoted in the source.
const FILE_OPEN: &str = concat!("\"", "file:open", "\"");
/// The global emit EP-L9 forbids (built so this file cannot match itself).
const GLOBAL_EMIT: &str = concat!("emit(", "\"file:open\"");
const LOOKUP: &str = "get_webview_window(";
const SEND: &str = "emit_to(";

fn raw(rel: &str) -> String {
    let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path} unreadable: {e}"))
}

/// Drop whole-line `//` comments, then collapse whitespace so rustfmt
/// wrapping does not change what is seen (a wrapped `( ` folds to `(`).
fn norm(src: &str) -> String {
    src.lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace("( ", "(")
}

/// The body of the top-level `fn name(` up to its column-0 `}`, normalised.
fn fn_body(src: &str, name: &str) -> String {
    let marker = format!("fn {name}(");
    let from = src.find(&marker).unwrap_or_else(|| panic!("no `{marker}`"));
    let len = src[from..]
        .find("\n}")
        .unwrap_or_else(|| panic!("`{marker}` has no closing brace at column 0"));
    norm(&src[from..from + len])
}

/// Byte index just past the string literal whose opening `"` is at `at`.
fn str_end(s: &str, at: usize) -> Option<usize> {
    let mut escaped = false;
    for (i, c) in s[at + 1..].char_indices() {
        match (escaped, c) {
            (true, _) => escaped = false,
            (false, '\\') => escaped = true,
            (false, '"') => return Some(at + 1 + i + 1),
            _ => {}
        }
    }
    None
}

/// Byte index of the delimiter that closes the bracket opened just before
/// `from` (string-literal aware), i.e. the end of an argument list.
fn close_of(s: &str, from: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut i = from;
    while i < s.len() {
        match bytes[i] {
            b'"' => {
                i = str_end(s, i)?;
                continue;
            }
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' if depth == 0 => return Some(i),
            b')' | b']' | b'}' => depth -= 1,
            _ => {}
        }
        i += 1;
    }
    None
}

/// The top-level arguments of the call whose `(` ends at `open_end`. A
/// closure's `|a: A, b: B|` parameter list is kept whole. `None` when the
/// call does not close.
fn call_args(s: &str, open_end: usize) -> Option<Vec<String>> {
    let close = close_of(s, open_end)?;
    let inner = &s[open_end..close];
    let bytes = inner.as_bytes();
    let mut args = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < inner.len() {
        // Skip a closure parameter list at the start of an argument.
        let arg_head = inner[start..i].trim();
        if bytes[i] == b'|' && (arg_head.is_empty() || arg_head == "move") {
            i += inner[i + 1..].find('|')? + 2;
            continue;
        }
        match bytes[i] {
            b'"' => {
                i = str_end(inner, i)?;
                continue;
            }
            b'(' | b'[' | b'{' => {
                i = close_of(inner, i + 1)? + 1;
                continue;
            }
            b',' => {
                args.push(inner[start..i].trim().to_string());
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    let tail = inner[start..].trim();
    if !tail.is_empty() {
        args.push(tail.to_string());
    }
    Some(args)
}

/// Every `emit_to(` in `s` whose second argument is `"file:open"`, as
/// `(byte index of emit_to, first argument)`.
fn addressed_file_open_sends(s: &str) -> Vec<(usize, String)> {
    s.match_indices(SEND)
        .filter_map(|(at, _)| {
            let args = call_args(s, at + SEND.len())?;
            (args.len() >= 2 && args[1] == FILE_OPEN).then(|| (at, args[0].clone()))
        })
        .collect()
}

fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// The send region and its parameter list (without delimiters, as
/// `a: A, b: B`) the label must come from: the
/// `execute_plan` argument that carries the `file:open` send, or, when that
/// closure only calls a helper, the helper fn named in it.
fn send_region(glue: &str) -> (String, String) {
    let body = fn_body(glue, "route_external_open");
    let call = body
        .find("execute_plan(")
        .unwrap_or_else(|| panic!("route_external_open has no execute_plan(:\n{body}"));
    let args = call_args(&body, call + "execute_plan(".len())
        .unwrap_or_else(|| panic!("execute_plan( does not close:\n{body}"));
    let closures: Vec<&String> = args.iter().filter(|a| a.starts_with('|')).collect();
    assert!(closures.len() >= 4, "non-vacuity: closures {closures:?}");
    let params_of = |c: &str| c[1..c[1..].find('|').unwrap() + 1].to_string();
    if let Some(c) = closures.iter().find(|c| c.contains(FILE_OPEN)) {
        return ((*c).clone(), params_of(c));
    }
    // A closure whose body is only `<helper>(app, label, group)`.
    let glue_n = norm(glue);
    for c in &closures {
        let tail = c[c[1..].find('|').unwrap() + 2..].trim();
        let tail = tail.trim_start_matches('{').trim();
        let Some(paren) = tail.find('(') else {
            continue;
        };
        let helper = &tail[..paren];
        if !is_ident(helper) {
            continue;
        }
        let marker = format!("fn {helper}(");
        if let Some(at) = glue_n.find(&marker) {
            let open = at + marker.len();
            let Some(close) = close_of(&glue_n, open) else {
                continue;
            };
            let sig = glue_n[open..close].to_string();
            let body_end = glue_n[at..].find(" fn ").map_or(glue_n.len(), |e| at + e);
            let region = glue_n[at..body_end].to_string();
            if region.contains(FILE_OPEN) {
                return (region, sig);
            }
        }
    }
    panic!("no execute_plan closure (or helper) sends file:open:\n{body}");
}

// ------------------------------------------------------------------- GL-1

#[test]
fn d279_gl1_glue_resolves_the_target_from_menu_focus_once() {
    let body = fn_body(&raw(GLUE_REL), "route_external_open");
    assert!(body.contains("broadcast_target("), "{body}");
    assert_eq!(
        body.matches("try_state::<MenuFocus>").count(),
        1,
        "MenuFocus is read exactly once:\n{body}"
    );
    assert!(body.contains("UNMANAGED_FOCUS"), "{body}");
    let at = |t: &str| {
        body.find(t)
            .unwrap_or_else(|| panic!("route_external_open lacks `{t}`:\n{body}"))
    };
    assert!(at("broadcast_target(") < at("execute_plan("), "{body}");
    assert!(!body.contains(GLOBAL_EMIT), "global emit:\n{body}");
}

// ------------------------------------------------------------------- GL-2

#[test]
fn d279_gl2_send_looks_the_window_up_first_and_maps_errors() {
    let (region, _) = send_region(&raw(GLUE_REL));
    let sends = addressed_file_open_sends(&region);
    assert_eq!(sends.len(), 1, "one addressed file:open send:\n{region}");
    let send = sends[0].0;
    let lookup = region
        .find(LOOKUP)
        .unwrap_or_else(|| panic!("no `{LOOKUP}` in the send region:\n{region}"));
    assert!(lookup < send, "lookup before send:\n{region}");
    assert!(
        region.contains("is gone") || region.contains("ok_or_else("),
        "a missing window maps to Err:\n{region}"
    );
    let stmt_start = region[..send].rfind([';', '{']).map_or(0, |i| i + 1);
    let stmt_end = region[send..].find(';').map_or(region.len(), |e| send + e);
    let stmt = &region[stmt_start..stmt_end];
    assert!(
        stmt.contains("map_err("),
        "the send's error is mapped:\n{stmt}"
    );
    assert!(
        !stmt.contains("let _"),
        "the send is not discarded:\n{stmt}"
    );
}

// ------------------------------------------------------------------- GL-3

#[test]
fn d279_gl3_the_lookup_gates_the_send_to_the_same_parameter() {
    let (region, params) = send_region(&raw(GLUE_REL));

    // `<id>` from `get_webview_window(&?<id>)`.
    let lookup = region
        .find(LOOKUP)
        .unwrap_or_else(|| panic!("no `{LOOKUP}`:\n{region}"));
    let arg_end = close_of(&region, lookup + LOOKUP.len())
        .unwrap_or_else(|| panic!("the lookup does not close:\n{region}"));
    let id = region[lookup + LOOKUP.len()..arg_end]
        .trim()
        .trim_start_matches('&')
        .trim();
    assert!(
        is_ident(id),
        "the lookup takes an identifier, got `{id}`:\n{region}"
    );

    // (1) The missing window becomes Err in the same statement.
    let stmt_start = region[..lookup].rfind([';', '{']).map_or(0, |i| i + 1);
    let stmt_end = region[lookup..]
        .find(';')
        .map_or(region.len(), |e| lookup + e);
    let stmt = region[stmt_start..stmt_end].trim();
    let after = region[arg_end + 1..].trim_start();
    let ok_or_q = (stmt.contains(".ok_or(") || stmt.contains(".ok_or_else("))
        && stmt.ends_with('?')
        && stmt.find(".ok_or").unwrap() > stmt.find(LOOKUP).unwrap();
    let let_else = stmt.starts_with("let Some(") && after.starts_with("else { return Err(");
    assert!(
        ok_or_q || let_else,
        "the lookup's None is an Err in its own statement:\n{stmt}"
    );

    // (2) The send's first argument is that same identifier.
    let sends = addressed_file_open_sends(&region);
    assert_eq!(sends.len(), 1, "one addressed file:open send:\n{region}");
    let first = sends[0].1.trim_start_matches('&').trim();
    assert_eq!(first, id, "send goes to the looked-up label:\n{region}");

    // (3) `<id>` is a parameter (closure list or helper signature).
    let inner = params.trim_matches('|');
    let names: Vec<&str> = inner
        .split(',')
        .map(|p| p.split(':').next().unwrap_or("").trim())
        .collect();
    assert!(
        names.contains(&id),
        "`{id}` is a parameter of `{params}`:\n{region}"
    );

    // (4) No discarded lookup (`let _… = … get_webview_window`).
    for stmt in region.split(';') {
        let stmt = stmt.trim().trim_start_matches('{').trim();
        if let Some(rest) = stmt.strip_prefix("let ") {
            let name: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            assert!(
                !(name.starts_with('_') && stmt.contains(LOOKUP)),
                "a discarded lookup:\n{stmt}"
            );
        }
    }
}

// ------------------------------------------------------------------ EP-L9

fn rs_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rs_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs")
            && !path.to_string_lossy().ends_with("_tests.rs")
        {
            out.push(path);
        }
    }
}

#[test]
fn d279_ep_l9_no_global_file_open_emit_and_both_addressed_emitters_exist() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    rs_files(&root.join("src"), &mut files);
    assert!(files.len() >= 50, "non-vacuity: {} files", files.len());

    let mut offenders = Vec::new();
    let mut addressed = Vec::new();
    for file in &files {
        let text = norm(&std::fs::read_to_string(file).unwrap());
        let rel = file
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if text.contains(GLOBAL_EMIT) {
            offenders.push(rel.clone());
        }
        if !addressed_file_open_sends(&text).is_empty() {
            addressed.push(rel);
        }
    }
    offenders.sort();
    addressed.sort();
    assert_eq!(offenders, Vec::<String>::new(), "global file:open emits");
    assert_eq!(
        addressed,
        vec![WINDOW_REL.to_string(), GLUE_REL.to_string()],
        "the addressed file:open emitters"
    );
}
