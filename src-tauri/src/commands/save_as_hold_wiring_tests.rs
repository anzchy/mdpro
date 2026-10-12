//! D173 audit fixes M1 and M2, source tripwires: `save_file_dialog` runs the
//! steps of the test-only seam `save_as_held_with` inline (the D69 and
//! D173-WI-1 wiring pin them there), so a fix in one must be the fix in the
//! other.
//! - M2: the return taken when `reserve_hold` gives `None` comes before the
//!   watching save, in both.
//! - M1: the `Err` arm, which settles the reservation of a failed Save As,
//!   is the same code in both (modulo the label's source).
//! Pure source text, so ungated.
use crate::services::file_watcher::kinds_fixture::{code_lines, fn_slice};

const FILE_SRC: &str = include_str!("file.rs");
const SAVE_AS_SRC: &str = include_str!("save_as_watch.rs");
const DIALOG: &str = "pub async fn save_file_dialog(";
const SEAM: &str = "pub(crate) async fn save_as_held_with(";

fn code_in(src: &str, anchor: &str) -> String {
    code_lines(fn_slice(src, anchor))
        .collect::<Vec<_>>()
        .join("\n")
}

fn at(body: &str, token: &str, anchor: &str) -> usize {
    body.find(token)
        .unwrap_or_else(|| panic!("{anchor}: no `{token}` in:\n{body}"))
}

/// The `Err` arm that settles the reservation: from the last `Err(` arm
/// pattern after the save to the end of the body, whitespace-normalised,
/// with the label's source unified.
fn err_arm(body: &str, anchor: &str) -> String {
    let save = at(body, "save_as_watched_with(", anchor);
    let arm = body[save..]
        .rfind("Err(err) =>")
        .map(|i| save + i)
        .unwrap_or_else(|| panic!("{anchor}: no `Err(err) =>` arm:\n{body}"));
    body[arm..]
        .replace("window.label()", "label")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// The `None` return sits between `reserve_hold(` and the watching save.
fn assert_returns_before_watching(body: &str, anchor: &str) {
    assert!(body.lines().count() > 3, "non-vacuity {anchor}:\n{body}");
    let reserve = at(body, "reserve_hold(", anchor);
    let save = at(body, "save_as_watched_with(", anchor);
    assert!(reserve < save, "{anchor}: reserve before the save:\n{body}");
    let between = &body[reserve..save];
    assert!(
        between.contains("return") && (between.contains("else") || between.contains("None")),
        "{anchor}: a fenced window (no reservation) returns before the watching save:\n{body}"
    );
}

#[test]
fn d173_m2_w_dialog_and_seam_return_before_the_watching_save() {
    assert_returns_before_watching(&code_in(SAVE_AS_SRC, SEAM), SEAM);
    assert_returns_before_watching(&code_in(FILE_SRC, DIALOG), DIALOG);
}

#[test]
fn d173_m1_w_dialog_err_arm_is_the_seams() {
    let seam = err_arm(&code_in(SAVE_AS_SRC, SEAM), SEAM);
    let dialog = err_arm(&code_in(FILE_SRC, DIALOG), DIALOG);
    assert!(
        seam.contains("Err(err)"),
        "non-vacuity: the seam's arm returns the error: {seam}"
    );
    assert_eq!(
        dialog, seam,
        "save_file_dialog settles a failed Save As exactly as save_as_held_with"
    );
}
