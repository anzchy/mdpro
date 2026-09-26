//! D27-FIX-2 L2: `recovery::recover_draft` once the legacy pair it was sent
//! for has been migrated to a bundle by `load_draft`'s unlocked
//! migrate-on-read (ADR-0038 §4-§5).
//!
//! The race sits between `guarded::recover_locked` finding no bundle and its
//! call into `recover_draft`, with no seam in between, so these tests build
//! the state that call sees and call `recover_draft` directly: the migrated
//! bundle on disk (no owner, not recovered, an old `lastModified`), with the
//! legacy pair already removed (i) or not yet removed (ii). Either way the
//! locked path must answer `NotFound` and leave the bundle byte-identical;
//! stamping it `recovered` with no owner would make it cleanup-eligible.
use super::super::draft_test_home::{ago, bundle_json, TempHome};
use super::*;
use serde_json::json;

fn migrated_bundle(home: &TempHome, id: &str) -> Vec<u8> {
    let json = bundle_json("legacy body", Some("/tmp/l.md"), &ago(30), false, None);
    home.write_raw(id, &json);
    home.read_raw(id)
}

fn assert_untouched(home: &TempHome, id: &str, before: &[u8]) {
    assert_eq!(home.read_raw(id), before, "bundle bytes changed");
    let v = home.value(id);
    assert_eq!(v["recovered"], json!(false), "stamped recovered");
    assert!(v.get("owner").is_none(), "owner written: {v}");
}

#[test]
fn r1_bundle_migrated_in_the_window_is_not_found_and_left_untouched() {
    let home = TempHome::new("recovery_race_r1");
    let before = migrated_bundle(&home, "L");
    let r = recover_draft("L");
    assert!(
        matches!(&r, Err(DraftError::NotFound { document_id }) if document_id == "L"),
        "{r:?}"
    );
    assert_untouched(&home, "L", &before);
}

#[test]
fn r2_bundle_written_before_the_legacy_pair_is_removed_is_not_found() {
    let home = TempHome::new("recovery_race_r2");
    home.write_legacy("L", "legacy body", Some("/tmp/l.md"), &ago(30), false);
    let before = migrated_bundle(&home, "L");
    let r = recover_draft("L");
    assert!(
        matches!(&r, Err(DraftError::NotFound { document_id }) if document_id == "L"),
        "{r:?}"
    );
    assert_untouched(&home, "L", &before);
}
