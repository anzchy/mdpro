//! ADR-0035 WI-4 (A5): the wire payload every `app:quit-*` event carries
//! (EP-1, EP-2).
//!
//! Registered from `effects.rs` with `#[cfg(test)] #[path]`, so the private
//! `QuitEventPayload` is reachable. No law: a fixed-shape serializer, pinned
//! as an exact contract example.

use super::super::driver::QuitEvent;
use super::QuitEventPayload;
use serde_json::json;

#[test]
fn ep1_every_event_serializes_request_id_and_round_only() {
    let events = [
        QuitEvent::Requested {
            request_id: 42,
            round: 3,
        },
        QuitEvent::Prompt {
            request_id: 42,
            round: 3,
        },
        QuitEvent::Cancelled {
            request_id: 42,
            round: 3,
        },
        QuitEvent::Backstop {
            request_id: 42,
            round: 3,
        },
    ];
    for event in events {
        assert_eq!(
            serde_json::to_value(QuitEventPayload::from(event)).unwrap(),
            json!({ "requestId": 42, "round": 3 }),
            "{event:?}"
        );
    }
}

#[test]
fn ep2_the_backstop_event_name() {
    let event = QuitEvent::Backstop {
        request_id: 1,
        round: 0,
    };
    assert_eq!(event.name(), "app:quit-backstop");
}
