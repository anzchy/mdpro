//! WI-3 (D24 follow-up) — the restore log vocabulary: `restore_log_fields`,
//! `restore_log_level`, `window_open_context`, `window_create_context`.
//!
//! Cases lg1-lg5 of `.claude/tdd-guardian/tests-20260926-062337.md`.
//!
//! **Law (closed vocabulary):** for every `RestoreOutcome` the restore part is
//! exactly `{geometry, geometryReason, geometryClamped}`, the strings come from
//! fixed enums, no value is a number or contains `/`, and distinct reasons log
//! distinct strings.
//! **Law (site shape):** each Success context is the pre-existing keys plus
//! the restore keys, merged top-level, and nothing else.
//!
//! Pure calls, nothing mocked.

use super::*;
use crate::models::LogLevel;
use serde_json::{json, Value};

fn outcome(reason: RestoreReason, clamped: bool) -> RestoreOutcome {
    let source = if reason == RestoreReason::Stored {
        GeometrySource::Stored
    } else {
        GeometrySource::Default
    };
    RestoreOutcome {
        source,
        reason,
        clamped,
    }
}

/// Every variant, listed by hand: a new variant must be added here on purpose.
const REASONS: [RestoreReason; 4] = [
    RestoreReason::Stored,
    RestoreReason::NoPath,
    RestoreReason::NoRecord,
    RestoreReason::ReadFailed,
];

fn all_outcomes() -> Vec<RestoreOutcome> {
    let mut v = Vec::new();
    for r in REASONS {
        for c in [false, true] {
            v.push(outcome(r, c));
        }
    }
    v
}

