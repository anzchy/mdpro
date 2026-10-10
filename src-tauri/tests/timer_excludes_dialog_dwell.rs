//! D1 — a logged `durationMs` must not include time the user spent staring at
//! a native file dialog.
//!
//! Gate-2 recorded one export at **72,745 ms**, of which **72,154 ms** was the
//! human deciding where to save. The net cost of the work was 591 ms. Every
//! `durationMs` emitted from a code path that crosses a dialog is that kind of
//! number: it measures the user, not the program, so it cannot be compared
//! across runs, trended, or alerted on.
//!
//! ## Why this is a source-text test
//!
//! The three defective functions call `rfd` inline, so a unit test cannot
//! reach them — `rfd::FileDialog::new().pick_file()` blocks on a real window
//! server. Extracting the timing arithmetic into a testable helper would make
//! the *arithmetic* testable while leaving the actual defect (where the timer
//! is started relative to the dialog) exactly as unobservable as it is today.
//! The defect is positional, so the assertion is positional.
//!
//! This mirrors the pattern already used on the frontend side —
//! `tests/large-document-guard-call-site.test.ts` and the C8b' threshold-literal
//! case both assert on source text for the same reason: the property is about
//! how the code is arranged, and no runtime value exposes it.
//!
//! ## The invariant
//!
//! In any function that opens a native dialog, **every timer started before the
//! dialog must be stopped before the dialog**. Counting `Instant::now()` against
//! `.elapsed()` over the region preceding the dialog states exactly that: an
//! unbalanced pair means a live timer is running while the dialog is up, which
//! is the defect. Work done before the dialog is still measurable — the two
//! export paths render and sanitize there, and that cost is worth keeping — it
//! just has to be banked into a `Duration` before the dialog opens rather than
//! read back afterwards.
//!
//! ## What this test does not do
//!
//! It cannot see a timer that spans a dialog opened by a *callee*. T4 used to
//! cover the one such path (`show_write_confirmation`, a native `rfd` alert
//! reached from three MCP handlers in `http_server.rs`). ADR-0042 WI-9 deleted
//! it: the three handlers now wait on the in-window prompt through
//! `mcp_confirm::http::confirm_gate`. T4 now pins that no native dialog is
//! left in that file and that it still has no timers, so a wait on the user
//! cannot be measured there either. If that ever stops being true, T4 fails
//! and the case has to be reasoned about again rather than silently regressing.

use std::fs;
use std::path::{Path, PathBuf};

/// A top-level (column-0) function, captured with its body.
///
/// Column-0 only is deliberate: it skips `#[cfg(test)] mod tests` bodies, whose
/// functions are indented, along with everything in an `impl` block. No dialog
/// is opened from either.
struct FnItem {
    file: String,
    name: String,
    body: String,
}

