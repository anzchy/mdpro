//! D189 / ADR-0088: the `sidebarWidth` preference — default, migration,
//! clamp on read, the `set_preferences` boundary and the merge.
use super::*;
use crate::models::UserPreferences;
use crate::services::preferences::{merge_preferences, PartialPreferences};
use serde_json::{json, Value};

/// A full default config with `sidebarWidth` replaced and one unrelated
/// non-default field, so a test can see that the rest of the document loads.
fn config_with(width: Option<Value>) -> String {
    let mut v = serde_json::to_value(UserPreferences::default()).unwrap();
    match width {
        Some(w) => v["sidebarWidth"] = w,
        None => {
            v.as_object_mut().unwrap().remove("sidebarWidth");
        }
    }
    v["showSidebar"] = json!(false);
    v.to_string()
}

fn load(text: &str) -> UserPreferences {
    serde_json::from_str(text).expect("config must load")
}

fn partial(text: &str) -> Result<PartialPreferences, serde_json::Error> {
    serde_json::from_str(text)
}

#[test]
fn sw01_default_is_220_and_serialises_as_sidebar_width() {
    let d = UserPreferences::default();
    assert_eq!(d.sidebar_width, 220);
    assert_eq!(
        serde_json::to_value(&d).unwrap()["sidebarWidth"],
        json!(220)
    );
}

#[test]
fn sw02_absent_key_reads_default() {
    let p = load(&config_with(None));
    assert_eq!(p.sidebar_width, SIDEBAR_WIDTH_DEFAULT);
    assert!(!p.show_sidebar, "the rest of the document still applies");
}

#[test]
fn sw03_stored_in_range_is_kept() {
    for w in [180, 181, 300, 479, 480] {
        assert_eq!(load(&config_with(Some(json!(w)))).sidebar_width, w);
    }
}

#[test]
fn sw04_stored_out_of_range_is_clamped() {
    for (raw, want) in [
        (json!(179), 180),
        (json!(0), 180),
        (json!(-50), 180),
        (json!(481), 480),
        (json!(99999), 480),
        (json!(1e300), 480),
    ] {
        assert_eq!(
            load(&config_with(Some(raw.clone()))).sidebar_width,
            want,
            "{raw}"
        );
    }
}

#[test]
fn sw05_stored_fraction_rounds() {
    assert_eq!(load(&config_with(Some(json!(250.4)))).sidebar_width, 250);
    assert_eq!(load(&config_with(Some(json!(250.5)))).sidebar_width, 251);
}

#[test]
fn sw06_stored_wrong_type_reads_default_and_the_rest_loads() {
    for raw in [
        json!("wide"),
        Value::Null,
        json!(true),
        json!([]),
        json!({}),
    ] {
        let p = load(&config_with(Some(raw.clone())));
        assert_eq!(p.sidebar_width, SIDEBAR_WIDTH_DEFAULT, "{raw}");
        assert!(
            !p.show_sidebar,
            "{raw}: one bad field must not lose the file"
        );
    }
}

#[test]
fn sw07_partial_number_is_clamped_at_the_boundary() {
    assert_eq!(
        partial(r#"{"sidebarWidth":9999}"#).unwrap().sidebar_width,
        Some(480)
    );
    assert_eq!(
        partial(r#"{"sidebarWidth":100.2}"#).unwrap().sidebar_width,
        Some(180)
    );
    assert_eq!(
        partial(r#"{"sidebarWidth":300}"#).unwrap().sidebar_width,
        Some(300)
    );
    assert_eq!(partial("{}").unwrap().sidebar_width, None);
}

#[test]
fn sw08_partial_non_number_is_rejected() {
    for text in [
        r#"{"sidebarWidth":"wide"}"#,
        r#"{"sidebarWidth":true}"#,
        r#"{"sidebarWidth":[300]}"#,
    ] {
        assert!(partial(text).is_err(), "{text}");
    }
}

#[test]
fn sw09_merge_sets_and_clamps_a_constructed_value() {
    let current = UserPreferences {
        sidebar_width: 300,
        ..UserPreferences::default()
    };
    for (update, want) in [(250, 250), (9000, 480), (0, 180)] {
        let mut p = partial("{}").unwrap();
        p.sidebar_width = Some(update);
        assert_eq!(
            merge_preferences(current.clone(), p).sidebar_width,
            want,
            "{update}"
        );
    }
}

#[test]
fn sw10_merge_none_keeps_current() {
    let current = UserPreferences {
        sidebar_width: 333,
        ..UserPreferences::default()
    };
    let next = merge_preferences(current, partial("{}").unwrap());
    assert_eq!(next.sidebar_width, 333);
}

#[test]
fn sw11_non_finite_clamps_to_default() {
    for raw in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(clamp_sidebar_width(raw), SIDEBAR_WIDTH_DEFAULT, "{raw}");
    }
}
