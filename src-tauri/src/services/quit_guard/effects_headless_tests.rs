//! D190-WI-4 (delegator ruling, decision 1): the off-macOS `native_fallback`.
//!
//! Off macOS no alert is drawn: a timeout reports `false` so the driver hands
//! the request back to the windows, and the escape posts the headless answer
//! (`headless_fallback_answer`) to the guard on the main thread, as the macOS
//! alert posts its button. The branch is compiled only off macOS, so it is
//! pinned on the normalized source.

fn normalized_effects_source() -> String {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/services/quit_guard/effects.rs"
    );
    let source = std::fs::read_to_string(path).expect("effects.rs is readable");
    source.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn eh1_off_macos_fallback_answers_the_escape_and_releases_a_timeout() {
    let src = normalized_effects_source();
    let start = src
        .find("fn native_fallback(")
        .expect("native_fallback exists");
    let body = &src[start..];
    let body = &body[..body.find("#[cfg(test)]").unwrap_or(body.len())];
    let marker = "#[cfg(not(target_os = \"macos\"))]";
    let off_mac = &body[body.find(marker).expect("an off-macOS branch") + marker.len()..];
    for needle in [
        "headless_fallback_answer(cause)",
        "run_on_main_thread(",
        "deliver_fallback(",
        "try_state::<AppQuitGuard>()",
        "None => false",
    ] {
        assert!(
            off_mac.contains(needle),
            "off-macOS native_fallback lacks {needle}: {off_mac}"
        );
    }
}
