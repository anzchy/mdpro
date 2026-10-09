//! Wire contract: tauri-plugin-updater error text vs the frontend classifier.
//!
//! `src/components/common/settings/updaterErrors.ts` decides "updates disabled"
//! by substring over the string the plugin's `check` command rejects with. The
//! plugin serialises its `Error` as a plain string of its Display text, so that
//! text is the contract. A plugin bump that rewords either message fails here —
//! the intended signal to update the TS markers (WI-1, case K1).

use tauri_plugin_updater::Error;

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
