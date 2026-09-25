//! WI-3 (plan-20260925-232104) contract checks cc1, cc2, cc2b and cc3: the
//! production fallback adapter forwards its `FallbackCause`, takes its wording
//! from `fallback_alert_text`, puts `title` into the message text and `body`
//! into the informative text, and keeps the buttons as they were.
//!
//! Source-text contracts, like the rest of `effects_contract_tests.rs`: the
//! wiring needs an `AppHandle` and a display to exercise. The helper names are
//! the contract: renaming one fails here on purpose. Every check is tolerant of
//! rustfmt wrapping a call over several lines (`call_expr`).

use super::{body_of, discards, first_line, EFFECTS, MACOS};

/// The call expression starting at `callee` (e.g. "setMessageText("), up to its
/// balanced closing paren, with the body's lines joined by a space.
fn call_expr(body: &[(usize, &str)], callee: &str) -> String {
    let joined = body.iter().map(|(_, l)| *l).collect::<Vec<_>>().join(" ");
    let start = joined
        .find(callee)
        .unwrap_or_else(|| panic!("{callee:?} is not in the body"));
    let mut depth = 0i32;
    for (i, c) in joined[start..].char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return joined[start..=start + i].to_string();
                }
            }
            _ => {}
        }
    }
    panic!("{callee:?} does not close its parenthesis");
}

/// Identifier tokens of `s` (split on every char that is not [A-Za-z0-9_]).
fn idents(s: &str) -> Vec<&str> {
    s.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|t| !t.is_empty())
        .collect()
}

fn has_adjacent(tokens: &[&str], pair: [&str; 2]) -> bool {
    tokens.windows(2).any(|w| w == pair)
}

const CAUSE_LITERALS: [&str; 2] = ["FallbackCause::Timeout", "FallbackCause::Escape"];
const WORDING: [&str; 3] = ["isn’t responding", "didn’t answer", "Stop waiting"];

#[test]
fn cc1_native_fallback_forwards_its_cause_parameter() {
    let body = body_of(EFFECTS, "fn native_fallback(");
    let open = body
        .iter()
        .position(|(_, l)| l.contains('{'))
        .expect("native_fallback has a body");
    let signature: String = body[..=open].iter().map(|(_, l)| *l).collect();
    assert!(
        signature.contains("cause: FallbackCause"),
        "signature must take `cause: FallbackCause`: {signature}"
    );

    let call = call_expr(&body, "present_fallback_alert(");
    assert!(
        idents(&call).contains(&"cause"),
        "present_fallback_alert must receive `cause`: {call}"
    );
    for (i, line) in &body {
        assert!(
            !CAUSE_LITERALS.iter().any(|lit| line.contains(lit)),
            "line {i} hard-codes a cause: {line}"
        );
    }

    let mac = first_line(&body, &["#[cfg(target_os = \"macos\")]"]).expect("a macOS branch");
    let other = first_line(&body, &["#[cfg(not("]).expect("a non-macOS branch");
    for (i, line) in body.iter().filter(|(i, _)| mac < *i && *i < other) {
        assert!(
            !discards(line, "cause"),
            "line {i} discards `cause` on macOS: {line}"
        );
    }
}

#[test]
fn cc2_the_alert_text_comes_from_fallback_alert_text_of_the_cause() {
    let body = body_of(MACOS, "fn present_fallback_alert(");
    let call = call_expr(&body, "fallback_alert_text(");
    assert!(
        idents(&call).contains(&"cause"),
        "fallback_alert_text must receive `cause`: {call}"
    );
    for (i, line) in &body {
        assert!(
            !CAUSE_LITERALS.iter().any(|lit| line.contains(lit)),
            "line {i} hard-codes a cause: {line}"
        );
    }

    for (name, source) in [("macos.rs", MACOS), ("effects.rs", EFFECTS)] {
        for words in WORDING {
            assert!(
                !source.contains(words),
                "{name} still holds alert wording {words:?}"
            );
        }
        assert!(
            !source.contains("present_timeout_alert"),
            "{name} still names present_timeout_alert"
        );
    }
    assert!(
        MACOS.contains("KEEP_OPEN_TITLE"),
        "buttons stay in macos.rs"
    );
    assert!(
        MACOS.contains("QUIT_ANYWAY_TITLE"),
        "buttons stay in macos.rs"
    );
}

#[test]
fn cc2b_title_goes_to_the_message_text_and_body_to_the_informative_text() {
    let body = body_of(MACOS, "fn present_fallback_alert(");
    for setter in ["setMessageText(", "setInformativeText("] {
        let count = body
            .iter()
            .map(|(_, l)| l.matches(setter).count())
            .sum::<usize>();
        assert_eq!(count, 1, "{setter} must appear exactly once in the body");
    }

    let msg_call = call_expr(&body, "setMessageText(");
    let info_call = call_expr(&body, "setInformativeText(");
    let (msg, info) = (idents(&msg_call), idents(&info_call));
    assert!(
        msg.contains(&"title") && !msg.contains(&"body"),
        "setMessageText must take the title: {msg_call}"
    );
    assert!(
        info.contains(&"body") && !info.contains(&"title"),
        "setInformativeText must take the body: {info_call}"
    );
    assert!(
        has_adjacent(&msg, ["text", "title"]),
        "setMessageText must read `text.title`: {msg_call}"
    );
    assert!(
        has_adjacent(&info, ["text", "body"]),
        "setInformativeText must read `text.body`: {info_call}"
    );

    let at = body
        .iter()
        .position(|(_, l)| l.contains("let text ="))
        .expect("present_fallback_alert binds `let text =`");
    let joined = body[at..]
        .iter()
        .map(|(_, l)| *l)
        .collect::<Vec<_>>()
        .join(" ");
    let from = joined
        .find("let text =")
        .expect("let text = is on this line");
    let stmt = joined[from..].split(';').next().unwrap_or("");
    let bound = call_expr(&[(0, stmt)], "fallback_alert_text(");
    assert_eq!(
        bound.split_whitespace().collect::<String>(),
        "fallback_alert_text(cause)",
        "`let text =` must bind fallback_alert_text(cause): {stmt}"
    );
}

#[test]
fn cc3_buttons_and_key_equivalents_are_unchanged() {
    let body = body_of(MACOS, "fn present_fallback_alert(");
    let keep = first_line(&body, &["KEEP_OPEN_TITLE"]).expect("Keep Open is added");
    let quit = first_line(&body, &["QUIT_ANYWAY_TITLE"]).expect("Quit Without Saving is added");
    assert!(
        keep < quit,
        "Keep Open must be added first (default, Return): {keep} {quit}"
    );

    let key = call_expr(&body, "setKeyEquivalent(");
    assert!(
        key.contains("\"\""),
        "Quit Without Saving keeps an empty key equivalent: {key}"
    );
    let answer = call_expr(&body, "fallback_answer_for(");
    assert!(
        answer.contains("runModal()"),
        "the runModal result maps through fallback_answer_for: {answer}"
    );
    assert!(
        first_line(&body, &["deliver_fallback("]).is_some(),
        "the answer goes through deliver_fallback"
    );
}
