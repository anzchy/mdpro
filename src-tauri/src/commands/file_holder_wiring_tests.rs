//! D173-WI-1 wiring tripwires (plan r2 §7, commit 1). Every acquisition
//! reserves a hold before its legacy register and confirms it after, with the
//! window label Tauri supplies; `close_document` no longer unwatches; a
//! destroyed window releases its holds on `Destroyed` and never on the
//! vetoable `CloseRequested`; `release_watch_hold` is registered. Pure
//! source text, so ungated.
use crate::services::file_watcher::kinds_fixture::{code_lines, fn_slice};

const FILE_SRC: &str = include_str!("file.rs");
const RECOVER_SRC: &str = include_str!("draft_recover_watch.rs");
const SAVE_AS_SRC: &str = include_str!("save_as_watch.rs");
const TRANSACTION_SRC: &str = include_str!("save_as_transaction.rs");
const MOD_SRC: &str = include_str!("mod.rs");
const MAIN_SRC: &str = include_str!("../main.rs");

fn code_of(src: &str, anchor: &str) -> String {
    code_lines(fn_slice(src, anchor))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The production part of `src`: everything before its first test cfg.
fn production(src: &str) -> String {
    let cut = src.find("\n#[cfg(test)]").unwrap_or(src.len());
    code_lines(&src[..cut]).collect::<Vec<_>>().join("\n")
}

fn at(body: &str, token: &str, anchor: &str) -> usize {
    body.find(token)
        .unwrap_or_else(|| panic!("{anchor}: no `{token}` in:\n{body}"))
}

/// `reserve_hold(` with a Tauri label, then `register`, then `confirm_hold(`.
fn assert_reserve_register_confirm(body: &str, anchor: &str, register: &str) {
    let reserve = at(body, "reserve_hold(", anchor);
    let reg = at(body, register, anchor);
    let confirm = at(body, "confirm_hold(", anchor);
    assert!(reserve < reg, "{anchor}: reserve before `{register}`:\n{body}");
    assert!(reg < confirm, "{anchor}: confirm after `{register}`:\n{body}");
    let line = body[reserve..].lines().next().unwrap_or_default();
    assert!(
        line.contains("label") || body[reserve..reg].contains("label"),
        "{anchor}: the hold is keyed by a window label:\n{body}"
    );
}

#[test]
fn d173_wi1_w1_opens_reserve_before_register_and_confirm_after() {
    for anchor in ["pub async fn open_file(", "pub async fn open_file_dialog("] {
        let body = code_of(FILE_SRC, anchor);
        assert!(body.lines().count() > 3, "non-vacuity {anchor}:\n{body}");
        assert!(
            body.contains("window: Window"),
            "{anchor}: Tauri injects the window:\n{body}"
        );
        assert_reserve_register_confirm(&body, anchor, "watch_seeded(");
    }
}

#[test]
fn d173_wi1_w2_save_as_reserves_confirms_or_releases() {
    let anchor = "pub async fn save_file_dialog(";
    let body = code_of(FILE_SRC, anchor);
    assert!(
        body.contains("window: Window"),
        "{anchor}: the window is used, not `_window`:\n{body}"
    );
    assert!(body.contains("save_as_post_picker("));
    let transaction = code_of(TRANSACTION_SRC, "pub(crate) async fn save_as_post_picker(");
    assert_reserve_register_confirm(&transaction, anchor, "save_as_watched_with(");
    let refused = at(&body, "refused_save_as(", anchor);
    let call = at(&body, "save_as_post_picker(", anchor);
    assert!(refused < call, "a refused Save As reserves nothing:\n{body}");
    let release = at(&transaction, "release_hold(", anchor);
    assert!(
        release > at(&transaction, "save_as_watched_with(", anchor),
        "a failed Save As releases its reservation:\n{transaction}"
    );
}

#[test]
fn d173_wi1_w3_recover_reserves_with_the_callers_label() {
    let body = code_of(RECOVER_SRC, "fn watch_recovered(");
    assert_reserve_register_confirm(&body, "watch_recovered", ".watch(");
    let outer = code_of(RECOVER_SRC, "pub(crate) fn recover_draft_watched_with(");
    assert!(
        outer.contains("window_label"),
        "the caller's window label reaches watch_recovered:\n{outer}"
    );
}

#[test]
fn d173_wi1_w4_close_document_does_not_unwatch() {
    let body = code_of(FILE_SRC, "pub async fn close_document(");
    assert!(body.lines().count() > 3, "non-vacuity:\n{body}");
    assert!(!body.contains("unwatch("), "close_document unwatches:\n{body}");
    for (name, src) in [
        ("file.rs", FILE_SRC),
        ("save_as_watch.rs", SAVE_AS_SRC),
        ("draft_recover_watch.rs", RECOVER_SRC),
    ] {
        let prod = production(src);
        assert!(
            !prod.contains(".unwatch("),
            "{name}: production calls unwatch directly; release a hold instead"
        );
    }
}

#[test]
fn d173_wi1_w5_destroyed_releases_the_window_and_close_requested_does_not() {
    let prod = production(MAIN_SRC);
    let calls: Vec<usize> = prod.match_indices("release_window(").map(|(i, _)| i).collect();
    assert_eq!(calls.len(), 1, "one release_window call in main.rs:\n{prod}");
    let before = &prod[..calls[0]];
    let arm = before
        .rfind("WindowEvent::")
        .map(|i| &before[i..])
        .unwrap_or_else(|| panic!("release_window is not in a WindowEvent arm"));
    assert!(
        arm.starts_with("WindowEvent::Destroyed"),
        "release_window runs on Destroyed only:\n{arm}"
    );
    assert!(
        before.contains("try_state::<FileWatcher>") || arm.contains("try_state::<FileWatcher>"),
        "the watcher is reached through try_state:\n{arm}"
    );
}

#[test]
fn d173_wi1_w6_release_watch_hold_is_registered() {
    let handlers = code_of(MOD_SRC, "pub fn handlers(");
    assert!(
        handlers.contains("watch_hold::release_watch_hold"),
        "release_watch_hold is not registered:\n{handlers}"
    );
    assert!(MOD_SRC.contains("pub mod watch_hold;"));
}
