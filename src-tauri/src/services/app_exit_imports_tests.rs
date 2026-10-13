//! D190-WI-4, audit b106 H1: the imports the shared `app.run` closure needs
//! must not be macOS-only.
//!
//! The Exit arm moved out of the macOS-only closure, but `use tauri::RunEvent;`
//! and `use tauri_app_lib::services::app_exit;` kept their
//! `#[cfg(target_os = "macos")]`, so Windows and Linux failed to compile
//! (E0433 in PR #422's ubuntu job). The macOS host compiles either way, so the
//! gate is pinned on the source.

fn main_source() -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs");
    std::fs::read_to_string(path).expect("main.rs is readable")
}

fn import_is_macos_only(src: &str, import: &str) -> bool {
    let lines: Vec<&str> = src.lines().map(str::trim).collect();
    lines.iter().enumerate().any(|(i, line)| {
        *line == import && i > 0 && lines[i - 1].starts_with("#[cfg(target_os = \"macos\")]")
    })
}

#[test]
fn ai1_run_event_and_app_exit_are_imported_on_every_target() {
    let src = main_source();
    for import in [
        "use tauri::RunEvent;",
        "use tauri_app_lib::services::app_exit;",
    ] {
        assert!(src.contains(import), "main.rs imports `{import}`");
        assert!(
            !import_is_macos_only(&src, import),
            "`{import}` is gated to macOS but the shared run loop uses it on every target"
        );
    }
}