fn src_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries =
        fs::read_dir(dir).unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()));
    for entry in entries {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

fn fn_name_at(line: &str) -> Option<String> {
    for prefix in [
        "pub async fn ",
        "pub fn ",
        "pub(crate) async fn ",
        "pub(crate) fn ",
        "async fn ",
        "fn ",
    ] {
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

fn functions_in(label: &str, src: &str) -> Vec<FnItem> {
    let lines: Vec<&str> = src.lines().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        match fn_name_at(lines[i]) {
            Some(name) => {
                // rustfmt puts the closing brace of a column-0 item at column 0.
                let mut j = i + 1;
                while j < lines.len() && lines[j] != "}" {
                    j += 1;
                }
                let end = j.min(lines.len() - 1);
                out.push(FnItem {
                    file: label.to_string(),
                    name,
                    body: lines[i..=end].join("\n"),
                });
                i = end + 1;
            }
            None => i += 1,
        }
    }
    out
}

fn all_functions() -> Vec<FnItem> {
    let mut files = Vec::new();
    rust_files(&src_root(), &mut files);
    files.sort();
    let mut out = Vec::new();
    for path in files {
        let label = path
            .strip_prefix(src_root().parent().expect("manifest dir"))
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        let src = fs::read_to_string(&path).expect("read source");
        out.extend(functions_in(&label, &src));
    }
    out
}

/// Functions that open a native dialog directly.
fn dialog_functions() -> Vec<FnItem> {
    all_functions()
        .into_iter()
        .filter(|f| f.body.contains("rfd::"))
        .collect()
}

#[test]
fn t1_no_timer_stays_running_across_a_native_dialog() {
    let functions = dialog_functions();
    let mut offenders = Vec::new();

    for f in &functions {
        let dialog_at = f
            .body
            .find("rfd::")
            .expect("filtered on this substring already");
        let before_dialog = &f.body[..dialog_at];

        let opened = before_dialog.matches("Instant::now()").count();
        let closed = before_dialog.matches(".elapsed()").count();

        if opened != closed {
            offenders.push(format!(
                "{}::{} — {opened} timer(s) started before the dialog, {closed} stopped",
                f.file, f.name
            ));
        }
    }

    assert!(
        offenders.is_empty(),
        "a timer left running while a native dialog is open measures how long the \
         user took to decide, not how long the work took. Gate 2 recorded one such \
         export at 72,745 ms against 591 ms of real work.\n\
         Bank the elapsed work into a Duration before opening the dialog, then start \
         a fresh timer after it.\n\n{}",
        offenders.join("\n")
    );
}

#[test]
fn t2_the_scan_actually_reaches_the_three_recorded_sites() {
    // Without this, a scanner that silently matched nothing would make T1 pass
    // vacuously — and T1 passing is exactly the signal the fix is judged by.
    let found: Vec<String> = dialog_functions().into_iter().map(|f| f.name).collect();

    for expected in [
        "open_file_dialog",     // file.rs — the site the defect record named
        "export_html",          // export.rs — where the 72,745 ms actually came from
        "export_rendered_html", // export.rs
        "save_file_dialog",     // file.rs — dialog closes before any timing starts
        "pick_export_folder",   // preferences.rs — no timing at all
                                // `show_write_confirmation` (http_server.rs) was listed here until
                                // ADR-0042 WI-9 deleted it: the MCP write confirmation is an in-window
                                // prompt now, not a native dialog, so there is nothing left to reach.
    ] {
        assert!(
            found.contains(&expected.to_string()),
            "expected {expected} among the scanned dialog functions, got {found:?}"
        );
    }
}

#[test]
fn t3_save_file_is_correctly_outside_this_invariant() {
    // The defect record explicitly excludes `save_file`: it carries the same
    // `let start = Instant::now();` line, but its dialog lives in
    // `save_file_dialog` and has already closed before `save_file` is entered.
    // Pinned here so nobody "fixes" a path that was never broken — and so that
    // moving a dialog into `save_file` fails loudly instead of quietly
    // reintroducing D1.
    //
    // Moved with the code by D32 WI-6 (ADR-0068), with this stated reason: the
    // timed body now lives in `save_file_with`, a seam that takes the watcher's
    // baselines, and the `save_file` command is a thin wrapper that calls it.
    // The timer check follows the body; the no-dialog check covers both.
    let functions = all_functions();
    let find = |name: &str| {
        functions
            .iter()
            .find(|f| f.name == name && f.file.ends_with("commands/file.rs"))
            .unwrap_or_else(|| panic!("{name} must exist"))
    };
    let save_file = find("save_file");
    let save_file_with = find("save_file_with");

    assert!(
        save_file.body.contains("save_file_with("),
        "premise guard: the save_file command delegates to save_file_with"
    );
    assert!(
        save_file_with.body.contains("Instant::now()"),
        "premise guard: save_file_with is only interesting because it IS timed"
    );
    for f in [save_file, save_file_with] {
        assert!(
            !f.body.contains("rfd::"),
            "{} must not open a dialog — the save timing is sound precisely because \
             save_file_dialog closes the picker before calling it",
            f.name
        );
    }
}

#[test]
fn t4_the_mcp_confirmation_path_is_untimed_so_the_indirect_case_cannot_arise() {
    // Rewritten by ADR-0042 WI-9 (matrix SC-1), with this stated reason: the
    // premise used to be that `show_write_confirmation` exists, and WI-9
    // deleted that native alert. The three MCP write handlers now wait on the
    // user through `confirm_gate` (an in-window prompt), so the premise is that
    // they do, and that no native dialog is left in the file. The timer check
    // is unchanged: a timer here would span that wait on the user.
    let path = src_root().join("services/http_server.rs");
    let src = fs::read_to_string(&path).expect("read http_server.rs");

    assert!(
        !src.contains("rfd::") && src.contains("confirm_gate("),
        "premise guard: the MCP writes wait on confirm_gate, not a native dialog"
    );
    assert!(
        !src.contains("Instant::now()"),
        "http_server.rs gained a timer. Its write handlers wait on confirm_gate, so \
         that timer may now span the user's decision — a case T1 cannot detect. \
         Verify it by hand and extend T1 to cover callers before relaxing this."
    );
}
