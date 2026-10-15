//! Wire contract: tauri-plugin-updater error text vs the frontend classifier.
//!
//! `src/components/common/settings/updaterErrors.ts` decides "updates disabled"
//! by comparing the (whitespace-trimmed) string the plugin's `check` command
//! rejects with against the full EmptyEndpoints Display text (D110). The plugin
//! serialises its `Error` as a plain string of its Display text, so that text is
//! the contract, and K1-exact pins every character of it. ReleaseNotFound is
//! pinned as the uncertain class (the plugin's answer to any non-2xx, D85),
//! which the About pane shows as an error and the log carries verbatim (K1).
//!
//! K2 (D85-WI-3): malformed release metadata, run through the plugin's real
//! `RemoteRelease` deserializer, never carries the disabled marker. It pins
//! the texts the TS tests reuse (tests/support/updaterErrorTexts.ts).
//!
//! K3 (D224): plugin 2.13.1 `TargetsNotFound`, the rejection a client gets when
//! `latest.json` has no entry for its platform (Windows, Linux), is pinned
//! character for character: off macOS the About pane reads it as "updates not
//! offered here", not as a failure. `TargetNotFound` (singular, raised only when
//! a target is set, which mdpro never does) is pinned as the text the TS tests
//! use for a malformed-metadata sample.

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

/// The exact text `updaterErrors.ts` (`EMPTY_ENDPOINTS_DISPLAY`) compares against (D110).
const EMPTY_ENDPOINTS_DISPLAY: &str = "Updater does not have any endpoints set.";

#[test]
fn k1_exact_empty_endpoints_wire_text_is_the_full_display_text() {
    assert_eq!(wire_text(Error::EmptyEndpoints), EMPTY_ENDPOINTS_DISPLAY);
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
    assert_eq!(
        text,
        "the `signature` field was not set on the updater response"
    );
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

/// The exact texts `updaterErrors.ts` (`PLATFORM_NOT_IN_MANIFEST`) recognises (D224): plugin
/// 2.13.1 `Error::TargetsNotFound`, raised by `check()` when `latest.json` has no entry for the
/// client's platform, even when the remote version is not newer. Shared with the TS tests as
/// `PLATFORM_NOT_IN_MANIFEST_TEXTS` (tests/support/updaterErrorTexts.ts).
const TARGETS_NOT_FOUND_WINDOWS: &str = "None of the fallback platforms `[\"windows-x86_64-nsis\", \"windows-x86_64\"]` were found in the response `platforms` object";
const TARGETS_NOT_FOUND_LINUX: &str = "None of the fallback platforms `[\"linux-x86_64-appimage\", \"linux-x86_64\"]` were found in the response `platforms` object";

#[test]
fn k3_targets_not_found_wire_text_is_the_full_display_text() {
    let windows = Error::TargetsNotFound(vec![
        "windows-x86_64-nsis".to_owned(),
        "windows-x86_64".to_owned(),
    ]);
    let linux = Error::TargetsNotFound(vec![
        "linux-x86_64-appimage".to_owned(),
        "linux-x86_64".to_owned(),
    ]);
    assert_eq!(wire_text(windows), TARGETS_NOT_FOUND_WINDOWS);
    assert_eq!(wire_text(linux), TARGETS_NOT_FOUND_LINUX);
}

#[test]
fn k3_target_not_found_singular_pins_the_in_the_response_text() {
    assert_eq!(
        wire_text(Error::TargetNotFound("darwin-aarch64".to_owned())),
        "the platform `darwin-aarch64` was not found in the response `platforms` object"
    );
}

#[test]
fn k3_targets_not_found_never_carries_the_disabled_marker() {
    for text in [TARGETS_NOT_FOUND_WINDOWS, TARGETS_NOT_FOUND_LINUX] {
        assert!(!text.contains(DISABLED_MARKER), "{text:?}");
    }
}