fn sorted_keys(v: &Value) -> Vec<String> {
    let mut keys: Vec<String> = v
        .as_object()
        .unwrap_or_else(|| panic!("not an object: {v}"))
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

fn assert_no_number_or_slash(v: &Value, skip: &[&str]) {
    for (k, val) in v.as_object().expect("object") {
        if skip.contains(&k.as_str()) {
            continue;
        }
        assert!(!val.is_number(), "{k} is a number in {v}");
        if let Some(s) = val.as_str() {
            assert!(!s.contains('/'), "{k} contains '/' in {v}");
        }
    }
}

#[test]
fn lg1_exhaustive_mapping_to_exact_json() {
    use RestoreReason::*;
    let rows = [
        (
            Stored,
            false,
            json!({"geometry": "stored", "geometryReason": "stored", "geometryClamped": false}),
        ),
        (
            Stored,
            true,
            json!({"geometry": "stored", "geometryReason": "stored", "geometryClamped": true}),
        ),
        (
            NoPath,
            false,
            json!({"geometry": "default", "geometryReason": "no_path", "geometryClamped": false}),
        ),
        (
            NoPath,
            true,
            json!({"geometry": "default", "geometryReason": "no_path", "geometryClamped": true}),
        ),
        (
            NoRecord,
            false,
            json!({"geometry": "default", "geometryReason": "no_record", "geometryClamped": false}),
        ),
        (
            NoRecord,
            true,
            json!({"geometry": "default", "geometryReason": "no_record", "geometryClamped": true}),
        ),
        (
            ReadFailed,
            false,
            json!({"geometry": "default", "geometryReason": "read_failed", "geometryClamped": false}),
        ),
        (
            ReadFailed,
            true,
            json!({"geometry": "default", "geometryReason": "read_failed", "geometryClamped": true}),
        ),
    ];
    for (reason, clamped, expected) in rows {
        assert_eq!(
            restore_log_fields(&outcome(reason, clamped)),
            expected,
            "{reason:?} clamped={clamped}"
        );
    }
}

#[test]
fn lg2_closed_vocabulary_and_injective_reasons() {
    let names = vec![
        "geometry".to_string(),
        "geometryClamped".to_string(),
        "geometryReason".to_string(),
    ];
    let reason_strings = ["stored", "no_path", "no_record", "read_failed"];
    for o in all_outcomes() {
        let v = restore_log_fields(&o);
        assert_eq!(sorted_keys(&v), names, "{o:?}");
        let geometry = v["geometry"].as_str().expect("geometry is a string");
        assert!(
            ["stored", "default"].contains(&geometry),
            "{o:?}: {geometry}"
        );
        let reason = v["geometryReason"].as_str().expect("reason is a string");
        assert!(reason_strings.contains(&reason), "{o:?}: {reason}");
        assert!(v["geometryClamped"].is_boolean(), "{o:?}");
        assert_no_number_or_slash(&v, &[]);
    }
    let mut logged: Vec<String> = REASONS
        .iter()
        .map(|r| {
            restore_log_fields(&outcome(*r, false))["geometryReason"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        })
        .collect();
    logged.sort();
    logged.dedup();
    assert_eq!(
        logged.len(),
        REASONS.len(),
        "reason strings collide: {logged:?}"
    );
}

#[test]
fn lg3_read_failed_is_warn_everything_else_info() {
    for o in all_outcomes() {
        let expected = if o.reason == RestoreReason::ReadFailed {
            LogLevel::Warn
        } else {
            LogLevel::Info
        };
        let level = restore_log_level(&o);
        assert_eq!(level, expected, "{o:?}");
        assert_ne!(level, LogLevel::Error, "{o:?}: the open itself succeeded");
    }
}

#[test]
fn lg4_clamped_follows_the_decide_result() {
    let work = WorkArea {
        x: 0.0,
        y: 0.0,
        width: 1440.0,
        height: 900.0,
    };
    let legacy = WindowGeometry {
        x: 200,
        y: 200,
        width: 2400,
        height: 1600,
        last_accessed: 0,
    };
    let (_, o) = decide_window_geometry(Some("/x/b.md"), Ok(Some(legacy)), work);
    let v = restore_log_fields(&o);
    assert_eq!(v["geometry"], json!("stored"));
    assert_eq!(v["geometryClamped"], json!(true));

    let device = WorkArea {
        x: 0.0,
        y: 37.0,
        width: 1512.0,
        height: 945.0,
    };
    let d1 = WindowGeometry {
        x: 333,
        y: 177,
        width: 1011,
        height: 655,
        last_accessed: 0,
    };
    let (_, o) = decide_window_geometry(Some("/x/b.md"), Ok(Some(d1)), device);
    let v = restore_log_fields(&o);
    assert_eq!(v["geometry"], json!("stored"));
    assert_eq!(v["geometryClamped"], json!(false));
}

fn restore_part(v: &Value) -> Value {
    json!({
        "geometry": v["geometry"],
        "geometryReason": v["geometryReason"],
        "geometryClamped": v["geometryClamped"],
    })
}

#[test]
fn lg5_site_contexts_have_exact_keys_and_top_level_restore_fields() {
    let open_keys = [
        "filePath",
        "geometry",
        "geometryClamped",
        "geometryReason",
        "windowId",
        "windowLabel",
    ];
    let create_keys = [
        "filePath",
        "geometry",
        "geometryClamped",
        "geometryReason",
        "windowId",
    ];
    for o in all_outcomes() {
        let open = window_open_context("mdpro-11111111", "mdpro-11111111", "/Users/x/b.md", &o);
        assert_eq!(sorted_keys(&open), open_keys, "open {o:?}");
        assert_eq!(open["windowId"], json!("mdpro-11111111"));
        assert_eq!(open["windowLabel"], json!("mdpro-11111111"));
        assert_eq!(open["filePath"], json!("/Users/x/b.md"));
        assert_eq!(restore_part(&open), restore_log_fields(&o), "open {o:?}");
        assert_no_number_or_slash(&open, &["filePath"]);

        let with = window_create_context("mdpro-22222222", Some("/Users/x/c.md"), &o);
        assert_eq!(sorted_keys(&with), create_keys, "create {o:?}");
        assert_eq!(with["windowId"], json!("mdpro-22222222"));
        assert_eq!(with["filePath"], json!("/Users/x/c.md"));
        assert_eq!(restore_part(&with), restore_log_fields(&o), "create {o:?}");
        assert_no_number_or_slash(&with, &["filePath"]);

        let none = window_create_context("mdpro-33333333", None, &o);
        assert_eq!(sorted_keys(&none), create_keys, "create(None) {o:?}");
        assert_eq!(none["windowId"], json!("mdpro-33333333"));
        assert_eq!(none.get("filePath"), Some(&Value::Null));
        assert_eq!(
            restore_part(&none),
            restore_log_fields(&o),
            "create(None) {o:?}"
        );
        assert_no_number_or_slash(&none, &["filePath"]);
    }
}
