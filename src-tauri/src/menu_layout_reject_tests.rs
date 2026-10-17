//! Audit b186 F2: `menu_layout.json` defaults match the TS schema exactly. A
//! configurable key has a string default at v1 and v2; a fixed key's default
//! may be `null` but both version entries must be present. Each case mutates
//! one spot of the committed file and expects the parse to refuse it.

use super::*;

const CONFIGURABLE: &str = "\"kind\": \"configurable\",\n          \"defaults\": {\n            \"v1\": \"Cmd+Shift+C\",\n            \"v2\": \"Cmd+Shift+C\"\n          },";
const FIXED_NULL: &str =
    "\"kind\": \"fixed\",\n          \"defaults\": {\n            \"v1\": null,\n            \"v2\": null\n          },";

/// The committed file with the first `from` replaced by `to`.
fn mutated(from: &str, to: &str) -> String {
    assert!(MENU_LAYOUT_JSON.contains(from), "{from} is in the file");
    MENU_LAYOUT_JSON.replacen(from, to, 1)
}

fn refused(from: &str, to: &str) -> String {
    match parse_menu_layout(&mutated(from, to)) {
        Ok(_) => panic!("accepted:\n{to}"),
        Err(e) => e,
    }
}

#[test]
fn the_committed_file_parses_with_both_spots_present() {
    assert!(MENU_LAYOUT_JSON.contains(CONFIGURABLE));
    assert!(MENU_LAYOUT_JSON.contains(FIXED_NULL));
    assert!(parse_menu_layout(MENU_LAYOUT_JSON).is_ok());
}

#[test]
fn a_null_configurable_default_is_refused_at_v1_and_at_v2() {
    for (ver, to) in [
        (
            "v1",
            CONFIGURABLE.replacen("\"v1\": \"Cmd+Shift+C\"", "\"v1\": null", 1),
        ),
        (
            "v2",
            CONFIGURABLE.replacen("\"v2\": \"Cmd+Shift+C\"", "\"v2\": null", 1),
        ),
    ] {
        let err = refused(CONFIGURABLE, &to);
        assert!(err.contains("configurable"), "{ver}: {err}");
    }
}

#[test]
fn a_missing_configurable_version_entry_is_refused() {
    let no_v1 = CONFIGURABLE.replacen("\n            \"v1\": \"Cmd+Shift+C\",", "", 1);
    assert!(refused(CONFIGURABLE, &no_v1).contains("v1"));
    let no_v2 = CONFIGURABLE.replacen(",\n            \"v2\": \"Cmd+Shift+C\"", "", 1);
    assert!(refused(CONFIGURABLE, &no_v2).contains("v2"));
}

#[test]
fn a_fixed_key_missing_v1_or_v2_is_refused_though_null_is_allowed() {
    let no_v1 = FIXED_NULL.replacen("\n            \"v1\": null,", "", 1);
    let err = refused(FIXED_NULL, &no_v1);
    assert!(err.contains("missing field `v1`"), "{err}");
    let no_v2 = FIXED_NULL.replacen(",\n            \"v2\": null", "", 1);
    let err = refused(FIXED_NULL, &no_v2);
    assert!(err.contains("missing field `v2`"), "{err}");
}
