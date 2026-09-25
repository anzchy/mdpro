//! D16F WI-8 contract checks ([ADV1-5] a, b, d, e and [ADV2-2]): the production
//! call sites route through the extracted helpers and discard nothing.
//!
//! These read the source text, because the wiring they pin needs an
//! `AppHandle` to exercise. The helper names are the contract: renaming one
//! fails here on purpose.

const EFFECTS: &str = include_str!("effects.rs");
const MACOS: &str = include_str!("macos.rs");

/// `let _ = <anything without ';'> needle` on one line — the grep
/// `let _ *= *[^;]*needle`.
fn discards(line: &str, needle: &str) -> bool {
    let mut rest = line;
    while let Some(at) = rest.find("let _") {
        let after = rest[at + "let _".len()..].trim_start();
        if let Some(rhs) = after.strip_prefix('=') {
            let stmt = rhs.split(';').next().unwrap_or("");
            if stmt.contains(needle) {
                return true;
            }
        }
        rest = &rest[at + 1..];
    }
    false
}

fn count_discards(source: &str, needles: &[&str]) -> usize {
    source
        .lines()
        .filter(|l| needles.iter().any(|n| discards(l, n)))
        .count()
}

/// The lines of the item whose signature line contains `signature`, from that
/// line to the brace that closes it, with their 0-based line numbers.
fn body_of<'a>(source: &'a str, signature: &str) -> Vec<(usize, &'a str)> {
    let lines: Vec<&str> = source.lines().collect();
    let start = lines
        .iter()
        .position(|l| l.contains(signature))
        .unwrap_or_else(|| panic!("{signature:?} is not in the source"));
    let mut depth = 0i32;
    let mut opened = false;
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate().skip(start) {
        out.push((i, *line));
        for c in line.chars() {
            match c {
                '{' => {
                    depth += 1;
                    opened = true;
                }
                '}' => depth -= 1,
                _ => {}
            }
        }
        if opened && depth == 0 {
            break;
        }
    }
    out
}

fn first_line(body: &[(usize, &str)], needles: &[&str]) -> Option<usize> {
    body.iter()
        .find(|(_, l)| needles.iter().any(|n| l.contains(n)))
        .map(|(i, _)| *i)
}

#[test]
fn wi8_adv1_5a_arm_timer_reports_its_dispatch() {
    let body = body_of(EFFECTS, "fn arm_timer(");
    assert!(
        body.iter().any(|(_, l)| l.contains("report_dispatch(")),
        "arm_timer must route its run_on_main_thread result through report_dispatch"
    );
}

#[test]
fn wi8_adv1_5b_no_main_thread_dispatch_is_discarded() {
    assert_eq!(
        count_discards(EFFECTS, &["run_on_main_thread"]),
        0,
        "effects.rs"
    );
    assert_eq!(
        count_discards(MACOS, &["run_on_main_thread"]),
        0,
        "macos.rs"
    );
}

#[test]
fn wi8_adv1_5d_activate_goes_through_run_activation() {
    assert!(
        EFFECTS.matches("run_activation(").count() >= 1,
        "effects.rs must call run_activation("
    );
}

#[test]
fn wi8_adv1_5e_no_window_call_result_is_discarded() {
    assert_eq!(
        count_discards(EFFECTS, &[".unminimize(", ".show(", ".set_focus("]),
        0
    );
}

/// [ADV2-2] The app is activated before the window calls (ADR-0025 §2), and
/// all four steps are built inside the one `run_activation(` call.
#[test]
fn wi8_adv2_2_app_activation_precedes_the_window_calls() {
    let body = body_of(EFFECTS, "fn activate(&self");
    let dispatch = first_line(&body, &["activate_app", "run_on_main_thread"]);
    let unminimize = first_line(&body, &["unminimize"]);
    let show = first_line(&body, &["show"]);
    let focus = first_line(&body, &["set_focus"]);
    let (Some(d), Some(u), Some(s), Some(f)) = (dispatch, unminimize, show, focus) else {
        panic!(
            "all four steps must be in activate: {dispatch:?} {unminimize:?} {show:?} {focus:?}"
        );
    };
    assert!(
        d < u && u < s && s < f,
        "order must be dispatch<unminimize<show<set_focus: {d} {u} {s} {f}"
    );

    let call = first_line(&body, &["run_activation("]).expect("activate calls run_activation(");
    let mut depth = 0i32;
    let mut close = None;
    for (i, line) in body.iter().filter(|(i, _)| *i >= call) {
        let from = if *i == call {
            line.find("run_activation(").unwrap()
        } else {
            0
        };
        for c in line[from..].chars() {
            match c {
                '(' => depth += 1,
                ')' => depth -= 1,
                _ => {}
            }
        }
        if depth == 0 {
            close = Some(*i);
            break;
        }
    }
    let close = close.expect("run_activation( call closes");
    for (name, at) in [
        ("dispatch", d),
        ("unminimize", u),
        ("show", s),
        ("set_focus", f),
    ] {
        assert!(
            call <= at && at <= close,
            "{name} (line {at}) must be inside run_activation( ({call}..={close})"
        );
    }
}

// WI-3 (plan-20260925-232104): the fallback alert adapter's contracts.
#[path = "effects_alert_contract_tests.rs"]
mod effects_alert_contract_tests;
