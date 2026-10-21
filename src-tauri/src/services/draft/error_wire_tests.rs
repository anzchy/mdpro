//! D27 WI-2 g2-g4: the `DraftError` wire shape the frontend classifier
//! depends on, its serde round-trip, and `kind()` / `Display` redaction.
use super::*;
use serde_json::json;

fn all_with(id: &str, message: &str) -> Vec<DraftError> {
    vec![
        DraftError::IoError {
            message: message.to_string(),
        },
        DraftError::NotFound {
            document_id: id.to_string(),
        },
        DraftError::ParseError {
            message: message.to_string(),
        },
        DraftError::OwnedByLiveWindow,
        DraftError::OpenInWindow,
        DraftError::ShadowStoreUnavailable,
    ]
}

fn v(e: &DraftError) -> serde_json::Value {
    serde_json::to_value(e).expect("serialize DraftError")
}

#[test]
fn g2_wire_shapes() {
    assert_eq!(v(&DraftError::OpenInWindow), json!("OpenInWindow"));
    assert_eq!(
        v(&DraftError::ShadowStoreUnavailable),
        json!("ShadowStoreUnavailable")
    );
    assert_eq!(
        v(&DraftError::OwnedByLiveWindow),
        json!("OwnedByLiveWindow")
    );
    assert_eq!(
        v(&DraftError::NotFound {
            document_id: "x".into()
        }),
        json!({"NotFound":{"document_id":"x"}})
    );
    assert_eq!(
        v(&DraftError::IoError {
            message: "m".into()
        }),
        json!({"IoError":{"message":"m"}})
    );
    assert_eq!(
        v(&DraftError::ParseError {
            message: "m".into()
        }),
        json!({"ParseError":{"message":"m"}})
    );
}

#[test]
fn g3_every_variant_round_trips() {
    for payload in ["id-with-\"quote\"-and-/", ""] {
        for e in all_with(payload, payload) {
            let wire = v(&e);
            let back: DraftError = serde_json::from_value(wire.clone()).expect("deserialize");
            assert_eq!(v(&back), wire, "round-trip of {e:?}");
            assert_eq!(back.kind(), e.kind());
        }
    }
}

#[test]
fn g4_kind_is_fixed_per_variant_and_never_carries_the_payload() {
    let expected = [
        "IoError",
        "NotFound",
        "ParseError",
        "OwnedByLiveWindow",
        "OpenInWindow",
        "ShadowStoreUnavailable",
    ];
    let sentinel = all_with("SENTINEL-ID-9", "/Users/x/SENTINEL.md");
    let empty = all_with("", "");
    for (i, (s, e)) in sentinel.iter().zip(empty.iter()).enumerate() {
        assert_eq!(s.kind(), expected[i]);
        assert_eq!(s.kind(), e.kind(), "kind() depends on the payload");
        assert!(!s.kind().contains("SENTINEL"));
    }
    let kinds: std::collections::HashSet<_> = sentinel.iter().map(|e| e.kind()).collect();
    assert_eq!(kinds.len(), 6, "kinds are pairwise distinct");

    let owned = DraftError::OwnedByLiveWindow.to_string();
    let open = DraftError::OpenInWindow.to_string();
    assert!(!owned.is_empty() && !open.is_empty());
    assert_ne!(owned, open);
    assert!(!owned.contains("SENTINEL") && !open.contains("SENTINEL"));
}
