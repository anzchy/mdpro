//! D190-WI-4: the app menu's Quit item off macOS.
//!
//! On Windows muda answers the predefined Quit with `PostQuitMessage(0)`, so the
//! process ends without `ExitRequested`, without the quit guard and without
//! the ADR-0035 draft backstop. Off macOS the menu therefore carries a custom
//! Exit item whose click goes to `QuitGuard::request_quit`. `quit_item_for` is
//! pure and tested directly; the builder and the click arm need a live
//! `AppHandle`, so their wiring is pinned on the normalized source, as mn2 in
//! `menu_tests.rs` does for the escape item.

use super::*;

const NON_MAC_TARGETS: [&str; 5] = ["windows", "linux", "freebsd", "openbsd", "netbsd"];

fn raw_menu_source() -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/menu.rs");
    std::fs::read_to_string(path).expect("menu.rs is readable")
}

fn normalized_menu_source() -> String {
    raw_menu_source()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// mq1: macOS keeps AppKit's `terminate:` (guarded by the native hook).
#[test]
fn mq1_macos_keeps_the_predefined_quit() {
    assert_eq!(quit_item_for("macos"), QuitItem::Predefined);
}

/// mq2: every other desktop target gets the guarded item, never the
/// predefined one that bypasses the guard.
#[test]
fn mq2_every_non_mac_target_gets_the_guarded_quit() {
    for os in NON_MAC_TARGETS {
        assert_eq!(quit_item_for(os), QuitItem::Guarded, "target {os}");
    }
}

/// mq3: the guarded item has a fixed id, declared on one line in the shape the
/// ledger gate reads (`scripts/ledger/declared.mjs` MENU_ID_RE), distinct from
/// every other menu id and outside the recent-files prefix.
#[test]
fn mq3_quit_id_is_declared_once_and_distinct() {
    let raw = raw_menu_source();
    let declared = raw.lines().any(|l| {
        l.trim()
            .trim_start_matches("pub ")
            .trim_start_matches("(crate) ")
            == "const MENU_APP_QUIT: &str = \"menu.app.quit\";"
    });
    assert!(declared, "MENU_APP_QUIT is declared on one line");
    let values: Vec<&str> = raw
        .lines()
        .filter(|l| l.contains("const MENU_"))
        .filter_map(|l| l.split('"').nth(1))
        .collect();
    assert_eq!(
        values.iter().filter(|v| **v == "menu.app.quit").count(),
        1,
        "menu.app.quit is used by exactly one MENU_* const"
    );
    assert!(!"menu.app.quit".starts_with(MENU_FILE_RECENT_PREFIX));
}

/// mq4: `build_menu` picks the item for the running target, and the guarded
/// item is a custom "Exit" with no accelerator (Windows has no Exit shortcut;
/// Alt+F4 closes a window).
#[test]
fn mq4_build_menu_uses_the_target_choice_and_builds_exit() {
    let src = normalized_menu_source();
    let build = &src[src.find("pub fn build_menu(").expect("build_menu exists")..];
    let build = &build[..build.find("pub fn handle_menu_event(").expect("handler")];
    assert!(
        build.contains("quit_item_for(std::env::consts::OS)"),
        "build_menu chooses the Quit item for the running target"
    );
    let guarded = build
        .contains("MenuItem::with_id( app, MENU_APP_QUIT, \"Exit\", true, None::<&str>")
        || build.contains("MenuItem::with_id(app, MENU_APP_QUIT, \"Exit\", true, None::<&str>");
    assert!(
        guarded,
        "the guarded item is MenuItem \"Exit\", enabled, no accelerator"
    );
}

/// mq5: the click goes to the guard: one arm, a named helper that reads the
/// managed `AppQuitGuard`, takes a sorted window snapshot (ADR-0025 §2), calls
/// `request_quit`, exits when no guard is managed (setup never finished, as
/// the macOS hook does) and emits nothing to a webview.
#[test]
fn mq5_quit_click_routes_into_the_guard() {
    let src = normalized_menu_source();
    assert_eq!(
        src.matches("MENU_APP_QUIT => request_guarded_quit(app),")
            .count(),
        1,
        "exactly one arm, calling request_guarded_quit"
    );
    let start = src
        .find("fn request_guarded_quit(app: &AppHandle<Wry>)")
        .expect("the helper exists");
    let rest = &src[start..];
    let end = [
        rest[3..].find(" fn ").map(|i| i + 3),
        rest.find("#[cfg(test)]"),
    ]
    .into_iter()
    .flatten()
    .min()
    .unwrap_or(rest.len());
    let helper = &rest[..end];
    for needle in [
        "try_state::<AppQuitGuard>()",
        ".request_quit(",
        "webview_windows()",
        ".sort()",
        "exit(0)",
    ] {
        assert!(helper.contains(needle), "helper lacks {needle}: {helper}");
    }
    assert!(!helper.contains("emit"), "helper must not emit: {helper}");
}
