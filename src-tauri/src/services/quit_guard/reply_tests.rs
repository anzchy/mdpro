//! WI3-D6: the wire contract of `QuitAnswer`.
//!
//! The frontend sends this string across IPC, so the accepted set has to be
//! exactly six values — the four decisions, ADR-0029's `delivered` ack, and
//! ADR-0035's `drafted` backstop reply.
//! Anything else — a typo, a capitalisation, a null — must be refused at the
//! boundary rather than silently taken for one of them.

use super::{validate_discard_ids, QuitAnswer};

const WIRE: [(QuitAnswer, &str); 5] = [
    (QuitAnswer::Clean, "clean"),
    (QuitAnswer::Dirty, "dirty"),
    (QuitAnswer::Discard, "discard"),
    (QuitAnswer::Cancel, "cancel"),
    (QuitAnswer::Delivered, "delivered"),
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

/// ADR-0029 §1: `delivered` says the dialog reached the screen and nothing
/// else. It is not a decision, so it may not carry document ids — the same rule
/// `clean` and `cancel` are held to, for the same reason: a caller that sends
/// ids with a non-discard answer has a bug, and swallowing it hides which quit
/// deleted what.
#[test]
fn d6_delivered_may_not_carry_document_ids() {
    assert_eq!(
        validate_discard_ids(QuitAnswer::Delivered, None),
        Ok(Vec::new()),
        "a delivered ack with no ids is the ordinary case"
    );
    for ids in [vec![], vec!["d1".to_string()]] {
        let refused = validate_discard_ids(QuitAnswer::Delivered, Some(ids.clone()));
        assert!(
            refused.is_err(),
            "delivered with {ids:?} was accepted as {refused:?}"
        );
    }
}
