//! ADR-0042 WI-9 structural guard (matrix SG-1, SG-2): every MCP write path
//! goes through `confirm_gate` with its own operation, the native alert is
//! gone, the insert rollback baseline is the post-approval re-read, and the
//! window-event hook cancels on `Destroyed` only.
//!
//! A source-text test for the reason `timer_excludes_dialog_dwell.rs` is one:
//! the handlers need a live `AppHandle` (the Tauri `test` feature is not
//! enabled), so how they are arranged is observable only in their source.
//! This is a supplement: the behavioural checks are F1-1..F1-4
//! (`http_server_insert_reread_tests.rs`) and the WI-10 device gates.
//!
//! `functions_in` is copied from `timer_excludes_dialog_dwell.rs` rather than
//! shared: integration test crates cannot share a module without
//! `tests/common/`. Column-0 items only, so `mod tests` bodies are skipped.

use std::fs;
use std::path::{Path, PathBuf};

fn src(rel: &str) -> String {
    let path: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(rel);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn fn_name_at(line: &str) -> Option<String> {
    for prefix in ["pub async fn ", "pub fn ", "async fn ", "fn "] {
        if let Some(rest) = line.strip_prefix(prefix) {
            let name: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

/// The body (signature included) of the column-0 function `name` in `rel`.
fn body_of(rel: &str, name: &str) -> String {
    let text = src(rel);
    let lines: Vec<&str> = text.lines().collect();
    let start = lines
        .iter()
        .position(|l| fn_name_at(l).as_deref() == Some(name))
        .unwrap_or_else(|| panic!("premise: fn {name} must exist in {rel}"));
    let mut end = start + 1;
    while end < lines.len() && lines[end] != "}" {
        end += 1;
    }
    lines[start..=end.min(lines.len() - 1)].join("\n")
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Byte indices of `.field` where `field` ends at a non-identifier char.
fn field_reads(body: &str, field: &str) -> Vec<usize> {
    let needle = format!(".{field}");
    body.match_indices(&needle)
        .filter(|(i, _)| !body[i + needle.len()..].starts_with(is_ident))
        .map(|(i, _)| i)
        .collect()
}

/// The argument text of the call whose `name(` starts at `at`.
fn call_args(body: &str, at: usize) -> String {
    let open = at + body[at..].find('(').expect("call has a paren");
    let mut depth = 0usize;
    for (i, c) in body[open..].char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return body[open + 1..open + i].to_string();
                }
            }
            _ => {}
        }
    }
    panic!("unbalanced call at {at}");
}

fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Split call arguments at top-level commas.
fn top_level_args(args: &str) -> Vec<String> {
    let (mut out, mut cur, mut depth) = (Vec::new(), String::new(), 0i32);
    for c in args.chars() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            ',' if depth == 0 => {
                out.push(cur.trim().to_string());
                cur.clear();
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

const HTTP: &str = "services/http_server.rs";
const HANDLERS: [(&str, &str); 3] = [
    ("update_document", "Operation::Replace"),
    ("insert_content", "Operation::Insert"),
    ("dispatch_table_action", "Operation::Table"),
];

#[test]
fn sg1_i_ii_no_native_alert_and_focus_check_only_in_get_status() {
    let file = src(HTTP);
    assert!(
        !file.contains("rfd::"),
        "(i) http_server.rs must not open a native dialog"
    );
    let status = body_of(HTTP, "get_status");
    let total = file.matches("is_any_window_focused").count();
    let in_status = status.matches("is_any_window_focused").count();
    assert!(
        in_status >= 1,
        "(ii) premise: get_status reports window_focused"
    );
    assert_eq!(
        total, in_status,
        "(ii) any-window focus must not gate a write"
    );
}

#[test]
fn sg1_iii_iv_ix_every_write_path_calls_confirm_gate_once_with_its_operation() {
    for (name, op) in HANDLERS {
        let body = body_of(HTTP, name);
        assert_eq!(body.matches("confirm_gate(").count(), 1, "(iii) {name}");
        for code in ["USER_REJECTED", "CONFIRM_TIMEOUT", "CONFIRM_CANCELLED"] {
            assert!(
                !body.contains(code),
                "(iv) {name} must not map {code} itself"
            );
        }
        let args = squash(&call_args(&body, body.find("confirm_gate(").expect("iii")));
        assert!(args.contains(op), "(ix) {name} passes {op}: {args}");
        for (other, other_op) in HANDLERS {
            if other != name {
                assert!(
                    !args.contains(other_op),
                    "(ix) {name} must not pass {other_op}"
                );
            }
        }
    }
    // (ix) the table operation names the handler's own action binding.
    let body = body_of(HTTP, "dispatch_table_action");
    let sig = call_args(&body, body.find("dispatch_table_action").expect("name"));
    let binding = top_level_args(&sig)
        .iter()
        .filter_map(|p| p.split(':').next().map(str::trim).map(str::to_string))
        .find(|p| p.contains("action"))
        .expect("(ix) premise: dispatch_table_action has an action parameter");
    let args = squash(&call_args(&body, body.find("confirm_gate(").expect("iii")));
    assert!(
        args.replace(' ', "")
            .contains(&format!("Operation::Table({binding})")),
        "(ix) the table gate names `{binding}`: {args}"
    );
}

#[test]
fn sg1_v_vii_a_insert_reads_after_the_gate_and_rolls_back_to_the_reread() {
    let body = body_of(HTTP, "insert_content");
    let gate = body
        .find("confirm_gate(")
        .expect("(vi) confirm_gate( anchor");
    let resolve = body
        .find("resolve_insert_in(")
        .expect("(vi) resolve_insert_in( anchor");
    assert!(resolve > gate, "(v) the insert is resolved after the gate");

    for field in ["content", "cursor"] {
        let reads = field_reads(&body, field);
        assert!(
            reads.is_empty(),
            "(vii-a) no .{field} read in insert_content: {reads:?}"
        );
    }

    let let_at = body[..resolve]
        .rfind("let ")
        .expect("(vi) let … = resolve_insert_in(");
    let pattern = body[let_at + 4..resolve]
        .trim_end()
        .strip_suffix('=')
        .expect("(vi) the resolve is a let statement")
        .trim();
    let inner = pattern.rsplit('(').next().expect("pattern");
    let x: String = inner
        .trim_start()
        .chars()
        .take_while(|c| is_ident(*c))
        .collect();
    assert!(!x.is_empty(), "(vi) a bound baseline name in `{pattern}`");

    let updates: Vec<usize> = body[resolve..]
        .match_indices("update_document_content(")
        .map(|(i, _)| resolve + i)
        .collect();
    assert!(
        updates.len() >= 2,
        "(vi) apply then rollback after the resolve"
    );
    let last = top_level_args(&call_args(&body, *updates.last().expect("two")));
    let baseline = last.last().expect("rollback has a content argument").trim();
    let baseline = baseline.strip_prefix('&').unwrap_or(baseline);
    let baseline = baseline
        .strip_suffix(".clone()")
        .or_else(|| baseline.strip_suffix(".as_str()"))
        .unwrap_or(baseline);
    assert_eq!(
        baseline, x,
        "(vii-a) the rollback restores the post-approval re-read"
    );
}

#[test]
fn sg1_vii_b_update_reads_content_only_after_the_post_gate_reread() {
    let body = body_of(HTTP, "update_document");
    let gate = body
        .find("confirm_gate(")
        .expect("(vi) confirm_gate( anchor");
    let reread = body
        .match_indices("get_document(")
        .map(|(i, _)| i)
        .find(|i| *i > gate)
        .expect("(vii-b) a get_document( re-read after the gate");
    assert!(body.contains("update_document_content("), "(vi) anchor");
    let early: Vec<usize> = field_reads(&body, "content")
        .into_iter()
        .filter(|i| *i < reread)
        .collect();
    assert!(
        early.is_empty(),
        "(vii-b) .content read before the re-read at {early:?}"
    );
}

#[test]
fn sg1_viii_window_event_cancels_on_destroyed_only() {
    let body = body_of("services/mcp_confirm/mod.rs", "on_window_event");
    let at: Vec<usize> = body.match_indices("matches!(").map(|(i, _)| i).collect();
    assert_eq!(
        at.len(),
        1,
        "(viii) exactly one matches!( in on_window_event"
    );
    let arg = squash(&call_args(&body, at[0]));
    let arg = arg.strip_suffix(" { .. }").unwrap_or(&arg);
    assert!(
        arg == "event, WindowEvent::Destroyed" || arg == "event, tauri::WindowEvent::Destroyed",
        "(viii) the only variant is Destroyed: {arg}"
    );
    assert!(
        !body.contains("CloseRequested"),
        "(viii) a vetoable close must not cancel"
    );
    let words: Vec<&str> = body
        .split(|c: char| !(is_ident(c)))
        .filter(|w| !w.is_empty())
        .collect();
    let matched = words.windows(2).any(|w| w[0] == "match" && w[1] == "event");
    assert!(
        !matched,
        "(viii) no `match event` (non_exhaustive needs a catch-all)"
    );
}

#[test]
fn sg2_size_budgets() {
    let lines = src(HTTP).lines().count();
    assert!(
        lines <= 1431,
        "http_server.rs grew past its 1431-line baseline: {lines}"
    );
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/services/mcp_confirm");
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("mcp_confirm dir")
        .map(|e| e.expect("entry").path())
        .collect();
    files.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands/mcp_confirm.rs"));
    assert!(files.len() > 5, "premise: the module files were found");
    for f in files {
        let n = fs::read_to_string(&f).expect("read").lines().count();
        assert!(n < 300, "{} has {n} lines", f.display());
    }
}
