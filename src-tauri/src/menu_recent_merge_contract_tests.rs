//! Contract tests for `RecentOp` and `apply_recent_op` against the shared
//! Rust ↔ TS fixture `tests/fixtures/recent-files-ops.json` (D43, WI-2,
//! OP-01, OP-04..OP-06). The TS half is `tests/recent-files-ops-parity.test.ts`.

use super::super::*;
use super::{below, gen_list, rng, v, ALPHABET};
use serde_json::{json, Value};

const FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/recent-files-ops.json"
));

fn fixture() -> Value {
    let parsed: Result<Value, _> = serde_json::from_str(FIXTURE);
    assert!(
        parsed.is_ok(),
        "the shared fixture must parse: {:?}",
        parsed.as_ref().err()
    );
    parsed.unwrap_or(Value::Null)
}

fn rows(fx: &Value, key: &str) -> Vec<Value> {
    let list = fx[key].as_array().cloned().unwrap_or_default();
    assert!(!list.is_empty(), "fixture section `{key}` must have rows");
    list
}

fn strings(value: &Value, what: &str) -> Vec<String> {
    let decoded: Result<Vec<String>, _> = serde_json::from_value(value.clone());
    assert!(
        decoded.is_ok(),
        "{what} must be a string array, got {value}"
    );
    decoded.unwrap_or_default()
}

fn name(row: &Value) -> String {
    row["name"].as_str().unwrap_or("<unnamed>").to_string()
}

#[test]
fn op_01_rust_matches_every_fixture_row_and_the_cap_agrees() {
    let fx = fixture();
    assert_eq!(fx["maxRecentFiles"].as_u64(), Some(MAX_RECENT_FILES as u64));
    for row in rows(&fx, "push") {
        let n = name(&row);
        let list = strings(&row["list"], &n);
        let path = row["path"].as_str().unwrap_or_default().to_string();
        let out = apply_recent_op(&list, &RecentOp::Record { path });
        assert_eq!(out, strings(&row["expected"], &n), "push row {n}");
    }
    for row in rows(&fx, "merge") {
        let n = name(&row);
        let op = RecentOp::Seed {
            stored: Some(strings(&row["stored"], &n)),
            pending_newest_first: strings(&row["pendingNewestFirst"], &n),
        };
        assert_eq!(
            apply_recent_op(&[], &op),
            strings(&row["expected"], &n),
            "merge row {n}"
        );
    }
    for row in rows(&fx, "seed") {
        let n = name(&row);
        let stored = if row["stored"].is_null() {
            None
        } else {
            Some(strings(&row["stored"], &n))
        };
        let op = RecentOp::Seed {
            stored,
            pending_newest_first: strings(&row["pendingNewestFirst"], &n),
        };
        let out = apply_recent_op(&strings(&row["current"], &n), &op);
        assert_eq!(out, strings(&row["expected"], &n), "seed row {n}");
    }
}

#[test]
fn op_04_rust_decodes_every_wire_row_to_the_intended_variant() {
    let fx = fixture();
    let expected = |n: &str| -> Option<RecentOp> {
        match n {
            "seed-stored" => Some(RecentOp::Seed {
                stored: Some(v(&["/a.md"])),
                pending_newest_first: v(&["/b.md"]),
            }),
            "seed-null" => Some(RecentOp::Seed {
                stored: None,
                pending_newest_first: v(&["/a.md"]),
            }),
            "record" => Some(RecentOp::Record {
                path: "/a.md".to_string(),
            }),
            "refresh" => Some(RecentOp::Refresh),
            _ => None,
        }
    };
    for row in rows(&fx, "wire") {
        let n = name(&row);
        let decoded = serde_json::from_value::<RecentOp>(row["op"].clone());
        assert!(
            decoded.is_ok(),
            "wire row {n} must decode: {:?}",
            decoded.as_ref().err()
        );
        let want = expected(&n);
        assert!(want.is_some(), "unexpected wire row {n}");
        assert_eq!(decoded.ok(), want, "wire row {n}");
    }
}

#[test]
fn op_05_wire_round_trip() {
    let fx = fixture();
    for row in rows(&fx, "wire") {
        let n = name(&row);
        let decoded = serde_json::from_value::<RecentOp>(row["op"].clone());
        assert!(decoded.is_ok(), "wire row {n} must decode");
        let back = decoded.ok().map(|op| serde_json::to_value(op).ok());
        assert_eq!(
            back,
            Some(Some(row["op"].clone())),
            "wire row {n} round-trip"
        );
    }
    let seed_v = 0xD43_0105;
    let mut r = rng(seed_v);
    for case in 0..300 {
        let op = match below(&mut r, 3) {
            0 => RecentOp::Seed {
                stored: if below(&mut r, 2) == 0 {
                    None
                } else {
                    Some(gen_list(&mut r, 4))
                },
                pending_newest_first: gen_list(&mut r, 4),
            },
            1 => RecentOp::Record {
                path: ALPHABET[below(&mut r, ALPHABET.len())].to_string(),
            },
            _ => RecentOp::Refresh,
        };
        let back = serde_json::to_value(&op)
            .ok()
            .and_then(|w| serde_json::from_value::<RecentOp>(w).ok());
        assert_eq!(
            back,
            Some(op.clone()),
            "seed={seed_v:#x} case={case} input={op:?}"
        );
    }
}

#[test]
fn op_06_malformed_wire_is_an_error_never_a_panic() {
    let cases = [
        ("unknown kind", json!({"kind": "wipe"})),
        ("record without path", json!({"kind": "record"})),
        (
            "seed with string stored",
            json!({"kind": "seed", "stored": "x", "pendingNewestFirst": []}),
        ),
        (
            "seed without pending",
            json!({"kind": "seed", "stored": null}),
        ),
        ("empty object", json!({})),
    ];
    for (n, wire) in cases {
        let r = serde_json::from_value::<RecentOp>(wire);
        assert!(r.is_err(), "{n}");
    }
}
