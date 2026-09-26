//! WI-3 (D24 follow-up) — source pin: both window-building sites get their
//! geometry only from the shared restore helper, pass their path to it, and
//! log the restore outcome at Success.
//!
//! Case wg1 of `.claude/tdd-guardian/tests-20260926-062337.md`.
//!
//! **Below Level 6: source-text inspection, a supplement only.** The original
//! defect was pure wiring ("nobody passes the path"), and no lane cheaper than
//! the device observes a live `WebviewWindowBuilder`. The real checks are
//! device runs D-1…D-4. Renaming the helper, the context builders or
//! `apply_resolved` breaks this case on purpose; the spellings live in the
//! consts below so such a rename is a one-line edit with a stated reason.

/// The WI-2 read+decide entry both sites call.
const HELPER: &str = "window_restore::restore_geometry_for(";
/// `open_file_in_new_window` must pass its path: the original defect.
const OPEN_PATH_ARG: &str = "Some(&path)";
/// `create_window` passes its optional path through, never a literal `None`.
const CREATE_PATH_ARG: &str = "file_path.as_deref()";
/// The single builder-geometry adapter.
const APPLY: &str = "apply_resolved(";
/// The binding that holds the `RestoreOutcome` at both sites.
const OUTCOME_VAR: &str = "outcome";

fn raw(rel: &str) -> String {
    let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path} unreadable: {e}"))
}

/// Collapse whitespace so rustfmt wrapping does not change what is seen; a
/// wrapped call's `( ` is folded back to `(`.
fn normalize(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace("( ", "(")
}

/// The body from `start` to the next `\n}` at column 0, normalised. Every
/// `find` is guarded, so a missing marker fails instead of going vacuously green.
fn body(source: &str, start: &str) -> String {
    let from = source
        .find(start)
        .unwrap_or_else(|| panic!("marker `{start}` not found"));
    let len = source[from..]
        .find("\n}")
        .unwrap_or_else(|| panic!("no closing brace at column 0 after `{start}`"));
    normalize(&source[from..from + len])
}

fn open_body() -> String {
    body(
        &raw("src/services/open_route/tauri_glue.rs"),
        "fn open_file_in_new_window",
    )
}

fn create_body() -> String {
    body(&raw("src/commands/window.rs"), "pub async fn create_window")
}

/// The `log_event(` blocks of a body (text after each `log_event(` up to the next).
fn log_blocks(body: &str) -> Vec<&str> {
    body.split("log_event(").skip(1).collect()
}

fn check_site(name: &str, body: &str, context_fn: &str) {
    // 1. No builder geometry call at all: only `apply_resolved` touches it.
    for banned in [".inner_size(", ".min_inner_size(", ".position("] {
        assert!(!body.contains(banned), "{name} calls `{banned}` directly");
    }
    // 2. Geometry goes through the adapter.
    assert!(body.contains(APPLY), "{name} does not call `{APPLY}`");

    // 5. The Success block carries the context builder, the level and Success.
    let blocks = log_blocks(body);
    let success: Vec<&&str> = blocks.iter().filter(|b| b.contains(context_fn)).collect();
    assert_eq!(
        success.len(),
        1,
        "{name}: expected one log block with `{context_fn}`"
    );
    let block = success[0];
    assert!(
        block.contains("restore_log_level("),
        "{name}: no restore_log_level"
    );
    assert!(block.contains("LogStatus::Success"), "{name}: not Success");

    // 6. No block carrying restore information is a Fail.
    for b in &blocks {
        let carries_restore =
            b.contains(context_fn) || b.contains("restore_log_level(") || b.contains(OUTCOME_VAR);
        if carries_restore {
            assert!(
                !b.contains("LogStatus::Fail"),
                "{name}: a restore log block is Fail: {b}"
            );
        }
    }
}

#[test]
fn wg1_open_file_in_new_window_restores_for_its_path() {
    let body = open_body();
    check_site("open_file_in_new_window", &body, "window_open_context(");
    // 3. The helper is called with the path.
    let call = format!("{HELPER}{OPEN_PATH_ARG}");
    assert!(
        body.contains(&call),
        "open_file_in_new_window lacks `{call}`"
    );
}

#[test]
fn wg1_create_window_restores_for_its_optional_path() {
    let body = create_body();
    check_site("create_window", &body, "window_create_context(");
    // 4. The helper gets the optional path, never a literal `None`.
    let call = format!("{HELPER}{CREATE_PATH_ARG}");
    assert!(body.contains(&call), "create_window lacks `{call}`");
    let none = format!("{HELPER}None");
    assert!(!body.contains(&none), "create_window passes `{none}`");
}

#[test]
fn wg1_old_lookup_is_gone_and_services_do_not_depend_on_commands() {
    // 7. The exact-key helper is deleted.
    assert!(
        !raw("src/commands/window.rs").contains("get_stored_geometry"),
        "window.rs still has get_stored_geometry"
    );
    // 8. No services → commands dependency.
    for file in [
        "src/services/window_restore.rs",
        "src/services/window_restore_log.rs",
    ] {
        assert!(
            !raw(file).contains("crate::commands"),
            "{file} depends on crate::commands"
        );
    }
}
