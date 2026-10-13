//! D190-WI-4: off macOS, the production `reply(true)` is the exit.
//!
//! On macOS `reply` answers the deferred `applicationShouldTerminate:` and
//! AppKit ends the process, which reaches `RunEvent::Exit` and the server-file
//! cleanup. Off macOS there is no deferred terminate, so `reply(true)` itself
//! must ask Tauri to exit (`AppHandle::exit` -> `ExitRequested` -> `Exit`), and
//! `reply(false)` must not. The branch is compiled only on Windows and Linux,
//! and `TauriQuitEffects` needs a live `AppHandle`, so it is pinned on the
//! normalized source here; the Windows device check covers the real path.

/// `effects.rs` with every whitespace run collapsed to one space.
fn normalized_effects_source() -> String {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/services/quit_guard/effects.rs"
    );
    let source = std::fs::read_to_string(path).expect("effects.rs is readable");
    source.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The body of `fn reply(` up to the next `fn ` in the impl.
fn reply_body(src: &str) -> &str {
    let start = src
        .find("fn reply(&self, terminate: bool) -> bool {")
        .expect("TauriQuitEffects::reply exists");
    let rest = &src[start..];
    let end = rest[3..].find(" fn ").map_or(rest.len(), |i| i + 3);
    &rest[..end]
}

#[test]
fn ex1_off_macos_reply_true_asks_tauri_to_exit_and_false_does_not() {
    let src = normalized_effects_source();
    let body = reply_body(&src);
    let marker = "#[cfg(not(target_os = \"macos\"))]";
    let off_mac = &body[body.find(marker).expect("an off-macOS branch") + marker.len()..];
    assert!(
        off_mac.contains("if terminate {"),
        "off macOS the exit must be conditional on `terminate`: {off_mac}"
    );
    assert!(
        off_mac.contains(".exit(0)"),
        "off macOS reply(true) must call AppHandle::exit(0): {off_mac}"
    );
    assert!(
        !off_mac.contains("std::process::exit"),
        "the exit must go through Tauri so RunEvent::Exit runs the cleanup"
    );
    assert!(
        !off_mac.contains("let _ = terminate; true"),
        "the off-macOS reply is no longer a no-op: {off_mac}"
    );
}
