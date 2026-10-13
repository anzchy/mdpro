//! D190-WI-4: `RunEvent::Exit` runs `run_exit_cleanup` on every target.
//!
//! Until now the macOS `app.run` closure was the only one with the Exit arm;
//! the off-macOS loop was `app.run(|_, _| {})`, so a Windows exit by any route
//! (Exit menu, the last window closed) left `server.port` / `server.token`
//! behind (W4). `main.rs` is the binary and its closure needs a live app, so
//! the wiring is pinned on the normalized source.

fn normalized_main_source() -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs");
    let source = std::fs::read_to_string(path).expect("main.rs is readable");
    source.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn aw1_every_run_loop_routes_exit_to_the_cleanup() {
    let src = normalized_main_source();
    let loops: Vec<&str> = src.split("app.run(").skip(1).collect();
    assert!(!loops.is_empty(), "main.rs runs the app");
    for (i, body) in loops.iter().enumerate() {
        assert!(
            body.contains("RunEvent::Exit") && body.contains("run_exit_cleanup("),
            "run loop {i} does not route RunEvent::Exit to run_exit_cleanup: {}",
            &body[..body.len().min(200)]
        );
    }
    assert!(
        !src.contains("app.run(|_, _| {})"),
        "no target may run a loop that ignores RunEvent::Exit"
    );
}
