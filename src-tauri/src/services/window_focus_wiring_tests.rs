//! D217 / ADR47-WI004-1 wiring tripwires. Focus is recorded from `app.run`'s
//! `RunEvent::WindowEvent`, which reaches every window the runtime knows, and
//! never from `Builder::on_window_event`, whose per-window listener is
//! registered after the window is built and can miss a new window's first
//! focus. Pure source text, so ungated.

const MAIN_SRC: &str = include_str!("../main.rs");

/// `src` without comment lines, so a comment naming a token cannot satisfy or
/// trip a check.
fn code(src: &str) -> String {
    src.lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The text from `start` up to the next `end` after it.
fn slice<'a>(src: &'a str, start: &str, end: &str) -> &'a str {
    let from = src
        .find(start)
        .unwrap_or_else(|| panic!("main.rs has no `{start}`"));
    let rest = &src[from..];
    let to = rest
        .find(end)
        .unwrap_or_else(|| panic!("main.rs has no `{end}` after `{start}`"));
    &rest[..to]
}

#[test]
fn d217_on_window_event_no_longer_records_focus() {
    let main = code(MAIN_SRC);
    let body = slice(&main, ".on_window_event(", ".invoke_handler(");
    assert!(body.lines().count() > 10, "non-vacuity:\n{body}");
    for token in [
        "WindowEvent::Focused",
        "set_focused_window",
        "\"window.focus\"",
    ] {
        assert!(
            !body.contains(token),
            "on_window_event must not handle focus (`{token}`):\n{body}"
        );
    }
}

#[test]
fn d217_app_run_routes_focus_to_window_focus() {
    let main = code(MAIN_SRC);
    let from = main.find("app.run(").expect("main.rs has no `app.run(`");
    let run = &main[from..];
    let arm = run
        .find("RunEvent::WindowEvent")
        .unwrap_or_else(|| panic!("app.run has no RunEvent::WindowEvent arm:\n{run}"));
    let tail = &run[arm..];
    let focused = tail
        .find("WindowEvent::Focused(")
        .unwrap_or_else(|| panic!("the arm does not match Focused:\n{tail}"));
    let call = tail
        .find("window_focus::on_focus_event(")
        .unwrap_or_else(|| panic!("the arm does not call on_focus_event:\n{tail}"));
    assert!(
        focused < call,
        "Focused is matched before the call:\n{tail}"
    );
    assert!(
        tail[..call].contains("try_state::<SharedShadowStore>"),
        "the store is reached through try_state:\n{tail}"
    );
}

#[test]
fn d217_focus_is_recorded_in_exactly_one_place() {
    let main = code(MAIN_SRC);
    assert_eq!(
        main.matches("WindowEvent::Focused").count(),
        1,
        "one Focused match in main.rs"
    );
    assert_eq!(
        main.matches("on_focus_event(").count(),
        1,
        "one on_focus_event call in main.rs"
    );
}
