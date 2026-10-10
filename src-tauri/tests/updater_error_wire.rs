//! Wire contract: tauri-plugin-updater error text vs the frontend classifier.
//!
//! `src/components/common/settings/updaterErrors.ts` decides "updates disabled"
//! by substring over the string the plugin's `check` command rejects with. The
//! plugin serialises its `Error` as a plain string of its Display text, so that
//! text is the contract. EmptyEndpoints is the only marker; ReleaseNotFound is
//! pinned as the uncertain class (the plugin's answer to any non-2xx, D85),
//! which the About pane shows as an error and the log carries verbatim (K1).
//!
//! K2 (D85-WI-3): malformed release metadata, run through the plugin's real
//! `RemoteRelease` deserializer, never carries the disabled marker. It pins
//! the texts the TS tests reuse (tests/support/updaterErrorTexts.ts).

use serde_json::json;
use tauri_plugin_updater::{Error, RemoteRelease};

fn wire_text(error: Error) -> String {
    let value = serde_json::to_value(error).expect("updater Error serialises");
    assert!(
        value.is_string(),
        "updater Error must serialise to a JSON string, got {value}"
    );
    value.as_str().unwrap_or_default().to_owned()
}

#[test]
fn empty_endpoints_serialises_to_the_does_not_have_any_endpoints_fragment() {
    let text = wire_text(Error::EmptyEndpoints);
    assert!(
        text.contains("does not have any endpoints"),
        "EmptyEndpoints wire text changed: {text:?}"
    );
}

#[test]
fn release_not_found_serialises_to_the_could_not_fetch_fragment() {
    let text = wire_text(Error::ReleaseNotFound);
    assert!(
        text.contains("Could not fetch a valid release"),
        "ReleaseNotFound wire text changed: {text:?}"
    );
}

const DISABLED_MARKER: &str = "does not have any endpoints";
const URL: &str = "https://example.com/mdpro.app.tar.gz";

/// Deserialises `value` as the plugin's `RemoteRelease` and returns the wire
/// text of the resulting `Error` (`Error::Serialization`, as `check` produces).
fn malformed_wire_text(value: serde_json::Value) -> String {
    match serde_json::from_value::<RemoteRelease>(value) {
        Ok(release) => panic!("malformed metadata deserialised: {release:?}"),
        Err(err) => wire_text(Error::from(err)),
    }
}

#[test]
fn k2_missing_url_pins_the_url_not_set_text() {
    let text = malformed_wire_text(json!({ "version": "0.3.1" }));
    assert_eq!(text, "the `url` field was not set on the updater response");
}

#[test]
fn k2_missing_signature_pins_the_signature_not_set_text() {
    let text = malformed_wire_text(json!({ "version": "0.3.1", "url": URL }));
    assert_eq!(text, "the `signature` field was not set on the updater response");
}

#[test]
fn k2_missing_version_pins_the_missing_field_text() {
    let text = malformed_wire_text(json!({ "url": URL, "signature": "sig" }));
    assert_eq!(text, "missing field `version`");
}

#[test]
fn k2_bad_pub_date_pins_the_invalid_pub_date_prefix() {
    let text = malformed_wire_text(json!({
        "version": "0.3.1", "pub_date": "not-a-date", "url": URL, "signature": "sig"
    }));
    assert!(
        text.starts_with("invalid value for `pub_date`: "),
        "bad pub_date wire text changed: {text:?}"
    );
}

#[test]
fn k2_no_malformed_metadata_text_carries_the_disabled_marker() {
    let cases = [
        json!({ "version": "0.3.1" }),
        json!({ "version": "0.3.1", "url": URL }),
        json!({ "url": URL, "signature": "sig" }),
        json!({ "version": "0.3.1", "pub_date": "not-a-date", "url": URL, "signature": "sig" }),
    ];
    for case in cases {
        let text = malformed_wire_text(case.clone());
        assert!(!text.is_empty(), "empty wire text for {case}");
        assert!(
            !text.contains(DISABLED_MARKER),
            "malformed metadata {case} would read as updates disabled: {text:?}"
        );
    }
}
