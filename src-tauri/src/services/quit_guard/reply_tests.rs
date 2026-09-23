//! WI3-D6: the wire contract of `QuitAnswer`.
//!
//! The frontend sends this string across IPC, so the accepted set has to be
//! exactly four values. Anything else — a typo, a capitalisation, a null — must
//! be refused at the boundary rather than silently taken for one of them.

use super::QuitAnswer;

const WIRE: [(QuitAnswer, &str); 4] = [
    (QuitAnswer::Clean, "clean"),
    (QuitAnswer::Dirty, "dirty"),
    (QuitAnswer::Discard, "discard"),
    (QuitAnswer::Cancel, "cancel"),
];

#[test]
fn d6_quit_answer_round_trips_through_its_exact_wire_value() {
    for (answer, wire) in WIRE {
        let json = serde_json::to_string(&answer).unwrap();
        assert_eq!(json, format!("\"{wire}\""), "{answer:?} serialised wrong");
        let back: QuitAnswer = serde_json::from_str(&json).unwrap();
        assert_eq!(back, answer, "{answer:?} did not survive a round trip");
        let parsed: QuitAnswer = serde_json::from_str(&format!("\"{wire}\"")).unwrap();
        assert_eq!(parsed, answer, "{wire:?} parsed to the wrong variant");
    }
}

#[test]
fn d6_quit_answer_refuses_everything_else() {
    for bad in [
        "\"maybe\"",
        "\"Discard\"",
        "\"DISCARD\"",
        "\"\"",
        "null",
        "1",
        "\" discard\"",
        "\"discard \"",
        "{\"answer\":\"discard\"}",
    ] {
        let parsed = serde_json::from_str::<QuitAnswer>(bad);
        assert!(parsed.is_err(), "{bad} was accepted as {:?}", parsed.ok());
    }
}
