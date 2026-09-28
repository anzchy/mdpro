//! P-1 and P-3 (ADR-0040 WI-6b): a generic `set_preferences` write keeps the
//! on-disk `mcp.serverEnabled` (ADR-0040 decision 1). Only the locked
//! `persist_server_enabled` path writes that field; every other `mcp` field
//! still comes from the update. (P-2, the WI5-F rewrite, lives in
//! `preferences_wi5_tests.rs`.)
//!
//! - P-1: `merge_preferences` over all 16 combinations of
//!   `current.server_enabled` × the update's three fields, plus the two
//!   `updates.mcp = None` rows.
//! - P-3: the real `set_preferences` command on a temp `$HOME` (`TestHome`,
//!   under `HOME_LOCK`), in both directions, re-read from disk. The
//!   developer's `~/.mdpro/` is never touched.

use super::{load_preferences, merge_preferences, PartialPreferences};
use crate::commands::preferences::set_preferences;
use crate::models::{McpConfig, UserPreferences};
use crate::services::window_restore::test_home::{config_file, seed_config, TestHome};
use serde_json::{json, Value};

/// A partial with nothing set but `mcp`, built from the wire shape the
/// frontend sends so the serde defaults apply exactly as in production.
fn mcp_only_partial(mcp: Value) -> PartialPreferences {
    serde_json::from_value(json!({ "mcp": mcp })).expect("an mcp-only partial deserialises")
}

fn no_mcp_partial() -> PartialPreferences {
    serde_json::from_value(json!({})).expect("an empty partial deserialises")
}

// ---------------------------------------------------------------------------
// P-1 — the merge law, exhaustively
// ---------------------------------------------------------------------------

#[test]
fn p1_merge_keeps_current_server_enabled_and_takes_the_other_mcp_fields_from_the_update() {
    let bools = [true, false];
    let mut row = 0;
    for cur_se in bools {
        for upd_se in bools {
            for upd_sol in bools {
                for upd_aae in bools {
                    row += 1;
                    // current's other two fields are the NEGATION of the
                    // update's, so "kept current" and "took update" differ.
                    let current = UserPreferences {
                        mcp: McpConfig {
                            server_enabled: cur_se,
                            start_on_launch: !upd_sol,
                            auto_approve_edits: !upd_aae,
                        },
                        ..UserPreferences::default()
                    };
                    let update = McpConfig {
                        server_enabled: upd_se,
                        start_on_launch: upd_sol,
                        auto_approve_edits: upd_aae,
                    };
                    let updates = PartialPreferences {
                        mcp: Some(update),
                        ..no_mcp_partial()
                    };
                    let ctx = format!(
                        "row {row}: current.server_enabled={cur_se}, update=\
                         {{server_enabled={upd_se}, start_on_launch={upd_sol}, \
                         auto_approve_edits={upd_aae}}}"
                    );

                    let result = merge_preferences(current, updates).mcp;

                    assert_eq!(
                        result.server_enabled, cur_se,
                        "{ctx}: server_enabled must keep current's value (ADR-0040)"
                    );
                    assert_eq!(
                        result.start_on_launch, upd_sol,
                        "{ctx}: start_on_launch must take the update's value"
                    );
                    assert_eq!(
                        result.auto_approve_edits, upd_aae,
                        "{ctx}: auto_approve_edits must take the update's value"
                    );
                }
            }
        }
    }
    assert_eq!(row, 16, "the table must cover all 16 combinations");
}

#[test]
fn p1_no_mcp_update_leaves_current_mcp_whole() {
    for (row, cur_se) in [(17, true), (18, false)] {
        let current_mcp = McpConfig {
            server_enabled: cur_se,
            start_on_launch: true,
            auto_approve_edits: true,
        };
        let current = UserPreferences {
            mcp: current_mcp.clone(),
            ..UserPreferences::default()
        };

        let result = merge_preferences(current, no_mcp_partial()).mcp;

        // McpConfig has no PartialEq; whole-struct equality via its serde form.
        assert_eq!(
            serde_json::to_value(&result).expect("serialise result mcp"),
            serde_json::to_value(&current_mcp).expect("serialise current mcp"),
            "row {row}: updates.mcp = None, current.server_enabled={cur_se}: \
             the result's mcp must equal current's"
        );
    }
}

// ---------------------------------------------------------------------------
// P-3 — `set_preferences` round trip on a temp HOME
// ---------------------------------------------------------------------------

/// Seed `mcp` on disk, run the real command with an `mcp`-only partial, then
/// re-read the file. Returns the `mcp` object as parsed from the raw file and
/// as `load_preferences()` types it.
fn round_trip(label: &str, disk_mcp: Value, partial_mcp: Value) -> (Value, McpConfig) {
    let home = TestHome::new(label);
    seed_config(&home.dir, |v| v["mcp"] = disk_mcp);

    tauri::async_runtime::block_on(set_preferences(mcp_only_partial(partial_mcp)))
        .expect("a readable config must let set_preferences succeed");

    let raw: Value = serde_json::from_slice(
        &std::fs::read(config_file(&home.dir)).expect("config.json exists after the write"),
    )
    .expect("config.json is JSON");
    let typed = load_preferences().expect("config.json reloads").mcp;
    let _ = std::fs::remove_dir_all(&home.dir);
    (raw["mcp"].clone(), typed)
}

#[test]
fn p3a_set_preferences_keeps_disk_server_enabled_true_and_applies_start_on_launch() {
    let (raw, typed) = round_trip(
        "p3a_merge_keeps_true",
        json!({ "serverEnabled": true, "startOnLaunch": false, "autoApproveEdits": false }),
        json!({ "serverEnabled": false, "startOnLaunch": true, "autoApproveEdits": false }),
    );

    assert_eq!(
        raw["serverEnabled"],
        json!(true),
        "disk serverEnabled=true, generic write of false: disk must stay true; mcp={raw}"
    );
    assert_eq!(
        raw["startOnLaunch"],
        json!(true),
        "the generic write must still apply startOnLaunch; mcp={raw}"
    );
    assert!(typed.server_enabled, "reloaded serverEnabled must be true");
    assert!(typed.start_on_launch, "reloaded startOnLaunch must be true");
}

#[test]
fn p3b_set_preferences_keeps_disk_server_enabled_false() {
    let (raw, typed) = round_trip(
        "p3b_merge_keeps_false",
        json!({ "serverEnabled": false, "startOnLaunch": false, "autoApproveEdits": false }),
        json!({ "serverEnabled": true, "startOnLaunch": true, "autoApproveEdits": false }),
    );

    assert_eq!(
        raw["serverEnabled"],
        json!(false),
        "disk serverEnabled=false, generic write of true: disk must stay false; mcp={raw}"
    );
    assert!(
        !typed.server_enabled,
        "reloaded serverEnabled must be false"
    );
}
