//! D173-WI-2 wiring tripwires (plan r2 §4, commit 2; ADR-0086 decision 4).
//! The commands need a Tauri `Window` and `State`, which no test can build,
//! so where the notice sits in them is pinned on the source text; the
//! notice's behaviour is pinned in services/file_watcher_save_notice_tests.rs.
//! - w1: `save_file` takes the Tauri window and the document id, saves
//!   through its one `save_file_with(` (s9 unchanged), and only on `Ok`
//!   calls `notice_saved` with the window's label and the target the save
//!   resolved; it never re-canonicalises and never fails on the notice.
//! - w2: `save_file_dialog` delegates to `save_as_post_picker`, which notices
//!   in its `Ok` arm, after `confirm_hold`, never in the `Err` release arm.
//! Pure source text, so ungated.
use crate::services::file_watcher::kinds_fixture::{code_lines, fn_slice};

const FILE_SRC: &str = include_str!("file.rs");
const TRANSACTION_SRC: &str = include_str!("save_as_transaction.rs");

fn code_of(anchor: &str) -> String {
    code_lines(fn_slice(FILE_SRC, anchor))
        .collect::<Vec<_>>()
        .join("\n")
}

fn at(body: &str, token: &str, anchor: &str) -> usize {
    body.find(token)
        .unwrap_or_else(|| panic!("{anchor}: no `{token}` in:\n{body}"))
}

/// The text of the statement that starts at `from`, up to its `;` or the
/// end of its block.
fn statement(body: &str, from: usize) -> &str {
    let rest = &body[from..];
    let end = rest.find(';').unwrap_or(rest.len());
    &rest[..end]
}

/// The parameter list of the function `body` opens with.
fn params(body: &str) -> &str {
    let open = body.find('(').expect("a parameter list");
    let close = body.find(") ->").expect("a return type");
    &body[open..close]
}

#[test]
fn d173_wi2_w1_save_file_notices_only_after_ok_with_the_written_target() {
    let anchor = "pub async fn save_file(";
    let body = code_of(anchor);
    assert!(body.lines().count() > 3, "non-vacuity:\n{body}");
    let ps = params(&body);
    assert!(
        ps.contains("window: Window"),
        "Tauri injects the window:\n{ps}"
    );
    assert!(
        ps.contains("document_id: String") && !ps.contains("_document_id"),
        "the document id is used, not ignored:\n{ps}"
    );
    assert_eq!(body.matches("save_file_with(").count(), 1, "{body}");
    assert_eq!(body.matches("notice_saved(").count(), 1, "{body}");
    let save = at(&body, "save_file_with(", anchor);
    let notice = at(&body, "notice_saved(", anchor);
    assert!(save < notice, "the notice follows the save:\n{body}");
    let between = &body[save..notice];
    assert!(
        between.contains("if let Ok(") || between.contains("Ok(") && between.contains("=>"),
        "the notice is reached only on the save's Ok:\n{body}"
    );
    let call = statement(&body, notice);
    assert!(
        call.contains("window.label()") || call.contains("label"),
        "the origin is the Tauri window's label: {call}"
    );
    assert!(
        call.contains("written_to"),
        "the notice gets the target the save resolved: {call}"
    );
    assert!(
        !call.contains('?'),
        "a notice failure never fails the save: {call}"
    );
    assert!(
        !body.contains("canonicalize"),
        "the command never re-canonicalises the target:\n{body}"
    );
}

#[test]
fn d173_wi2_w2_save_as_notices_in_the_ok_arm_after_confirm() {
    let anchor = "pub async fn save_file_dialog(";
    assert!(code_of(anchor).contains("save_as_post_picker("));
    let body = code_lines(fn_slice(
        TRANSACTION_SRC,
        "pub(crate) async fn save_as_post_picker(",
    ))
    .collect::<Vec<_>>()
    .join("\n");
    assert!(body.lines().count() > 3, "non-vacuity:\n{body}");
    assert_eq!(body.matches("notice_saved(").count(), 1, "{body}");
    let confirm = at(&body, "confirm_hold(", anchor);
    let notice = at(&body, "notice_saved(", anchor);
    let release = at(&body, "release_hold(", anchor);
    assert!(confirm < notice, "the notice follows the confirm:\n{body}");
    assert!(
        notice < release,
        "the notice is in the Ok arm, not the Err arm that releases:\n{body}"
    );
    let call = statement(&body, notice);
    assert!(
        call.contains("window.label()") || call.contains("label"),
        "the origin is the Tauri window's label: {call}"
    );
    assert!(
        call.contains("written_to"),
        "the notice gets the target the save resolved: {call}"
    );
    assert!(
        !call.contains('?'),
        "a notice failure never fails the save: {call}"
    );
}
