//! ADR-0047 WI-009 WI 4: the page-script plumbing that runs without a
//! webview (plan WI-009 items 6, 13; spike S1.3).
use super::*;

#[test]
fn an_empty_slot_reads_as_none_with_its_drop_count() {
    let raw = json!(r#"{"r":null,"d":0}"#);
    assert_eq!(parse_reader(&raw).expect("parsed"), (None, 0));
}

#[test]
fn a_filled_slot_and_late_drops_are_both_returned() {
    let raw = json!(r#"{"r":{"ok":true,"v":7},"d":2}"#);
    let (slot, dropped) = parse_reader(&raw).expect("parsed");
    assert_eq!(slot, Some(json!({ "ok": true, "v": 7 })));
    assert_eq!(dropped, 2);
}

#[test]
fn a_reader_answer_that_is_not_its_json_is_a_script_error() {
    for raw in [
        json!(null),
        json!(3),
        json!("not json"),
        json!(r#"{"d":"x"}"#),
    ] {
        assert_eq!(
            parse_reader(&raw).unwrap_err().code,
            "script_error",
            "{raw}"
        );
    }
}

#[test]
fn caller_arguments_enter_a_template_only_as_a_json_literal() {
    let hostile = json!({ "value": "\"});alert(1);//" });
    let js = starter(
        &json!("id#1").to_string(),
        &body(&Script::Find),
        &hostile.to_string(),
    );
    assert!(js.contains(&hostile.to_string()));
    // Every quote that could close the string arrives escaped.
    let breakout = "\"});alert(1);";
    for (i, _) in js.match_indices(breakout) {
        assert_eq!(&js[i - 1..i], "\\", "an unescaped breakout at {i}");
    }
}

#[test]
fn a_late_settle_counts_a_drop_instead_of_filling_the_slot() {
    let js = starter(&json!("id#1").to_string(), &body(&Script::Probe), "{}");
    assert!(js.contains("S.__dropped=(S.__dropped||0)+1"));
}
