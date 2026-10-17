//! ADR-0047 WI-009 WI 4: the ANSI key table and modifier names (plan
//! WI-009 item 18), ported from the spike.
use super::*;

#[test]
fn named_keys_carry_their_ansi_codes() {
    for (name, code) in [
        ("Escape", 53),
        ("Enter", 36),
        ("Backspace", 51),
        ("ArrowLeft", 123),
        ("Tab", 48),
    ] {
        assert_eq!(
            press(name, NSEventModifierFlags::empty(), 1)
                .expect(name)
                .def
                .code,
            code,
            "{name}"
        );
    }
}

#[test]
fn a_single_printable_character_is_a_key() {
    let p = press("b", NSEventModifierFlags::empty(), 1).expect("b");
    assert_eq!(
        (p.def.code, p.def.plain.as_str(), p.def.shifted.as_str()),
        (11, "b", "B")
    );
}

#[test]
fn an_unknown_key_is_a_bad_request() {
    assert_eq!(
        press("F13", NSEventModifierFlags::empty(), 1)
            .err()
            .map(|f| f.code),
        Some("bad_request")
    );
}

#[test]
fn the_four_modifiers_and_nothing_else() {
    let all = ["shift", "cmd", "ctrl", "alt"].map(String::from);
    let f = mod_flags(&all).expect("known");
    for m in [
        NSEventModifierFlags::Shift,
        NSEventModifierFlags::Command,
        NSEventModifierFlags::Control,
        NSEventModifierFlags::Option,
    ] {
        assert!(f.contains(m));
    }
    assert_eq!(
        mod_flags(&["meta".to_string()]).unwrap_err().code,
        "bad_request"
    );
}

#[test]
fn text_is_printable_ascii_with_shift_where_needed() {
    let ps = text_presses("aA!").expect("ascii");
    let shifted: Vec<bool> = ps
        .iter()
        .map(|p| p.flags.contains(NSEventModifierFlags::Shift))
        .collect();
    assert_eq!(shifted, vec![false, true, true]);
    assert_eq!(text_presses("é").unwrap_err().code, "bad_request");
}
