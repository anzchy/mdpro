//! D175 tests for the `releaseId` key of `app.ready`, split from
//! `app_ready_tests.rs` to keep both files under 300 lines.

use super::{app_ready_context, current_app_ready_context, with_release_id};
use serde_json::{json, Value};

/// The live `app.ready` key set since D175: the five above plus `releaseId`.
pub(super) const KEYS_WITH_RELEASE: [&str; 6] = [
    "appVersion",
    "buildId",
    "pid",
    "platform",
    "releaseId",
    "startupTimeMs",
];

fn v1() -> String {
    "0123456789abcdef".repeat(4)
}

fn sorted_keys(ctx: &Value) -> Vec<String> {
    let mut keys: Vec<String> = ctx
        .as_object()
        .expect("context is a JSON object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

fn release(version: &str) -> String {
    format!("{version}@0123456789abcdef0123456789abcdef01234567")
}

#[test]
fn t09_with_release_id_adds_exactly_that_key() {
    let base = app_ready_context(1234, "0.3.1", "macos", 4242, &v1());
    let r = release("0.3.1");
    let ctx = with_release_id(base.clone(), &r);
    let mut expected = base;
    expected["releaseId"] = json!(r);
    assert_eq!(ctx, expected);
    assert_eq!(sorted_keys(&ctx), KEYS_WITH_RELEASE);
}

#[test]
fn t10_release_id_flows_through_normalisation() {
    let (a, b) = (release("0.3.1"), release("1.2.3-rc.1"));
    let short = "0.3.1@0123456";
    let cases: [(Option<&str>, &str); 6] = [
        (Some(&a), &a),
        (Some(&b), &b),
        (None, "unknown"),
        (Some(""), "unknown"),
        (Some(short), "unknown"),
        (Some("release-0.3.1@0123456"), "unknown"),
    ];
    for (raw, expected) in cases {
        let ctx = current_app_ready_context(7, None, raw);
        assert_eq!(ctx["releaseId"].as_str(), Some(expected), "raw {raw:?}");
        assert_eq!(sorted_keys(&ctx), KEYS_WITH_RELEASE, "raw {raw:?}");
    }
}

#[test]
fn t11_build_id_and_release_id_are_independent() {
    let (bid, rid) = (v1(), release("0.3.1"));
    let both = current_app_ready_context(7, Some(&bid), Some(&rid));
    assert_eq!(both["buildId"].as_str(), Some(bid.as_str()));
    assert_eq!(both["releaseId"].as_str(), Some(rid.as_str()));

    let release_only = current_app_ready_context(7, None, Some(&rid));
    assert_eq!(release_only["buildId"].as_str(), Some("unknown"));
    assert_eq!(release_only["releaseId"].as_str(), Some(rid.as_str()));

    let build_only = current_app_ready_context(7, Some(&bid), None);
    assert_eq!(build_only["buildId"].as_str(), Some(bid.as_str()));
    assert_eq!(build_only["releaseId"].as_str(), Some("unknown"));

    // Each id is refused in the other's slot.
    let swapped = current_app_ready_context(7, Some(&rid), Some(&bid));
    assert_eq!(swapped["buildId"].as_str(), Some("unknown"));
    assert_eq!(swapped["releaseId"].as_str(), Some("unknown"));
}
