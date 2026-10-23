//! D173-WI-4b, source tripwire (audit b101 H1): the behaviour test in
//! save_as_reconcile_tests.rs drives the test-only seam `save_as_held_with`,
//! while production `save_file_dialog` calls `save_as_post_picker`. So the production body must take
//! its reservation without the reconcile too: `without_reconcile` sits
//! between `reserve_hold(` and the watching save, in both bodies.
//! Pure source text, so ungated.
use crate::services::file_watcher::kinds_fixture::{code_lines, fn_slice};

const FILE_SRC: &str = include_str!("file.rs");
const TRANSACTION_SRC: &str = include_str!("save_as_transaction.rs");
const SAVE_AS_SRC: &str = include_str!("save_as_watch.rs");
const DIALOG: &str = "pub async fn save_file_dialog(";
const TRANSACTION: &str = "pub(crate) async fn save_as_post_picker(";
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

fn assert_reservation_skips_reconcile(src: &str, anchor: &str) {
    let body = code_in(src, anchor);
    let reserve = at(&body, "reserve_hold(", anchor);
    let save = at(&body, "save_as_watched_with(", anchor);
    let skip = at(&body, ".without_reconcile()", anchor);
    assert!(
        reserve < skip && skip < save,
        "{anchor}: the Save As reservation must drop the reconcile \
         (`.without_reconcile()` between `reserve_hold(` and \
         `save_as_watched_with(`), or the saving document gets a false \
         external-change prompt:\n{body}"
    );
}

#[test]
fn d173_wi4b_w_dialog_reservation_skips_reconcile() {
    assert!(code_in(FILE_SRC, DIALOG).contains("save_as_post_picker("));
    assert_reservation_skips_reconcile(TRANSACTION_SRC, TRANSACTION);
}

#[test]
fn d173_wi4b_w_seam_reservation_skips_reconcile() {
    assert_reservation_skips_reconcile(SAVE_AS_SRC, SEAM);
}
