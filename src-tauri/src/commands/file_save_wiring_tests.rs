//! D32 WI-6 (matrix S5, S9): source tripwires for the save refresh
//! (ADR-0068 decision 4). Pure source text, so ungated.
//! - S5: inside `save_file_written` (the save body; `save_file_with` wraps it,
//!   D69), the refresh sits between `atomic_write`
//!   and `mark_write_end`, guarded by the write result. No seam exposes the
//!   moment `mark_write_end` runs, and a spinning observer races against
//!   correct code (matrix D-1); S1 and S4 pin the behaviour on both sides.
//! - S9: the `#[tauri::command]` wrappers hand `save_file_with` the managed
//!   watcher's store. A wrapper passing an empty store would compile, pass
//!   every behavioural case, and silently disable the refresh in production.
//!   `save_file_dialog` hands the managed watcher to the D69 Save As seam
//!   (`save_as_watch.rs`), which passes its store to `save_file_written`.
use crate::services::file_watcher::kinds_fixture::{code_lines, fn_slice};

const FILE_SRC: &str = include_str!("file.rs");
const SAVE_AS_SRC: &str = include_str!("save_as_watch.rs");
const TRANSACTION_SRC: &str = include_str!("save_as_transaction.rs");

fn code_of(anchor: &str) -> String {
    code_in(FILE_SRC, anchor)
}

fn code_in(src: &str, anchor: &str) -> String {
    code_lines(fn_slice(src, anchor))
        .collect::<Vec<_>>()
        .join("\n")
}

fn leading_ws(s: &str, idx: usize) -> String {
    let line_start = s[..idx].rfind('\n').map_or(0, |i| i + 1);
    s[line_start..]
        .chars()
        .take_while(|c| c.is_whitespace())
        .collect()
}

/// The text between the `(` at `open` and its matching `)`.
fn paren_body(s: &str, open: usize) -> &str {
    let mut depth = 0usize;
    for (i, c) in s[open..].char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return &s[open + 1..open + i];
                }
            }
            _ => {}
        }
    }
    panic!("unbalanced parentheses after {open}");
}

/// The last top-level argument of an argument list (trailing comma allowed).
fn last_arg(args: &str) -> String {
    let args = args.trim().trim_end_matches(',');
    let mut depth = 0i32;
    let mut cut = 0;
    for (i, c) in args.char_indices() {
        match c {
            '(' | '[' | '{' | '<' => depth += 1,
            ')' | ']' | '}' | '>' => depth -= 1,
            ',' if depth == 0 => cut = i + 1,
            _ => {}
        }
    }
    args[cut..].trim().to_string()
}

fn one(body: &str, token: &str) -> usize {
    assert_eq!(
        body.matches(token).count(),
        1,
        "exactly one `{token}` in:\n{body}"
    );
    body.find(token).unwrap()
}

#[test]
fn s5_refresh_sits_between_atomic_write_and_mark_write_end() {
    let body = code_of("fn save_file_written(");
    let start = one(&body, "mark_write_start(");
    let write = one(&body, "atomic_write(");
    let refresh = one(&body, "baselines.refresh_after_save(");
    let end = one(&body, "mark_write_end(");
    assert!(
        start < write && write < refresh && refresh < end,
        "order:\n{body}"
    );

    let lines: Vec<&str> = body.lines().collect();
    let at = body[..refresh].matches('\n').count();
    let ws = |l: &str| l.len() - l.trim_start().len();
    let guard = if lines[at].contains("if ") {
        lines[at]
    } else {
        (0..at)
            .rev()
            .map(|i| lines[i])
            .find(|l| ws(l) < ws(lines[at]) && l.trim_end().ends_with('{'))
            .unwrap_or_else(|| panic!("no block opens the refresh line:\n{body}"))
    };
    assert!(
        guard.contains("write_result")
            && (guard.contains(".is_ok()") || guard.contains("if let Ok(")),
        "the refresh is guarded by the write result: {guard}"
    );
    assert_eq!(
        leading_ws(&body, end),
        leading_ws(&body, start),
        "mark_write_end is not nested"
    );
    assert!(
        !body[write..end].contains('?'),
        "no early return before mark_write_end:\n{body}"
    );
}

fn assert_passes_managed_store(anchor: &str) {
    assert_passes_managed(FILE_SRC, anchor, "save_file_with(", "watcher.baselines()");
}

/// `anchor` in `src` takes the managed watcher (if it is a command) and its
/// one `callee` call ends with `last`.
fn assert_passes_managed(src: &str, anchor: &str, callee: &str, last: &str) {
    let body = code_in(src, anchor);
    assert!(
        body.lines().count() > 3,
        "non-vacuous slice for {anchor}:\n{body}"
    );
    let fn_at = body.find("fn ").unwrap();
    let params = paren_body(&body, fn_at + body[fn_at..].find('(').unwrap());
    assert!(
        params.contains("watcher: State<'_, FileWatcher>")
            || params.contains("watcher: State<FileWatcher>")
            || params.contains("watcher: &FileWatcher"),
        "{anchor} takes the managed watcher: {params}"
    );
    let call = one(&body, callee) + callee.len() - 1;
    let arg = last_arg(paren_body(&body, call));
    assert_eq!(arg, last, "{anchor} passes the managed store:\n{body}");
    for banned in [
        "BaselineStore::default",
        "BaselineStore::new",
        "Default::default()",
        "BaselineStore {",
    ] {
        assert!(
            !body.contains(banned),
            "{anchor} builds its own store (`{banned}`):\n{body}"
        );
    }
}

#[test]
fn s9_save_file_passes_the_managed_watchers_store() {
    assert_passes_managed_store("pub async fn save_file(");
}

#[test]
fn s9_save_file_dialog_passes_the_managed_watchers_store() {
    let dialog = "pub async fn save_file_dialog(";
    let body = code_in(FILE_SRC, dialog);
    assert!(body.contains("save_as_post_picker(") && body.contains("watcher: &watcher"));
    let transaction = code_in(TRANSACTION_SRC, "pub(crate) async fn save_as_post_picker(");
    assert!(transaction.contains("save_as_watched_with(") && transaction.contains("watcher,"));
    let seam = "pub(crate) async fn save_as_watched_with(";
    assert_passes_managed(
        SAVE_AS_SRC,
        seam,
        "save_file_written(",
        "watcher.baselines()",
    );
    assert!(
        !code_in(SAVE_AS_SRC, seam).contains("save_file_with("),
        "the seam saves through save_file_written only"
    );
}
