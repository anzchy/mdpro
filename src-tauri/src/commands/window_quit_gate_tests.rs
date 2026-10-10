//! D74 — source pin: both window-building sites consult the quit guard's
//! new-window gate before they build, and the route glue applies it to the
//! plan.
//!
//! **Below Level 6: source-text inspection, a supplement only.** The gate's
//! behaviour is specified by `quit_guard/window_gate_tests.rs` and
//! `open_route/quit_pending_tests.rs`; what neither can see is whether the two
//! Tauri sites call it, because no lane cheaper than the device builds a live
//! `WebviewWindowBuilder`. The real check is the D74 device step.

/// The gate both sites call.
const GATE: &str = "new_window_gate(";
/// The builder the gate must precede.
const BUILD: &str = "WebviewWindowBuilder::new(";
/// The plan transform the route glue must apply.
const PLAN_GATE: &str = ".with_quit_pending(";

fn raw(rel: &str) -> String {
    let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path} unreadable: {e}"))
}

/// The text of `fn <name>` up to the next top-level `fn`.
fn fn_body(source: &str, name: &str) -> String {
    let start = source
        .find(&format!("fn {name}("))
        .unwrap_or_else(|| panic!("fn {name} not found"));
    let rest = &source[start..];
    let end = rest[1..].find("\npub fn ").map_or(rest.len(), |i| i + 1);
    let end = rest[1..end].find("\nfn ").map_or(end, |i| i + 1);
    rest[..end].to_string()
}

fn assert_gate_before_build(body: &str, site: &str) {
    let gate = body
        .find(GATE)
        .unwrap_or_else(|| panic!("{site} must call {GATE} (D74)"));
    let build = body
        .find(BUILD)
        .unwrap_or_else(|| panic!("{site} no longer builds a window?"));
    assert!(gate < build, "{site}: the gate must run before {BUILD}");
}

#[test]
fn d74_create_window_checks_the_gate_before_building() {
    let src = raw("src/commands/window.rs");
    assert_gate_before_build(&fn_body(&src, "create_window"), "create_window");
}

#[test]
fn d74_route_external_open_gates_the_plan() {
    let src = raw("src/services/open_route/tauri_glue.rs");
    let body = fn_body(&src, "route_external_open");
    let gate = body
        .find(GATE)
        .expect("route_external_open must read the gate (D74)");
    let applied = body
        .find(PLAN_GATE)
        .expect("route_external_open must apply the gate to the plan (D74)");
    let executed = body.find("execute_plan(").expect("executes the plan");
    assert!(gate < applied && applied < executed);
}
